import express from 'express';
import { validatePhotoRecord } from './src/photoRules.js';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePanelPhotos, openAIConfigured } from './aiPanel.js';
import { buildJobChoices, isIsoDate } from './serviceTitanJobs.js';
import { createFinalDirectoryPdf, normalizeVerifiedDirectory } from './finalDirectory.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });
const PORT = process.env.PORT || 3000;
const SHAREPOINT_HOSTNAME = process.env.SHAREPOINT_HOSTNAME || '2155124102.sharepoint.com';
const SHAREPOINT_SITE_PATH = process.env.SHAREPOINT_SITE_PATH || '/sites/GEN3FieldRecords';
const SHAREPOINT_LIBRARY = process.env.SHAREPOINT_LIBRARY || 'Panel Records';
const SHAREPOINT_LIST = process.env.SHAREPOINT_LIST || 'Panel Record Index';
const SERVICETITAN_AUTH_URL = 'https://auth.servicetitan.io/connect/token';
const SERVICETITAN_API_URL = 'https://api.servicetitan.io';

function microsoftConfigured() { return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET); }
function serviceTitanConfigured() {
  return Boolean(
    process.env.SERVICETITAN_APP_KEY &&
    process.env.SERVICETITAN_CLIENT_ID &&
    process.env.SERVICETITAN_CLIENT_SECRET &&
    process.env.SERVICETITAN_TENANT_ID
  );
}
function safeName(value, fallback = 'Unknown') {
  const cleaned = String(value || fallback).replace(/[~#%&*{}\\:<>?/+|\"]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 120) || fallback;
}
async function getAccessToken() {
  const body = new URLSearchParams({ client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Microsoft authentication failed.');
  return data.access_token;
}
async function getServiceTitanAccessToken() {
  if (!serviceTitanConfigured()) throw new Error('ServiceTitan is not configured on Railway.');
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SERVICETITAN_CLIENT_ID, client_secret: process.env.SERVICETITAN_CLIENT_SECRET });
  const response = await fetch(SERVICETITAN_AUTH_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok || !data?.access_token) {
    const error = new Error(data?.error_description || data?.error || `ServiceTitan authentication returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data.access_token;
}
async function serviceTitan(pathname, options = {}) {
  const token = options.token || await getServiceTitanAccessToken();
  const response = await fetch(`${SERVICETITAN_API_URL}${pathname}`, {
    ...options,
    token: undefined,
    headers: { Authorization: `Bearer ${token}`, 'ST-App-Key': process.env.SERVICETITAN_APP_KEY, Accept: 'application/json', ...options.headers },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text ? { raw: text } : null; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error?.message || data?.title || `ServiceTitan returned ${response.status}.`);
    error.status = response.status; error.details = data; throw error;
  }
  return data;
}
async function serviceTitanPages(pathname, { token, pageSize = 200, maxPages = 10 } = {}) {
  const separator = pathname.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await serviceTitan(`${pathname}${separator}page=${page}&pageSize=${pageSize}`, { token });
    items.push(...(result?.data || []));
    if (!result?.hasMore) return items;
  }
  return items;
}
async function serviceTitanEntities(resource, ids, token) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniqueIds.length) return [];
  const entities = [];
  for (let index = 0; index < uniqueIds.length; index += 50) {
    const params = new URLSearchParams({ ids: uniqueIds.slice(index, index + 50).join(',') });
    const page = await serviceTitanPages(`/crm/v2/tenant/${encodeURIComponent(process.env.SERVICETITAN_TENANT_ID)}/${resource}?${params}`, { token, pageSize: 200, maxPages: 2 });
    entities.push(...page);
  }
  return entities;
}
async function graph(token, pathname, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${pathname}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body && !Buffer.isBuffer(options.body) ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text ? { raw: text } : null; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Microsoft Graph returned ${response.status}.`);
    error.status = response.status; error.code = data?.error?.code; error.pathname = pathname; error.details = data; throw error;
  }
  return data;
}
async function graphBuffer(token, pathname) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const error = new Error(data?.error?.message || `Microsoft Graph returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}
async function getSiteAndList(token) {
  const site = await graph(token, `/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}`);
  const lists = await graph(token, `/sites/${site.id}/lists?$select=id,displayName`);
  const list = lists.value.find((item) => item.displayName === SHAREPOINT_LIST);
  if (!list) throw new Error(`SharePoint list “${SHAREPOINT_LIST}” was not found.`);
  return { site, list };
}
async function getSiteListAndDrive(token) {
  const { site, list } = await getSiteAndList(token);
  const drives = await graph(token, `/sites/${site.id}/drives`);
  const drive = drives.value.find((item) => item.name === SHAREPOINT_LIBRARY);
  if (!drive) throw new Error(`SharePoint library “${SHAREPOINT_LIBRARY}” was not found.`);
  return { site, list, drive };
}
async function getDisplayFields(token, siteId, listId, itemId = null) {
  const [columns, itemResult] = await Promise.all([
    graph(token, `/sites/${siteId}/lists/${listId}/columns?$select=name,displayName`),
    itemId ? graph(token, `/sites/${siteId}/lists/${listId}/items/${encodeURIComponent(itemId)}?$expand=fields`) : Promise.resolve(null),
  ]);
  const displayByInternal = Object.fromEntries(columns.value.map((column) => [column.name, column.displayName]));
  const fields = {};
  for (const [key, value] of Object.entries(itemResult?.fields || {})) fields[displayByInternal[key] || key] = value;
  return { columns: columns.value, item: itemResult, fields };
}
function indexedRecord(item, fields) {
  return {
    id: item.id, title: fields.Title || '', jobNumber: fields['ServiceTitan Job Number'] || '', serviceTitanId: fields['ServiceTitan Job ID'] || '',
    recordId: fields['Panel Record ID'] || '', panelName: fields['Panel Name'] || '', address: fields['Service Address'] || '', status: fields['Record Status'] || '',
    folderUrl: fields['Folder Link'] || '', capturedPhotos: fields['Captured Photos'] ?? null, skippedPhotos: fields['Skipped Photos'] ?? null,
    capturedBy: fields['Captured By'] || '', capturedAt: fields['Captured At'] || item.createdDateTime || '',
    verifiedBy: fields['Verified By'] || '', verifiedAt: fields['Verified At'] || '', finalPdfUrl: fields['Final Directory Link'] || '',
  };
}
async function findPanelFolder(token, drive, record) {
  const capturedDate = new Date(record.capturedAt);
  const year = Number.isNaN(capturedDate.getTime()) ? '' : String(capturedDate.getFullYear());
  if (year && record.jobNumber) {
    try {
      const jobPath = `${encodeURIComponent(year)}/${encodeURIComponent(`Job ${safeName(record.jobNumber)}`)}`;
      const children = await graph(token, `/drives/${drive.id}/root:/${jobPath}:/children?$select=id,name,webUrl,folder,file`);
      const match = children.value.find((item) => item.folder && item.name.startsWith(safeName(record.recordId)));
      if (match) return match;
    } catch (error) {
      if (error.status !== 404) console.warn('Panel folder path lookup failed; trying drive search:', error.message);
    }
  }

  const searchText = safeName(record.recordId).replaceAll("'", "''");
  const results = await graph(token, `/drives/${drive.id}/root/search(q='${encodeURIComponent(searchText)}')?$select=id,name,webUrl,folder,file`);
  const match = results.value.find((item) => item.folder && item.name.startsWith(safeName(record.recordId)));
  if (!match) {
    const error = new Error(`The SharePoint folder for record ${record.recordId} was not found.`);
    error.status = 404;
    throw error;
  }
  return match;
}
async function loadPanelFiles(token, drive, folder) {
  const children = await graph(token, `/drives/${drive.id}/items/${folder.id}/children?$select=id,name,webUrl,file,size`);
  return children.value || [];
}
async function loadJsonFile(token, driveId, file) {
  if (!file) return null;
  const buffer = await graphBuffer(token, `/drives/${driveId}/items/${file.id}/content`);
  try { return JSON.parse(buffer.toString('utf8')); }
  catch {
    const error = new Error(`Saved file ${file.name} is not valid JSON.`);
    error.status = 500;
    throw error;
  }
}
async function loadPanelContext(token, itemId) {
  const { site, list, drive } = await getSiteListAndDrive(token);
  const { columns, item, fields } = await getDisplayFields(token, site.id, list.id, itemId);
  const indexRecord = indexedRecord(item, fields);
  if (!indexRecord.recordId) {
    const error = new Error('This SharePoint index item does not contain a Panel Record ID.');
    error.status = 404;
    throw error;
  }
  let selectedDrive = drive;
  let folder = null;
  if (indexRecord.folderUrl) {
    try {
      const resolved = await resolvePanelFolder(token, { folderUrl: indexRecord.folderUrl });
      selectedDrive = { ...drive, id: resolved.driveId };
      folder = { id: resolved.folderId, webUrl: resolved.folderUrl };
    } catch (error) {
      console.warn('Saved folder link could not be resolved; trying its indexed path:', error.message);
    }
  }
  if (!folder) folder = await findPanelFolder(token, selectedDrive, indexRecord);
  const files = await loadPanelFiles(token, selectedDrive, folder);
  return { site, list, drive: selectedDrive, columns, indexRecord, folder, files };
}
async function ensureFolder(token, driveId, parentId, name) {
  const childrenPath = parentId ? `/drives/${driveId}/items/${parentId}/children` : `/drives/${driveId}/root/children`;
  try { return await graph(token, childrenPath, { method: 'POST', body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) }); }
  catch (error) {
    if (error.status !== 409) throw error;
    const existingPath = parentId ? `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}` : `/drives/${driveId}/root:/${encodeURIComponent(name)}`;
    return graph(token, existingPath);
  }
}
async function uploadFile(token, driveId, folderId, filename, buffer) {
  return graph(token, `/drives/${driveId}/items/${folderId}:/${encodeURIComponent(filename)}:/content`, { method: 'PUT', body: buffer, headers: { 'content-type': 'application/octet-stream' } });
}

function shareIdFromUrl(url) {
  return `u!${Buffer.from(String(url)).toString('base64url')}`;
}

async function resolvePanelFolder(token, { driveId, folderId, folderUrl }) {
  if (driveId && folderId) return { driveId: String(driveId), folderId: String(folderId), folderUrl: String(folderUrl || '') };
  if (!folderUrl) throw new Error('The SharePoint panel folder could not be identified. Reopen this panel from Recently Uploaded and try again.');
  const item = await graph(token, `/shares/${shareIdFromUrl(folderUrl)}/driveItem?$select=id,webUrl,parentReference`);
  if (!item?.id || !item?.parentReference?.driveId) throw new Error('The SharePoint panel folder could not be resolved.');
  return { driveId: item.parentReference.driveId, folderId: item.id, folderUrl: item.webUrl || folderUrl };
}

app.get('/api/sharepoint/status', (_req, res) => res.json({ configured: microsoftConfigured() }));
app.get('/api/ai/status', (_req, res) => res.json({ configured: openAIConfigured(), model: process.env.OPENAI_PANEL_MODEL || 'gpt-5.6-terra' }));
app.get('/api/servicetitan/status', async (_req, res) => {
  if (!serviceTitanConfigured()) return res.status(503).json({ configured: false, authenticated: false, error: 'ServiceTitan variables are missing.' });
  try {
    const token = await getServiceTitanAccessToken();
    res.json({ configured: true, authenticated: Boolean(token), tenantIdPresent: Boolean(process.env.SERVICETITAN_TENANT_ID), appKeyPresent: Boolean(process.env.SERVICETITAN_APP_KEY) });
  } catch (error) {
    console.error('ServiceTitan authentication test failed:', { message: error.message, status: error.status });
    res.status(error.status || 502).json({ configured: true, authenticated: false, error: error.message });
  }
});
app.get('/api/servicetitan/technicians', async (_req, res) => {
  if (!serviceTitanConfigured()) return res.status(503).json({ error: 'ServiceTitan is not configured.' });
  try {
    const tenant = encodeURIComponent(process.env.SERVICETITAN_TENANT_ID);
    const data = await serviceTitan(`/settings/v2/tenant/${tenant}/technicians?pageSize=200&active=true`);
    res.json({ data: data?.data || [], hasMore: Boolean(data?.hasMore), continueFrom: data?.continueFrom || null });
  } catch (error) {
    console.error('ServiceTitan technicians failed:', { message: error.message, status: error.status, details: error.details });
    res.status(error.status || 502).json({ error: error.message });
  }
});
app.get('/api/servicetitan/jobs', async (req, res) => {
  if (!serviceTitanConfigured()) return res.status(503).json({ error: 'ServiceTitan is not configured.' });
  const date = String(req.query.date || '').trim();
  if (!isIsoDate(date)) return res.status(400).json({ error: 'Choose a valid appointment date.' });

  try {
    const token = await getServiceTitanAccessToken();
    const tenant = encodeURIComponent(process.env.SERVICETITAN_TENANT_ID);
    const nextDay = new Date(`${date}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate = nextDay.toISOString().slice(0, 10);
    const params = new URLSearchParams({ startsOnOrAfter: `${date}T00:00:00`, startsBefore: `${endDate}T00:00:00` });
    const appointments = await serviceTitanPages(`/jpm/v2/tenant/${tenant}/appointments?${params}`, { token });
    const jobIds = [...new Set(appointments.map((item) => item.jobId).filter(Boolean).map(String))];
    const jobs = [];
    for (let index = 0; index < jobIds.length; index += 50) {
      const jobParams = new URLSearchParams({ ids: jobIds.slice(index, index + 50).join(',') });
      jobs.push(...await serviceTitanPages(`/jpm/v2/tenant/${tenant}/jobs?${jobParams}`, { token, pageSize: 200, maxPages: 2 }));
    }
    const customers = await serviceTitanEntities('customers', jobs.map((item) => item.customerId), token);
    const locations = await serviceTitanEntities('locations', jobs.map((item) => item.locationId), token);
    const jobChoices = buildJobChoices({ appointments, jobs, customers, locations });
    res.json({ date, jobs: jobChoices, count: jobChoices.length, loadedAt: new Date().toISOString() });
  } catch (error) {
    console.error('ServiceTitan jobs failed:', { message: error.message, status: error.status, details: error.details });
    const permissionHint = error.status === 403 ? ' Confirm this ServiceTitan app has read access to Jobs, Appointments, Customers, and Locations.' : '';
    res.status(error.status || 502).json({ error: `${error.message}${permissionHint}` });
  }
});

app.get('/api/sharepoint/panel-records', async (req, res) => {
  if (!microsoftConfigured()) return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  try {
    const token = await getAccessToken();
    const { site, list } = await getSiteAndList(token);
    const columns = await graph(token, `/sites/${site.id}/lists/${list.id}/columns?$select=name,displayName`);
    const displayByInternal = Object.fromEntries(columns.value.map((c) => [c.name, c.displayName]));
    const items = await graph(token, `/sites/${site.id}/lists/${list.id}/items?$expand=fields&$top=200`);
    const records = items.value.map((item) => {
      const fields = {};
      for (const [key, value] of Object.entries(item.fields || {})) fields[displayByInternal[key] || key] = value;
      return indexedRecord(item, fields);
    }).sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)));
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q ? records.filter((r) => `${r.jobNumber} ${r.address} ${r.panelName} ${r.recordId}`.toLowerCase().includes(q)) : records;
    res.json({ records: filtered });
  } catch (error) {
    console.error('SharePoint history failed:', error);
    res.status(error.status || 500).json({ error: error.message || 'Past panel records could not be loaded.' });
  }
});

app.get('/api/sharepoint/panel-records/:itemId', async (req, res) => {
  if (!microsoftConfigured()) return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  try {
    const token = await getAccessToken();
    const context = await loadPanelContext(token, req.params.itemId);
    const recordFile = context.files.find((file) => file.name === `${safeName(context.indexRecord.recordId)}-record.json`)
      || context.files.find((file) => file.name.endsWith('-record.json'));
    const aiFile = context.files.find((file) => file.name === `${safeName(context.indexRecord.recordId)}-ai-analysis.json`)
      || context.files.find((file) => file.name.endsWith('-ai-analysis.json'));
    const verifiedFile = context.files.find((file) => file.name === `${safeName(context.indexRecord.recordId)}-verified-directory.json`)
      || context.files.find((file) => file.name.endsWith('-verified-directory.json'));
    const finalFile = context.files.find((file) => file.name === `${safeName(context.indexRecord.recordId)}-panel-directory.pdf`)
      || context.files.find((file) => file.name.endsWith('-panel-directory.pdf'));
    const [metadata, ai, verifiedDirectory] = await Promise.all([
      loadJsonFile(token, context.drive.id, recordFile),
      loadJsonFile(token, context.drive.id, aiFile),
      loadJsonFile(token, context.drive.id, verifiedFile),
    ]);
    if (!metadata) return res.status(404).json({ error: 'The saved panel metadata file was not found.' });
    const overview = context.files.find((file) => /overview/i.test(file.name) && file.file?.mimeType?.startsWith('image/'));
    const finalDirectoryUrl = finalFile ? `/api/sharepoint/panel-records/${encodeURIComponent(req.params.itemId)}/final-directory` : '';
    const finalization = verifiedDirectory ? {
      ...verifiedDirectory,
      rows: (verifiedDirectory.circuits || []).map((circuit) => ({
        circuit: circuit.circuit,
        amps: circuit.amps,
        breakerKind: circuit.breakerKind,
        description: circuit.description,
        confidence: 'High',
        confidenceScore: circuit.aiConfidence,
        notes: circuit.aiNotes || '',
        aiDetected: circuit.aiConfidence !== null && circuit.aiConfidence !== undefined,
        continuationOf: circuit.continuationOf,
      })),
      finalPdfUrl: finalDirectoryUrl,
    } : null;
    res.json({
      ...context.indexRecord,
      folderUrl: context.folder.webUrl || context.indexRecord.folderUrl,
      listItemId: context.indexRecord.id,
      driveId: context.drive.id,
      folderId: context.folder.id,
      record: metadata,
      aiAnalysis: ai?.analysis || metadata.ai?.analysis || null,
      aiModel: ai?.model || metadata.ai?.model || '',
      aiResponseId: ai?.responseId || metadata.ai?.responseId || '',
      finalization,
      finalPdfUrl: finalDirectoryUrl,
      overviewPhotoUrl: overview ? `/api/sharepoint/panel-records/${encodeURIComponent(req.params.itemId)}/overview-photo` : '',
    });
  } catch (error) {
    console.error('SharePoint panel detail failed:', { message: error.message, status: error.status });
    res.status(error.status || 500).json({ error: error.message || 'The saved panel record could not be opened.' });
  }
});

app.get('/api/sharepoint/panel-records/:itemId/overview-photo', async (req, res) => {
  if (!microsoftConfigured()) return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  try {
    const token = await getAccessToken();
    const context = await loadPanelContext(token, req.params.itemId);
    const overview = context.files.find((file) => /overview/i.test(file.name) && file.file?.mimeType?.startsWith('image/'));
    if (!overview) return res.status(404).json({ error: 'The panel overview photo was not found.' });
    const buffer = await graphBuffer(token, `/drives/${context.drive.id}/items/${overview.id}/content`);
    res.set('Content-Type', overview.file.mimeType || 'image/jpeg').set('Cache-Control', 'private, max-age=300').send(buffer);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'The overview photo could not be opened.' });
  }
});

app.get('/api/sharepoint/panel-records/:itemId/final-directory', async (req, res) => {
  if (!microsoftConfigured()) return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  try {
    const token = await getAccessToken();
    const context = await loadPanelContext(token, req.params.itemId);
    const finalFile = context.files.find((file) => file.name.endsWith('-panel-directory.pdf'));
    if (!finalFile) return res.status(404).json({ error: 'A final directory has not been generated for this panel yet.' });
    const buffer = await graphBuffer(token, `/drives/${context.drive.id}/items/${finalFile.id}/content`);
    const filename = `${safeName(context.indexRecord.recordId)}-panel-directory.pdf`;
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', `attachment; filename="${filename}"`).send(buffer);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'The final directory could not be downloaded.' });
  }
});

app.post('/api/sharepoint/panel-records', upload.array('photos', 20), async (req, res) => {
  if (!microsoftConfigured()) return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  if (!openAIConfigured()) return res.status(503).json({ error: 'AI processing is not configured yet. Add OPENAI_API_KEY in Railway, then retry. The panel should remain saved locally.', code: 'OPENAI_NOT_CONFIGURED' });
  try {
    const record = JSON.parse(req.body.record || '{}');
    if (!record.job?.id || !record.panel?.name || !record.recordId) return res.status(400).json({ error: 'Job, panel name, and record ID are required.' });
    if (!(req.files || []).length) return res.status(400).json({ error: 'At least one panel photo is required.' });
    const photoErrors = validatePhotoRecord(record, req.files.map((file) => file.originalname));
    if (photoErrors.length) return res.status(400).json({ error: photoErrors.join(' ') });

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

    // Analyze while the in-memory photo buffers are still available. If AI fails, the client keeps its local copy and can retry.
    const ai = await analyzePanelPhotos({ files: req.files || [], record });
    const metadata = { ...record, uploadedPhotos: uploaded, ai };
    await uploadFile(token, drive.id, panelFolder.id, `${safeName(record.recordId)}-record.json`, Buffer.from(JSON.stringify(metadata, null, 2)));
    await uploadFile(token, drive.id, panelFolder.id, `${safeName(record.recordId)}-ai-analysis.json`, Buffer.from(JSON.stringify(ai, null, 2)));

    const columns = await graph(token, `/sites/${site.id}/lists/${list.id}/columns?$select=name,displayName`);
    const internalName = (displayName) => columns.value.find((column) => column.displayName === displayName)?.name;
    const values = {
      Title: `${record.job.id} — ${record.panel.name}`,
      'ServiceTitan Job Number': String(record.job.id), 'ServiceTitan Job ID': String(record.job.serviceTitanId || record.job.id), 'Panel Record ID': record.recordId,
      'Panel Name': record.panel.name, 'Service Address': record.job.address, 'Record Status': 'AI processed — needs verification',
      'Job Note Status': 'Pending ServiceTitan connection', 'Folder Link': panelFolder.webUrl, 'Captured Photos': record.capturedCount,
      'Skipped Photos': record.skippedCount, 'Captured By': record.capturedBy || '', 'Captured At': record.capturedAt,
    };
    const item = await graph(token, `/sites/${site.id}/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ fields: { Title: values.Title } }) });
    const indexWarnings = [];
    for (const [displayName, value] of Object.entries(values)) {
      if (displayName === 'Title' || value === undefined || value === null) continue;
      const name = internalName(displayName); if (!name) continue;
      try { await graph(token, `/sites/${site.id}/lists/${list.id}/items/${item.id}/fields`, { method: 'PATCH', body: JSON.stringify({ [name]: value }) }); }
      catch (error) { indexWarnings.push(`${displayName}: ${error.message}`); console.warn('SharePoint index field skipped:', { displayName, internalName: name, status: error.status, code: error.code, pathname: error.pathname, message: error.message }); }
    }
    res.status(201).json({
      recordId: record.recordId, folderUrl: panelFolder.webUrl, driveId: drive.id, folderId: panelFolder.id, listItemId: item.id, uploadedCount: uploaded.length, indexWarnings,
      aiAnalysis: ai.analysis, aiModel: ai.model, aiResponseId: ai.responseId,
    });
  } catch (error) {
    console.error('Panel upload/AI processing failed:', { message: error.message, status: error.status, code: error.code, pathname: error.pathname, details: error.details, stack: error.stack });
    res.status(error.status || 500).json({ error: error.message || 'The panel record could not be processed.', code: error.code || null });
  }
});

app.post('/api/sharepoint/panel-records/finalize', express.json({ limit: '1mb' }), async (req, res) => {
  if (!microsoftConfigured()) return res.status(503).json({ error: 'The Microsoft connection has not been configured on Railway yet.' });
  try {
    const directory = normalizeVerifiedDirectory(req.body);
    const token = await getAccessToken();
    const { site, list } = await getSiteAndList(token);
    const folder = await resolvePanelFolder(token, req.body || {});
    const pdf = await createFinalDirectoryPdf(directory);
    const baseName = safeName(directory.recordId);
    const jsonFile = await uploadFile(token, folder.driveId, folder.folderId, `${baseName}-verified-directory.json`, Buffer.from(JSON.stringify(directory, null, 2)));
    const pdfFile = await uploadFile(token, folder.driveId, folder.folderId, `${baseName}-panel-directory.pdf`, pdf);

    const columns = await graph(token, `/sites/${site.id}/lists/${list.id}/columns?$select=name,displayName`);
    const internalName = (displayName) => columns.value.find((column) => column.displayName === displayName)?.name;
    const listItemId = String(req.body?.listItemId || '').trim();
    const indexWarnings = [];
    if (listItemId) {
      const values = {
        'Record Status': 'Verified — final directory saved',
        'Verified By': directory.verifiedBy,
        'Verified At': directory.verifiedAt,
        'Final Directory Link': pdfFile.webUrl,
      };
      for (const [displayName, value] of Object.entries(values)) {
        const name = internalName(displayName);
        if (!name) {
          if (displayName !== 'Record Status') indexWarnings.push(`${displayName}: SharePoint index column not present`);
          continue;
        }
        try { await graph(token, `/sites/${site.id}/lists/${list.id}/items/${encodeURIComponent(listItemId)}/fields`, { method: 'PATCH', body: JSON.stringify({ [name]: value }) }); }
        catch (error) { indexWarnings.push(`${displayName}: ${error.message}`); }
      }
    } else {
      indexWarnings.push('SharePoint index item ID was not available; final files were saved but the list status was not updated.');
    }

    res.status(201).json({
      recordId: directory.recordId,
      verificationStatus: directory.verificationStatus,
      verifiedBy: directory.verifiedBy,
      verifiedAt: directory.verifiedAt,
      folderUrl: folder.folderUrl,
      finalPdfUrl: pdfFile.webUrl,
      verifiedDirectoryUrl: jsonFile.webUrl,
      indexWarnings,
    });
  } catch (error) {
    console.error('Panel finalization failed:', { message: error.message, status: error.status, code: error.code, pathname: error.pathname, details: error.details, stack: error.stack });
    res.status(error.status || 500).json({ error: error.message || 'The verified panel directory could not be saved.', code: error.code || null });
  }
});

const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(root, 'dist')));
app.use((_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
app.listen(PORT, () => console.log(`GEN3 Panel Labeler listening on port ${PORT}`));
