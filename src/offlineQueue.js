const DB_NAME = 'gen3-panel-labeler';
const DB_VERSION = 1;
const STORE = 'pending-panels';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'recordId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePendingPanel(record) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ ...record, status: 'pending', savedLocallyAt: record.savedLocallyAt || new Date().toISOString() });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePendingPanel(recordId) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(recordId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function uploadedPanelRecord(item, receipt = {}, uploadedAt = new Date().toISOString()) {
  return {
    ...item,
    status: 'uploaded',
    // The original image blobs are cleared only after a confirmed server upload.
    // Keep the complete lightweight receipt so the AI result can be reopened.
    photos: [],
    uploadedAt,
    receipt: {
      ...receipt,
      recordId: receipt.recordId || item.recordId,
      folderUrl: receipt.folderUrl || '',
      listItemId: receipt.listItemId || '',
      uploadedCount: receipt.uploadedCount ?? null,
    },
  };
}

export async function markPanelUploaded(recordId, receipt = {}) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const item = await requestResult(store.get(recordId));
  if (!item) return;
  store.put(uploadedPanelRecord(item, receipt));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markPanelFinalized(recordId, finalization = {}) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const item = await requestResult(store.get(recordId));
  if (!item) return;
  store.put({
    ...item,
    status: 'finalized',
    finalizedAt: finalization.verifiedAt || new Date().toISOString(),
    receipt: { ...(item.receipt || {}), finalization },
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllLocalPanels() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  return requestResult(tx.objectStore(STORE).getAll()).then((items) => items || []);
}

export async function getPendingPanels() {
  const items = await getAllLocalPanels();
  return items.filter((item) => item.status !== 'uploaded' && item.status !== 'finalized');
}

export async function getPendingCount() {
  const items = await getPendingPanels();
  return items.length;
}

export function splitLocalPanels(items = []) {
  const sorted = [...items].sort((a, b) => {
    const aDate = a.finalizedAt || a.uploadedAt || a.savedLocallyAt || a.record?.capturedAt || '';
    const bDate = b.finalizedAt || b.uploadedAt || b.savedLocallyAt || b.record?.capturedAt || '';
    return String(bDate).localeCompare(String(aDate));
  });
  return {
    pending: sorted.filter((item) => item.status !== 'uploaded' && item.status !== 'finalized'),
    uploaded: sorted.filter((item) => item.status === 'uploaded' || item.status === 'finalized'),
  };
}

export function panelToFormData(item) {
  const form = new FormData();
  form.append('record', JSON.stringify(item.record));
  (item.photos || []).forEach((photo) => {
    const file = photo.file instanceof File ? photo.file : new File([photo.file], photo.name, { type: photo.type || 'image/jpeg' });
    form.append('photos', file, photo.name);
  });
  return form;
}
