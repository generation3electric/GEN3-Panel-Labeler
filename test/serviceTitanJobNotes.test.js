import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportNote, createJobNotePublisher, createSharePointNoteStore } from '../serviceTitanJobNotes.js';

const record = { id: 'INS-123', job: { id: '987', serviceTitanId: '12345' }, panelName: 'Main <Panel>', reviewedBy: { name: 'Test Technician' }, savedAt: '2026-09-17T18:00:00Z', folderUrl: 'https://example.sharepoint.com/panel', reportUrl: 'https://example.sharepoint.com/report.pdf' };
function setup() {
  const receipts = new Map(), calls = [], notes = [];
  let postError, readError, pages, failWrite = false;
  const store = {
    read: async key => receipts.get(key),
    write: async (key, data) => { if (failWrite) throw new Error('Storage offline'); receipts.set(key, structuredClone(data)); },
    withLock: async (_key, run) => run(),
  };
  const api = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (options.method === 'POST') {
      if (postError) throw postError;
      const note = JSON.parse(options.body); notes.push(note); return note;
    }
    if (readError) throw readError;
    return pages ? pages(url) : { data: notes, hasMore: false };
  };
  const publisher = () => createJobNotePublisher({ store, serviceTitan: api, tenantId: '42', publicUrl: 'https://panel.example.com' });
  return { receipts, calls, notes, store, publisher, setPostError: e => postError = e, setReadError: e => readError = e, setPages: p => pages = p, failWrite: () => failWrite = true };
}
test('notes use API job ID, secure report links, escaped panel names, employee and saved completion date', () => {
  const n = buildReportNote('inspection', record, 'https://panel.example.com');
  assert.equal(n.jobId, '12345'); assert.match(n.text, /Main &lt;Panel&gt;/); assert.match(n.text, /Test Technician/);
  assert.match(n.text, /href="https:\/\/example.sharepoint.com\/report.pdf"/); assert.match(n.text, /9\/17\/2026/);
  assert.equal(buildReportNote('inspection', { ...record, job: { id: '987' } }, ''), null);
  assert.equal(buildReportNote('inspection', { ...record, job: { serviceTitanId: '123', referenceType: 'location' } }, ''), null);
  assert.equal(buildReportNote('inspection', { ...record, job: null }, ''), null);
  assert.throws(() => buildReportNote('inspection', { ...record, reportUrl: 'javascript:alert(1)' }, ''));
  assert.match(buildReportNote('recall', { ...record, id: 'RC-123' }, 'https://panel.example.com').reportUrl, /recall-check\?id=RC-123/);
  assert.equal(buildReportNote('directory', { ...record, id: undefined, recordId: 'panel-123', finalPdfUrl: 'https://example.sharepoint.com/directory.pdf' }, '').reportUrl, 'https://example.sharepoint.com/directory.pdf');
});
test('concurrent saves, repeat saves and process restarts create one job note', async () => {
  const h = setup(), p = h.publisher();
  const results = await Promise.all([p.publish('inspection', record), p.publish('inspection', record)]);
  assert.ok(results.every(r => r.status === 'sent'));
  assert.equal((await h.publisher().publish('inspection', record)).status, 'sent');
  const posts = h.calls.filter(c => c.method === 'POST'); assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/jpm/v2/tenant/42/jobs/12345/notes'); assert.equal(JSON.parse(posts[0].body).pinToTop, false);
});
test('permission failure is saved and recoverable without resaving the report', async () => {
  const h = setup(); h.setPostError(Object.assign(new Error('Forbidden'), { status: 403 }));
  const p = h.publisher(); assert.equal((await p.publish('inspection', record)).status, 'failed');
  assert.match((await p.get('inspection', record)).message, /read and write/);
  h.setPostError(null); assert.equal((await p.publish('inspection', record)).status, 'sent'); assert.equal(h.notes.length, 1);
});
test('uncertain POST reconciles existing remote note and never blindly posts again', async () => {
  const h = setup(); h.setPostError(new Error('Connection lost after send'));
  assert.equal((await h.publisher().publish('inspection', record)).status, 'uncertain');
  h.setPostError(null); assert.equal((await h.publisher().publish('inspection', record)).status, 'uncertain');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  h.notes.push({ text: buildReportNote('inspection', record, '').text });
  assert.equal((await h.publisher().publish('inspection', record)).status, 'sent');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});
test('all job-note pages are checked before sending and remote receipt repairs missing local receipt', async () => {
  const h = setup(); h.setPages(url => url.includes('page=1&') ? { data: [{ text: 'Other note' }], hasMore: true } : { data: [{ text: buildReportNote('inspection', record, '').text }], hasMore: false });
  assert.equal((await h.publisher().publish('inspection', record)).status, 'sent');
  assert.equal(h.calls.length, 2); assert.equal(h.notes.length, 0);
});
test('unavailable or malformed notes response never causes a blind POST', async () => {
  const h = setup(); h.setReadError(new Error('Offline'));
  assert.equal((await h.publisher().publish('inspection', record)).status, 'failed');
  h.setReadError(null); h.setPages(() => ({ data: [] }));
  assert.equal((await h.publisher().publish('inspection', record)).status, 'failed');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});
test('failed persistent receipt prevents POST; standalone reports never touch either service', async () => {
  const h = setup(); h.failWrite();
  assert.equal((await h.publisher().publish('inspection', record)).status, 'failed');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  h.calls.length = 0;
  assert.equal((await h.publisher().publish('inspection', { ...record, job: null })).status, 'not_linked');
  assert.equal(h.calls.length, 0);
});
test('saved sending state after process crash is reconciliation-only', async () => {
  const h = setup(), note = buildReportNote('inspection', record, '');
  h.receipts.set(note.key, { note, delivery: { status: 'sending' } });
  assert.equal((await h.publisher().publish('inspection', record)).status, 'uncertain');
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
});
test('another process lock leaves report saved with pending status', async () => {
  const h = setup(); h.store.withLock = async () => { throw Object.assign(new Error('Conflict'), { status: 409 }); };
  assert.equal((await h.publisher().publish('inspection', record)).status, 'pending'); assert.equal(h.calls.length, 0);
});
test('SharePoint locks are atomic, release after errors and stale recovery uses conditional delete', async () => {
  const calls = []; let exists = false, stale = false;
  const store = createSharePointNoteStore({ getAccessToken: async () => 'token', getSiteListAndDrive: async () => ({ drive: { id: 'drive' } }), ensureFolder: async () => ({ id: 'root' }), graph: async (token, path, options = {}) => {
    calls.push({ path, ...options });
    if (options.method === 'POST') { if (exists) throw Object.assign(new Error('Conflict'), { status: 409 }); exists = true; return { id: 'lock' }; }
    if (options.method === 'DELETE') { exists = false; return; }
    return { id: 'lock', eTag: 'etag', createdDateTime: new Date(Date.now() - (stale ? 11 : 1) * 60000).toISOString() };
  } });
  await assert.rejects(store.withLock('key', async () => { throw new Error('Operation failed'); }), /Operation failed/);
  assert.equal(exists, false);
  exists = true; await assert.rejects(store.withLock('key', async () => {}), /Conflict/);
  stale = true; await store.withLock('key', async () => 'done');
  assert.ok(calls.some(c => c.method === 'DELETE' && c.headers?.['If-Match'] === 'etag'));
});
