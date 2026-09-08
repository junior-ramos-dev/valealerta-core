import type { HydroSnapshot } from "./hydro";

const DB_NAME = "valealerta";
const DB_VER = 1;
const STORE = "hydro";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB indisponível."));
  });
}

export async function writeCachedHydro(
  regionId: string,
  snapshot: HydroSnapshot,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const stored: HydroSnapshot = { ...snapshot };
      delete stored.from_cache;
      tx.objectStore(STORE).put(stored, regionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao gravar hidrologia."));
    });
  } finally {
    db.close();
  }
}

export async function readCachedHydro(
  regionId: string,
): Promise<HydroSnapshot | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(regionId);
      req.onsuccess = () => {
        const value = req.result;
        resolve(value && typeof value === "object" ? (value as HydroSnapshot) : null);
      };
      req.onerror = () => reject(req.error ?? new Error("Falha ao ler hidrologia."));
    });
  } finally {
    db.close();
  }
}
