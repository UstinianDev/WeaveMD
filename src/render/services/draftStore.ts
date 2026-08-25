// ============================================
// WeaveMD — IndexedDB Composer Draft Storage
// ============================================
// Persists AI panel composer drafts per conversationId.
// DB: 'weavemd-drafts', version 1, objectStore: 'drafts', keyPath: 'conversationId'.
// All IDB operations are wrapped in try-catch; failures log a warning but never block the UI.

/** Draft record structure stored in IndexedDB. */
export interface DraftRecord {
  conversationId: string;
  text: string;
  mentions: string[];
  timestamp: number;
}

const DB_NAME = 'weavemd-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

/** Singleton database reference (lazily initialized). */
let dbInstance: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize (or return existing) IndexedDB database connection.
 * Creates the object store on first run (version upgrade).
 */
export function initDraftDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'conversationId' });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // Handle unexpected close (e.g. browser clears storage)
      dbInstance.onclose = () => {
        dbInstance = null;
        dbInitPromise = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      console.warn('[draftStore] Failed to open IndexedDB:', request.error);
      dbInitPromise = null;
      reject(request.error);
    };
  });

  return dbInitPromise;
}

/**
 * Save a draft record to IndexedDB (upsert).
 * Silently warns on failure without throwing.
 */
export async function saveDraft(
  conversationId: string,
  text: string,
  mentions: string[] = []
): Promise<void> {
  try {
    const db = await initDraftDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: DraftRecord = {
      conversationId,
      text,
      mentions,
      timestamp: Date.now(),
    };
    store.put(record);
  } catch (err) {
    console.warn('[draftStore] saveDraft failed:', err);
  }
}

/**
 * Load a draft record from IndexedDB by conversationId.
 * Returns null if not found or on error.
 */
export async function loadDraft(
  conversationId: string
): Promise<{ text: string; mentions: string[] } | null> {
  try {
    const db = await initDraftDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, _reject) => {
      const request = store.get(conversationId);
      request.onsuccess = () => {
        const record = request.result as DraftRecord | undefined;
        if (record) {
          resolve({ text: record.text, mentions: record.mentions });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => {
        console.warn('[draftStore] loadDraft failed:', request.error);
        resolve(null);
      };
    });
  } catch (err) {
    console.warn('[draftStore] loadDraft failed:', err);
    return null;
  }
}

/**
 * Delete a draft record from IndexedDB by conversationId.
 * Silently warns on failure without throwing.
 */
export async function deleteDraft(conversationId: string): Promise<void> {
  try {
    const db = await initDraftDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(conversationId);
  } catch (err) {
    console.warn('[draftStore] deleteDraft failed:', err);
  }
}

/**
 * Create a debounced saver function.
 * Each call resets the timer; the actual save fires `ms` milliseconds after the last call.
 * Skips save when text is empty (no point persisting blank drafts).
 */
export function createDebouncedSaver(
  ms = 300
): (conversationId: string, text: string, mentions?: string[]) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (conversationId: string, text: string, mentions: string[] = []) => {
    if (timer) clearTimeout(timer);
    // Skip persisting empty drafts (optimization + avoids ghost records)
    if (!text.trim() && mentions.length === 0) return;
    timer = setTimeout(() => {
      void saveDraft(conversationId, text, mentions);
      timer = null;
    }, ms);
  };
}
