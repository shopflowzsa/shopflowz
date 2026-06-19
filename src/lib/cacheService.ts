import type { WorkspaceState } from "@/types/crm";

const DB_NAME = "shopflowz_cache";
const DB_VERSION = 3; // bumped to evict stale task-position caches from all browsers
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
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Drop and recreate the store on any version upgrade so stale task
      // positions cached by older versions are wiped from every browser.
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      db.createObjectStore(STORE, { keyPath: "id" });
      // Also clear localStorage fallback entries
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('ws_cache_v1_')) localStorage.removeItem(k);
        });
      } catch { /* ignore */ }
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
 * Tasks are intentionally NOT cached — they live in the tasks table and must
 * always be loaded fresh so every user sees the current positions. Caching
 * tasks would mean one user's stale IndexedDB overwrites another user's
 * live moves even after a refresh.
 */
export function setCachedWorkspace(workspaceId: string, state: WorkspaceState): void {
  // Strip tasks before caching — tasks table is the source of truth
  const { tasks: _tasks, deletedTaskIds: _del, ...structuralState } = state as any;
  const stateToCache = { ...structuralState, tasks: [], deletedTaskIds: [] } as WorkspaceState;
  openDB().then(db => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id: workspaceId, ts: Date.now(), state: stateToCache } as CacheEntry);
  }).catch(() => {
    // Absolute last-resort: localStorage (may fail on large workspaces)
    try {
      localStorage.setItem(`ws_cache_v1_${workspaceId}`, JSON.stringify({ v: 1, ts: Date.now(), state: stateToCache }));
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
  // Strip tasks — only cache structural state so task positions are always
  // loaded from the tasks table (never served stale from memory).
  const { tasks: _tasks, deletedTaskIds: _del, ...structural } = state as any;
  memCache.set(workspaceId, { ...structural, tasks: [], deletedTaskIds: [] } as WorkspaceState);
}
