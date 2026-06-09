import type { WorkspaceState } from "@/types/crm";

const DB_NAME = "shopflowz_cache";
const DB_VERSION = 2;
const STORE = "workspace";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry {
  id: string;
  ts: number;
  state: WorkspaceState;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns the cached WorkspaceState for this workspaceId, or null if not found / expired.
 * Uses IndexedDB — up to 500MB, never silently fails on quota.
 */
export async function getCachedWorkspace(workspaceId: string): Promise<WorkspaceState | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(workspaceId);
      req.onsuccess = () => {
        const entry: CacheEntry | undefined = req.result;
        if (!entry) return resolve(null);
        if (Date.now() - entry.ts > MAX_AGE_MS) return resolve(null);
        resolve(entry.state);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    // Fallback: try old localStorage key
    try {
      const raw = localStorage.getItem(`ws_cache_v1_${workspaceId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed?.state ?? null;
      }
    } catch { /* ignore */ }
    return null;
  }
}

/**
 * Saves the WorkspaceState to IndexedDB. Fire-and-forget — won't block the UI.
 */
export function setCachedWorkspace(workspaceId: string, state: WorkspaceState): void {
  openDB().then(db => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id: workspaceId, ts: Date.now(), state } as CacheEntry);
  }).catch(() => {
    // Absolute last-resort: localStorage (may fail on large workspaces)
    try {
      localStorage.setItem(`ws_cache_v1_${workspaceId}`, JSON.stringify({ v: 1, ts: Date.now(), state }));
    } catch { /* ignore quota errors */ }
  });
}

/**
 * Removes the cache entry for this workspace (e.g. on sign-out).
 */
export function clearCachedWorkspace(workspaceId: string): void {
  openDB().then(db => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(workspaceId);
  }).catch(() => {
    try { localStorage.removeItem(`ws_cache_v1_${workspaceId}`); } catch { /* ignore */ }
  });
}

// ─── In-memory snapshot for instant reads (avoids IDB on same session) ────────
const memCache = new Map<string, WorkspaceState>();

export function getMemCachedWorkspace(workspaceId: string): WorkspaceState | null {
  return memCache.get(workspaceId) ?? null;
}

export function setMemCachedWorkspace(workspaceId: string, state: WorkspaceState): void {
  memCache.set(workspaceId, state);
}
