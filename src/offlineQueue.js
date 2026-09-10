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

export async function markPanelUploaded(recordId, receipt = {}) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const item = await requestResult(store.get(recordId));
  if (!item) return;
  // Important: only clear image blobs after the server confirms a successful upload.
  store.put({
    ...item,
    status: 'uploaded',
    photos: [],
    uploadedAt: new Date().toISOString(),
    receipt: {
      recordId: receipt.recordId || recordId,
      folderUrl: receipt.folderUrl || '',
      listItemId: receipt.listItemId || '',
      uploadedCount: receipt.uploadedCount ?? null,
    },
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
  return items.filter((item) => item.status !== 'uploaded');
}

export async function getPendingCount() {
  const items = await getPendingPanels();
  return items.length;
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
