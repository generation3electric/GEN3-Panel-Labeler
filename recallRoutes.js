import { normalizePhotoSource } from './src/sharedPhotoModel.js';
import multer from 'multer';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { checkRecalls, applyDecisions } from './recallCheck.js';
import { identifyRecallPhotos } from './recallIdentity.js';

const key = process.env.MS_AUTH_CLIENT_SECRET || randomBytes(32).toString('hex');
const idPattern = /^RC-\d{13}-[0-9a-f-]{36}$/;
const sign = (value) => createHmac('sha256', key).update(`recall-v1:${value}`).digest('base64url');
export function seal(value) { const body = Buffer.from(JSON.stringify(value)).toString('base64url'); return `${body}.${sign(body)}`; }
export function unseal(value) {
  const [body, signature, extra] = String(value || '').split('.');
  const expected = sign(body || '');
  if (extra || !signature || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw Object.assign(new Error('The check could not be verified. Run the recall lookup again.'), { status: 400 });
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function validateImages(files, requireOverview = false) {
  if (requireOverview && !files.some((f) => f.fieldname === 'overview')) fail('An overall panel photo is required.');
  if (!files.length || files.length > 6 || files.reduce((n, f) => n + f.size, 0) > 45 * 1024 * 1024) fail('Use one to six photos totaling no more than 45 MB.');
  for (const file of files) {
    const b = file.buffer;
    const jpeg = b?.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
    const png = b?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp = b?.toString('ascii', 0, 4) === 'RIFF' && b?.toString('ascii', 8, 12) === 'WEBP';
    if (!(file.mimetype === 'image/jpeg' && jpeg || file.mimetype === 'image/png' && png || file.mimetype === 'image/webp' && webp)) fail('Use readable JPEG, PNG, or WebP photos. Convert HEIC images before uploading.');
  }
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 6, fields: 2, fieldSize: 2 * 1024 * 1024 } }).fields([{ name: 'overview', maxCount: 1 }, { name: 'label', maxCount: 1 }, { name: 'detail', maxCount: 4 }]);
const allFiles = (req) => Object.values(req.files || {}).flat();
function employee(req) {
  try { const user = JSON.parse(Buffer.from(String(req.headers['x-gen3-employee'] || ''), 'base64url').toString()); if (user.id && user.name) return { id: String(user.id), name: String(user.name), email: String(user.email || '') }; } catch {}
  fail('Sign in with your GEN3 account before saving a check.', 401);
}
function parseRecord(req) { try { return JSON.parse(req.body.record); } catch { fail('The recall check form is invalid.'); } }
const bounded = (value, n = 500) => typeof value === 'string' ? value.trim().slice(0, n) : '';
export function registerRecallRoutes(app, storage) {
  const { getAccessToken, getSiteListAndDrive, graph, graphBuffer, ensureFolder, uploadFile, jobNotes } = storage;
  const route = (fn) => async (req, res) => { res.set('Cache-Control', 'private, no-store'); try { await fn(req, res); } catch (error) { console.warn('Recall check:', error.message); res.status(error.status || 500).json({ error: error.status ? error.message : 'The recall check could not be completed. Your photos have not been cleared; retry in a moment.' }); } };
  const multipart = (req, res, next) => upload(req, res, (error) => error ? res.status(400).json({ error: 'Use up to six JPEG, PNG, or WebP photos, each under 12 MB.' }) : next());
  async function context() { const token = await getAccessToken(); const { drive } = await getSiteListAndDrive(token); return { token, drive }; }
  function recordPath(drive, id) { if (!idPattern.test(id)) fail('Invalid recall check ID.'); return `/drives/${drive.id}/root:/Recall Checks/${id}`; }
  async function read(ctx, id) { const bytes = await graphBuffer(ctx.token, `${recordPath(ctx.drive, id)}/record.json:/content`); return JSON.parse(bytes.toString()); }

  app.post('/api/recall-checks/identify', multipart, route(async (req, res) => {
    const files = allFiles(req); validateImages(files);
    res.json(await identifyRecallPhotos(files));
  }));
  app.post('/api/recall-checks/lookup', route(async (req, res) => {
    if (req.body.reviewed !== true) fail('Review the label readings before checking recalls.');
    const snapshot = await checkRecalls(req.body.identification);
    res.json({ snapshot, evidence: seal(snapshot) });
  }));
  app.post('/api/recall-checks', multipart, route(async (req, res) => {
    const user = employee(req), input = parseRecord(req), files = allFiles(req);
    validateImages(files, true);
    if (!idPattern.test(input.id)) fail('Invalid recall check ID.');
    if (!files.some((file) => file.fieldname === 'label') && !bounded(input.labelUnavailable)) fail('Photograph the manufacturer label or document why it is unavailable.');
    const snapshot = unseal(input.evidence);
    if (!snapshot.checkedAt || Date.now() - Date.parse(snapshot.checkedAt) > 24 * 3600000) fail('This lookup is more than 24 hours old. Run it again before saving.');
    const decision = applyDecisions(snapshot, input.decisions);
    const job = input.job ? { id: bounded(input.job.id), serviceTitanId: bounded(input.job.serviceTitanId), customer: bounded(input.job.customer), address: bounded(input.job.address) } : null;
    const inputHash = createHash('sha256').update(JSON.stringify({ evidence: input.evidence, decisions: decision.decisions, job, panelName: bounded(input.panelName), notes: bounded(input.notes, 4000), labelUnavailable: bounded(input.labelUnavailable) }));
    files.forEach((file) => { inputHash.update(file.fieldname); inputHash.update(file.buffer); });
    const photoSources = Array.isArray(input.photoSources) ? input.photoSources.slice(0,6).map(p => ({ role: bounded(p.role,20), source: normalizePhotoSource(p.source) })) : [];
    if (photoSources.some(p => p.source)) inputHash.update(JSON.stringify(photoSources));
    const fingerprint = inputHash.digest('hex');
    const ctx = await context();
    try {
      const existing = await read(ctx, input.id);
      if (existing.fingerprint !== fingerprint) fail('This check was already saved with different details. Open it in Recall Check History or start a new check.', 409);
      return res.json({ ...existing, jobNote: await jobNotes?.publish('recall', existing) });
    } catch (error) { if (error.status !== 404) throw error; }
    const root = await ensureFolder(ctx.token, ctx.drive.id, null, 'Recall Checks');
    const folder = await ensureFolder(ctx.token, ctx.drive.id, root.id, input.id);
    const photos = []; const roleCounts = {};
    for (const [index, file] of files.entries()) {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype];
      const name = `photo-${file.fieldname}-${index}.${ext}`;
      await uploadFile(ctx.token, ctx.drive.id, folder.id, name, file.buffer);
      const position = roleCounts[file.fieldname] || 0; roleCounts[file.fieldname] = position + 1;
      const source = photoSources.filter(p => p.role === file.fieldname)[position]?.source;
      photos.push({ role: file.fieldname, name, ...(source ? {source} : {}), url: `/api/recall-checks/${input.id}/photos/${name}` });
    }
    const record = { id: input.id, fingerprint, panelName: bounded(input.panelName) || 'Main Panel', job, notes: bounded(input.notes, 4000), labelUnavailable: bounded(input.labelUnavailable),
      snapshot, ...decision, checkedBy: user, savedAt: new Date().toISOString(), folderUrl: folder.webUrl, photos };
    // Manifest is written last. A partial photo upload is never a saved check.
    await uploadFile(ctx.token, ctx.drive.id, folder.id, 'record.json', Buffer.from(JSON.stringify(record, null, 2)));
    res.status(201).json({ ...record, jobNote: await jobNotes?.publish('recall', record) });
  }));
  app.get('/api/recall-checks', route(async (req, res) => {
    const ctx = await context();
    const firstPath = `/drives/${ctx.drive.id}/root:/Recall Checks:/children?$select=id,name,folder&$orderby=name%20desc&$top=30`;
    let pathname = firstPath;
    if (req.query.cursor) {
      const cursor = unseal(req.query.cursor);
      if (cursor.drive !== ctx.drive.id || cursor.kind !== 'recall-history') fail('Invalid history page.');
      pathname = cursor.path;
    }
    let page;
    try { page = await graph(ctx.token, pathname); } catch (error) { if (error.status === 404 && !req.query.cursor) return res.json({ records: [], next: null, incomplete: 0 }); throw error; }
    const folders = (page.value || []).filter((item) => item.folder && idPattern.test(item.name));
    const records = []; let incomplete = 0;
    for (let i = 0; i < folders.length; i += 5) {
      const results = await Promise.allSettled(folders.slice(i, i + 5).map((folder) => read(ctx, folder.name)));
      for (const result of results) {
        if (result.status !== 'fulfilled') { incomplete++; continue; }
        const r = result.value;
        records.push({ id: r.id, panelName: r.panelName, job: r.job, status: r.status, checkedAt: r.snapshot.checkedAt, savedAt: r.savedAt, manufacturer: r.snapshot.identification.manufacturer, model: r.snapshot.identification.model, checkedBy: r.checkedBy.name });
      }
    }
    let next = null;
    if (page['@odata.nextLink']) {
      const url = new URL(page['@odata.nextLink']);
      if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/')) fail('Invalid history continuation.', 502);
      next = seal({ kind: 'recall-history', drive: ctx.drive.id, path: url.pathname.slice('/v1.0'.length) + url.search });
    }
    res.json({ records, next, incomplete });
  }));
  app.get('/api/recall-checks/:id', route(async (req, res) => res.json(await read(await context(), req.params.id))));
  for (const method of ['get', 'post']) app[method]('/api/recall-checks/:id/job-note', route(async (req, res) => {
    const record = await read(await context(), req.params.id);
    res.json(await jobNotes[method === 'post' ? 'publish' : 'get']('recall', record));
  }));
  app.get('/api/recall-checks/:id/photos/:name', route(async (req, res) => {
    if (!/^photo-(overview|label|detail)-[0-5]\.(jpg|png|webp)$/.test(req.params.name)) fail('Invalid recall photo.');
    const ctx = await context();
    const record = await read(ctx, req.params.id);
    if (!record.photos.some((photo) => photo.name === req.params.name)) fail('Photo not found.', 404);
    const bytes = await graphBuffer(ctx.token, `${recordPath(ctx.drive, req.params.id)}/${req.params.name}:/content`);
    res.set('X-Content-Type-Options', 'nosniff').type(req.params.name.split('.').pop()).send(bytes);
  }));
}
