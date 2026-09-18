import { getAllLocalPanels } from './offlineQueue.js';
import { recallDraft } from './recallDraft.js';
import { inspectionDraft, preparePhoto } from './inspection/draft.js';
import { canonicalRole, roleFromFilename, validateAssignments } from './sharedPhotoModel.js';

export const HISTORY_URLS = { directory: '/api/sharepoint/panel-records', recall: '/api/recall-checks', inspection: '/api/panel-inspections' };
export async function readJson(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw new Error(r.status === 401 ? 'Sign in again to see shared photos.' : 'Saved photos could not be loaded. Retry when connected.');
  return r.json();
}
export function summarize(kind, r, local = false) {
  return { key: `${local ? 'local' : 'saved'}:${kind}:${r.id || r.recordId}`, kind, id: r.id || r.recordId, recordId: r.recordId || r.id, local,
    panelName: r.panelName || r.panel?.name || 'Panel', job: r.job || (r.jobNumber ? { id: r.jobNumber, serviceTitanId: r.serviceTitanId, address: r.address } : null),
    date: r.savedAt || r.capturedAt || r.checkedAt || '', record: local ? r : undefined };
}
export async function localPhotoSources() {
  const results = await Promise.allSettled([getAllLocalPanels(), recallDraft('get'), inspectionDraft('get'), labelerPhotoDraft('get')]);
  const sources = [], warnings = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') { warnings.push('Some photos saved on this device could not be read.'); return; }
    if (i === 0) for (const item of r.value) {
      if (item.photos?.length) sources.push({ ...summarize('directory', { ...item.record, id: item.recordId }, true), photos: item.photos.map((p, n) => ({ ...p, key: `local-${n}`, role: roleFromFilename(p.name) })) });
    } else if (r.value?.photos?.length) {
      const kind = ['','recall','inspection','directory'][i];
      sources.push({ ...summarize(kind, r.value, true), photos: r.value.photos.map((p, n) => ({ ...p, key: p.id || `local-${n}`, role: canonicalRole(p.role) })) });
    }
  });
  return { sources, warnings };
}
export async function sourceDetails(source, signal) {
  if (source.local) return source;
  const url = `${HISTORY_URLS[source.kind]}/${encodeURIComponent(source.id)}`;
  const r = await readJson(url, signal);
  if (source.kind === 'directory') {
    const gallery = await readJson(`${url}/photos`, signal);
    return { ...source, record: r.record, panelName: r.record.panel.name, job: r.record.job,
      photos: gallery.photos.map(p => ({ ...p, key: p.id, role: roleFromFilename(p.name), source: r.record.photoSteps?.find(step => step.filename === p.name)?.source })) };
  }
  return { ...source, record: r, job: r.job, photos: r.photos.map((p, n) => ({ ...p, key: p.id || p.name || String(n), role: canonicalRole(p.role) })) };
}
export async function importPhotos(source, target, assignments, existing, signal) {
  const selected = validateAssignments(target, source.photos, assignments, existing);
  const photos = [];
  // Prepare everything before changing the target draft; a failed download changes nothing.
  for (const p of selected) {
    let file = p.file;
    if (!file) {
      const url = String(p.url || '');
      if (!/^\/api\/(sharepoint\/panel-records|panel-inspections|recall-checks)\/[^?#]+\/photos\/[^?#]+$/.test(url)) throw new Error('The saved photo link is invalid.');
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('A saved photo could not be downloaded. Your current photos are unchanged.');
      const blob = await response.blob();
      file = new File([blob], p.name || 'panel-photo.jpg', { type: blob.type });
    }
    if (signal?.aborted) throw new Error('Photo import cancelled.');
    // All destinations accept JPEG; use the existing bounded image preparation.
    file = await preparePhoto(file);
    photos.push({ id: `p-${crypto.randomUUID()}`, role: assignments[p.key], file,
      source: { kind: source.kind, recordId: source.recordId, photoKey: p.key, sourceDate: p.source?.sourceDate || source.date || '', reusedAt: new Date().toISOString(), currentConditionConfirmed: true } });
  }
  const total = [...existing, ...photos].reduce((n, p) => n + (p.file?.size || 0), 0);
  if (photos.some(p => p.file.size > 12 * 1024 * 1024) || total > (target === 'recall' ? 45 : 60) * 1024 * 1024) throw new Error('These photos exceed this section’s upload limits. Select fewer photos.');
  return photos;
}
// One reusable in-progress directory capture on this device. Successful upload clears
// it; completed/pending records remain available through their normal stores.
export async function labelerPhotoDraft(action, value) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('gen3-shared-panel-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite'), s = tx.objectStore('drafts');
    const r = action === 'get' ? s.get('directory') : action === 'delete' ? s.delete('directory') : s.put(value, 'directory');
    tx.oncomplete = () => { db.close(); resolve(r.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Photo draft could not be saved.')); };
  });
}
export async function clearLabelerPhotoDraft(id) {
  if (!id) return;
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('gen3-shared-panel-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), s = tx.objectStore('drafts');
    const r = s.get('directory'); r.onsuccess = () => { if (r.result?.id === id) s.delete('directory'); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
