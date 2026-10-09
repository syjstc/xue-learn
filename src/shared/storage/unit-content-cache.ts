import { canUseBrowserPersistentStorage } from "@xue-learn/core/client-runtime";

const DB_NAME = "xue-learn-unit-content";
const STORE = "content";
const MAX_BYTES = 100 * 1024 * 1024;

export type CachedUnitContent = {
  userId: string;
  unitId: string;
  contentRevision: number;
  payload: unknown;
  bytes: number;
  updatedAt: number;
};

function cacheKey(userId: string, unitId: string, revision: number): string {
  return `${userId}:${unitId}:${revision}`;
}

function openDb(): Promise<IDBDatabase> {
  if (!canUseBrowserPersistentStorage()) {
    return Promise.reject(new Error("Browser content cache is disabled"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("unitPrefix", "unitPrefix");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((value) => {
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error ?? new Error("indexedDB tx failed"));
      })
      .catch(reject);
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

async function enforceLru(store: IDBObjectStore): Promise<void> {
  const all = await requestToPromise(
    store.getAll() as IDBRequest<Array<{ key: string; bytes: number; updatedAt: number }>>,
  );
  let total = all.reduce((sum, row) => sum + (row.bytes || 0), 0);
  if (total <= MAX_BYTES) return;
  all.sort((a, b) => a.updatedAt - b.updatedAt);
  for (const row of all) {
    if (total <= MAX_BYTES) break;
    store.delete(row.key);
    total -= row.bytes || 0;
  }
}

export const unitContentCache = {
  async get<T>(
    userId: string,
    unitId: string,
    revision: number,
  ): Promise<T | null> {
    if (!userId || typeof indexedDB === "undefined") return null;
    try {
      const row = await withStore("readonly", (store) =>
        requestToPromise(
          store.get(cacheKey(userId, unitId, revision)) as IDBRequest<{
            payload: T;
          } | undefined>,
        ),
      );
      return row?.payload ?? null;
    } catch {
      return null;
    }
  },

  async set(
    userId: string,
    unitId: string,
    revision: number,
    payload: unknown,
  ): Promise<void> {
    if (!userId || typeof indexedDB === "undefined") return;
    const body = JSON.stringify(payload);
    const bytes = new Blob([body]).size;
    const unitPrefix = `${userId}:${unitId}:`;
    try {
      await withStore("readwrite", async (store) => {
        // Drop older revisions for this unit.
        const all = await requestToPromise(
          store.getAll() as IDBRequest<Array<{ key: string }>>,
        );
        for (const row of all) {
          if (
            row.key.startsWith(unitPrefix) &&
            row.key !== cacheKey(userId, unitId, revision)
          ) {
            store.delete(row.key);
          }
        }
        store.put({
          key: cacheKey(userId, unitId, revision),
          unitPrefix,
          userId,
          unitId,
          contentRevision: revision,
          payload,
          bytes,
          updatedAt: Date.now(),
        });
        await enforceLru(store);
      });
    } catch {
      // Best-effort cache only.
    }
  },

  async clearUser(userId: string): Promise<void> {
    if (!userId || typeof indexedDB === "undefined") return;
    try {
      await withStore("readwrite", async (store) => {
        const all = await requestToPromise(
          store.getAll() as IDBRequest<Array<{ key: string; userId?: string }>>,
        );
        for (const row of all) {
          if (row.userId === userId || row.key.startsWith(`${userId}:`)) {
            store.delete(row.key);
          }
        }
      });
    } catch {
      // ignore
    }
  },

  async clearAll(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    try {
      await withStore("readwrite", async (store) => {
        store.clear();
      });
    } catch {
      // ignore
    }
  },
};
