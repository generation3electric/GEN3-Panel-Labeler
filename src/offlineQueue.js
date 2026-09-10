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

function txRequest(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    try { result = action(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  }));
}

export async function savePendingPanel(record) {
  return txRequest('readwrite', (store) => store.put(record));
}

export async function deletePendingPanel(recordId) {
  return txRequest('readwrite', (store) => store.delete(recordId));
}

export async function getPendingPanels() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getPendingCount() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}

export function panelToFormData(item) {
  const form = new FormData();
  form.append('record', JSON.stringify(item.record));
  item.photos.forEach((photo) => {
    const file = photo.file instanceof File ? photo.file : new File([photo.file], photo.name, { type: photo.type || 'image/jpeg' });
    form.append('photos', file, photo.name);
  });
  return form;
}
