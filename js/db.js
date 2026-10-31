// IndexedDB 访问层：应用里只有这里直接接触数据库
const DB_NAME = 'review-db';
const DB_VERSION = 1;

const STORES = [
  { name: 'knowledge', keyPath: 'id' },
  { name: 'images', keyPath: 'id' },
  { name: 'plans', keyPath: 'owner' },
  { name: 'meta', keyPath: 'key' },
];

let openPromise = null;

export function openDb() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const def of STORES) {
        const store = db.objectStoreNames.contains(def.name)
          ? req.transaction.objectStore(def.name)
          : db.createObjectStore(def.name, { keyPath: def.keyPath });
        for (const index of def.indexes || []) {
          if (!store.indexNames.contains(index)) store.createIndex(index, index);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return openPromise;
}

function toPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDb();
  return toPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDb();
  return toPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putMany(storeName, values) {
  if (!values.length) return 0;
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return values.length;
}

export async function del(storeName, key) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clear(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function metaGet(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export async function metaSet(key, value) {
  await put('meta', { key, value });
}
