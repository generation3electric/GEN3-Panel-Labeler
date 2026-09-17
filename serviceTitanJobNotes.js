import { createHash } from 'node:crypto';

const TITLES = { inspection: 'Panel inspection report', recall: 'Panel recall check', directory: 'Verified panel directory' };
const clean = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const https = value => { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('A secure saved report link is required.'); return u.href; };
export function noteKey(kind, id) {
  if (!TITLES[kind] || !id || String(id).length > 200) throw new Error('Invalid report reference.');
  return createHash('sha256').update(`${kind}:${id}`).digest('hex');
}
export function buildReportNote(kind, record, publicUrl) {
  const id = record.id || record.recordId;
  const key = noteKey(kind, id);
  // A customer/location reference or displayed job number is never an API job ID.
  const jobId = String(record.job?.serviceTitanId || '');
  if (!/^[1-9]\d*$/.test(jobId) || record.job?.referenceType === 'location') return null;
  const appPath = kind === 'inspection' ? '/panel-inspection' : '/recall-check';
  const reportUrl = kind === 'directory' ? https(record.finalPdfUrl) : kind === 'inspection' && record.reportUrl
    ? https(record.reportUrl) : https(`${String(publicUrl || '').replace(/\/$/, '')}${appPath}?id=${encodeURIComponent(id)}`);
  const person = record.reviewedBy?.name || record.checkedBy?.name || record.verifiedBy || 'GEN3 technician';
  const completed = record.savedAt || record.verifiedAt;
  if (!Number.isFinite(Date.parse(completed))) throw new Error('A saved completion date is required.');
  const marker = `GEN3-REPORT-${key}`;
  const text = `<p><strong>GEN3 ${escape(TITLES[kind])}</strong></p>` +
    `<p>Panel: ${escape(clean(record.panelName || record.panel?.name || 'Panel'))}<br>` +
    `Job: ${escape(clean(record.job.id))}<br>Completed by: ${escape(clean(person))}<br>` +
    `Completed: ${escape(new Date(completed).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }))}</p>` +
    `<p><a href="${escape(reportUrl)}">Open ${escape(TITLES[kind].toLowerCase())}</a>` +
    (record.folderUrl ? `<br><a href="${escape(https(record.folderUrl))}">Open saved photos and files</a>` : '') +
    `</p><p>${marker}</p>`;
  return { key, kind, recordId: id, jobId, marker, text, reportUrl };
}
const status = (state, message, extra = {}) => ({ status: state, message, ...extra });
const NOT_LINKED = status('not_linked', 'Saved without a ServiceTitan job link. No job note was added.');
const NOT_SENT = status('not_sent', 'This report has not been linked in the job notes yet.');
const UNCERTAIN = 'ServiceTitan has not confirmed the note. Check again to look for it; the app will not send a duplicate while delivery is uncertain.';
function failure(error) {
  if ([401, 403].includes(error.status)) return 'ServiceTitan denied access. Enable Jobs read and write access for this integration, then retry.';
  if (error.status === 404) return 'The linked ServiceTitan job was not found. Check the job link before retrying.';
  return 'The report is saved, but its ServiceTitan job note could not be added. Retry when the connection is available.';
}

export function createJobNotePublisher({ store, serviceTitan, tenantId, publicUrl }) {
  const active = new Map();
  async function get(kind, record) {
    if (!/^[1-9]\d*$/.test(String(record.job?.serviceTitanId || '')) || record.job?.referenceType === 'location') return NOT_LINKED;
    try { return (await store.read(noteKey(kind, record.id || record.recordId)))?.delivery || NOT_SENT; }
    catch { return status('unavailable', 'The report is saved. Job-note status could not be loaded; retry to check it.'); }
  }
  async function publish(kind, record) {
    let note;
    try { note = buildReportNote(kind, record, publicUrl); }
    catch { return status('failed', 'The report is saved, but its job-note link could not be prepared. Check the app URL and saved report link.'); }
    if (!note) return NOT_LINKED;
    if (active.has(note.key)) return active.get(note.key);
    const work = (async () => {
      try {
        return await store.withLock(note.key, async () => {
          let saved = await store.read(note.key);
          if (saved?.delivery.status === 'sent') return saved.delivery;
          if (saved && saved.note.jobId !== note.jobId) return status('failed', 'The saved note belongs to another job. Contact the office to correct the report link.');
          // Persist intent before contacting ServiceTitan. Retries reuse the original note.
          saved ||= { note, delivery: NOT_SENT };
          note = saved.note;
          const wasUncertain = ['sending', 'uncertain'].includes(saved.delivery.status);
          const persist = async delivery => { saved = { note, delivery }; await store.write(note.key, saved); return delivery; };
          let posting = false;
          try {
            const signal = AbortSignal.timeout(30000);
            const base = `/jpm/v2/tenant/${encodeURIComponent(tenantId)}/jobs/${note.jobId}/notes`;
            let finished = false;
            for (let page = 1; page <= 100; page++) {
              const notes = await serviceTitan(`${base}?page=${page}&pageSize=200`, { signal });
              if (!Array.isArray(notes?.data) || typeof notes.hasMore !== 'boolean') throw new Error('Incomplete job note response');
              if (notes.data.some(n => String(n.text || '').includes(note.marker))) {
                return await persist(status('sent', 'Report link added to ServiceTitan job notes.', { confirmedAt: new Date().toISOString() }));
              }
              if (!notes.hasMore) { finished = true; break; }
            }
            if (!finished) throw new Error('Job note scan incomplete');
            if (wasUncertain) return await persist(status('uncertain', UNCERTAIN));
            await persist(status('sending', UNCERTAIN, { attemptedAt: new Date().toISOString() }));
            posting = true;
            await serviceTitan(base, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: note.text, pinToTop: false }) });
            return await persist(status('sent', 'Report link added to ServiceTitan job notes.', { confirmedAt: new Date().toISOString() }));
          } catch (error) {
            // Network/5xx failures after POST may have committed. Reconcile only on retry.
            const uncertain = wasUncertain || (posting && (!error.status || error.status >= 500 || error.status === 408));
            const delivery = status(uncertain ? 'uncertain' : 'failed', uncertain ? UNCERTAIN : failure(error));
            try { await persist(delivery); } catch { /* The earlier sending receipt remains recoverable. */ }
            return delivery;
          }
        });
      } catch (error) {
        if (error.status === 409) return status('pending', 'The job note is being processed. Check again shortly.');
        return status('unavailable', 'The report is saved. Job-note tracking is unavailable; retry to check and add its link.');
      }
    })();
    active.set(note.key, work);
    try { return await work; } finally { active.delete(note.key); }
  }
  return { get, publish };
}

// Separate receipts keep immutable reports intact. A SharePoint folder is an atomic
// cross-process lock, including during overlapping Railway deployments.
export function createSharePointNoteStore({ getAccessToken, getSiteListAndDrive, graph, graphBuffer, ensureFolder, uploadFile }) {
  async function context() { const token = await getAccessToken(); const { drive } = await getSiteListAndDrive(token); return { token, drive }; }
  const path = (drive, key) => `/drives/${drive.id}/root:/ServiceTitan Job Notes/${key}.json`;
  return {
    async read(key) {
      const { token, drive } = await context();
      try { return JSON.parse((await graphBuffer(token, `${path(drive, key)}:/content`)).toString()); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async write(key, value) {
      const { token, drive } = await context();
      const root = await ensureFolder(token, drive.id, null, 'ServiceTitan Job Notes');
      await uploadFile(token, drive.id, root.id, `${key}.json`, Buffer.from(JSON.stringify(value)));
    },
    async withLock(key, run) {
      const { token, drive } = await context();
      const root = await ensureFolder(token, drive.id, null, 'ServiceTitan Job Notes');
      const lockName = `${key}.lock`;
      const create = () => graph(token, `/drives/${drive.id}/items/${root.id}/children`, { method: 'POST', body: JSON.stringify({ name: lockName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
      let lock;
      try { lock = await create(); }
      catch (e) {
        if (e.status !== 409) throw e;
        const old = await graph(token, `/drives/${drive.id}/items/${root.id}:/${lockName}`);
        if (!old.eTag || !Number.isFinite(Date.parse(old.createdDateTime)) || Date.now() - Date.parse(old.createdDateTime) < 10 * 60000) throw e;
        await graph(token, `/drives/${drive.id}/items/${old.id}`, { method: 'DELETE', headers: { 'If-Match': old.eTag } });
        lock = await create();
      }
      try { return await run(); }
      finally { try { await graph(token, `/drives/${drive.id}/items/${lock.id}`, { method: 'DELETE' }); } catch { /* Stale lock can be reclaimed after ten minutes. */ } }
    },
  };
}
