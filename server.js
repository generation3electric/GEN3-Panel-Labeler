import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

const PORT = process.env.PORT || 3000;
const SHAREPOINT_HOSTNAME = process.env.SHAREPOINT_HOSTNAME || '2155124102.sharepoint.com';
const SHAREPOINT_SITE_PATH = process.env.SHAREPOINT_SITE_PATH || '/sites/GEN3FieldRecords';
const SHAREPOINT_LIBRARY = process.env.SHAREPOINT_LIBRARY || 'Panel Records';
const SHAREPOINT_LIST = process.env.SHAREPOINT_LIST || 'Panel Record Index';

function microsoftConfigured() {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

function safeName(value, fallback = 'Unknown') {
  const cleaned = String(value || fallback)
    .replace(/[~#%&*{}\\:<>?/+|\"]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 120) || fallback;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Microsoft authentication failed.');
  return data.access_token;
}

async function graph(token, pathname, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body && !Buffer.isBuffer(options.body) ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.error?.message || `Microsoft Graph returned ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function ensureFolder(token, driveId, parentId, name) {
  const childrenPath = parentId
    ? `/drives/${driveId}/items/${parentId}/children`
    : `/drives/${driveId}/root/children`;
  try {
    return await graph(token, childrenPath, {
      method: 'POST',
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    const existingPath = parentId
      ? `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}`
      : `/drives/${driveId}/root:/${encodeURIComponent(name)}`;
    return graph(token, existingPath);
  }
}

async function uploadFile(token, driveId, folderId, filename, buffer) {
  return graph(token, `/drives/${driveId}/items/${folderId}:/${encodeURIComponent(filename)}:/content`, {
    method: 'PUT',
    body: buffer,
    headers: { 'content-type': 'application/octet-stream' },
  });
}

app.get('/api/sharepoint/status', (_req, res) => {
  res.json({ configured: microsoftConfigured() });
});

app.post('/api/sharepoint/panel-records', upload.array('photos', 20), async (req, res) => {
  if (!microsoftConfigured()) {
    return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  }

  try {
    const record = JSON.parse(req.body.record || '{}');
    if (!record.job?.id || !record.panel?.name || !record.recordId) {
      return res.status(400).json({ error: 'Job, panel name, and record ID are required.' });
    }

    const token = await getAccessToken();
    const site = await graph(token, `/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}`);
    const drives = await graph(token, `/sites/${site.id}/drives`);
    const drive = drives.value.find((item) => item.name === SHAREPOINT_LIBRARY);
    if (!drive) throw new Error(`SharePoint library “${SHAREPOINT_LIBRARY}” was not found.`);

    const lists = await graph(token, `/sites/${site.id}/lists?$select=id,displayName`);
    const list = lists.value.find((item) => item.displayName === SHAREPOINT_LIST);
    if (!list) throw new Error(`SharePoint list “${SHAREPOINT_LIST}” was not found.`);

    const year = String(new Date(record.capturedAt).getFullYear());
    const yearFolder = await ensureFolder(token, drive.id, null, year);
    const jobFolder = await ensureFolder(token, drive.id, yearFolder.id, `Job ${safeName(record.job.id)}`);
    const panelFolder = await ensureFolder(token, drive.id, jobFolder.id, `${safeName(record.recordId)} ${safeName(record.panel.name)}`);

    const uploaded = [];
    for (const file of req.files || []) {
      const result = await uploadFile(token, drive.id, panelFolder.id, safeName(file.originalname, 'panel-photo.jpg'), file.buffer);
      uploaded.push({ name: result.name, webUrl: result.webUrl });
    }

    const metadata = { ...record, uploadedPhotos: uploaded };
    await uploadFile(
      token,
      drive.id,
      panelFolder.id,
      `${safeName(record.recordId)}-record.json`,
      Buffer.from(JSON.stringify(metadata, null, 2)),
    );

    const columns = await graph(token, `/sites/${site.id}/lists/${list.id}/columns?$select=name,displayName`);
    const internalName = (displayName) => columns.value.find((column) => column.displayName === displayName)?.name;
    const values = {
      Title: `${record.job.id} — ${record.panel.name}`,
      'ServiceTitan Job Number': String(record.job.id),
      'ServiceTitan Job ID': String(record.job.serviceTitanId || record.job.id),
      'Panel Record ID': record.recordId,
      'Panel Name': record.panel.name,
      'Service Address': record.job.address,
      'Record Status': 'Saved to SharePoint',
      'Job Note Status': 'Pending ServiceTitan connection',
      'Folder Link': panelFolder.webUrl,
      'Captured Photos': record.capturedCount,
      'Skipped Photos': record.skippedCount,
      'Captured By': record.capturedBy || '',
      'Captured At': record.capturedAt,
    };
    const fields = { Title: values.Title };
    for (const [displayName, value] of Object.entries(values)) {
      if (displayName === 'Title') continue;
      const name = internalName(displayName);
      if (name && value !== undefined && value !== null) fields[name] = value;
    }

    const item = await graph(token, `/sites/${site.id}/lists/${list.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });

    res.status(201).json({
      recordId: record.recordId,
      folderUrl: panelFolder.webUrl,
      listItemId: item.id,
      uploadedCount: uploaded.length,
    });
  } catch (error) {
    console.error('SharePoint send failed:', error);
    res.status(error.status || 500).json({ error: error.message || 'The panel record could not be sent.' });
  }
});

const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(root, 'dist')));
app.use((_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`GEN3 Panel Labeler listening on port ${PORT}`));
