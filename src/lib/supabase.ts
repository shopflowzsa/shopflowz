import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Credentials loaded from .env (VITE_SUPABASE_*)
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL as string ||
  "https://omqqbinhevyuyfgqvkqk.supabase.co";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY as string ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcXFiaW5oZXZ5dXlmZ3F2a3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MTk0NDYsImV4cCI6MjA5NTM5NTQ0Nn0.xg7uN2e4E4fgKUaWv9Z3eYBYDohhieTdKefcitoPNxc";
export const SUPABASE_SERVICE_ROLE_KEY =
  (import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string) || '';
if (typeof window !== 'undefined' && !import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[Security] VITE_SUPABASE_SERVICE_ROLE_KEY not set in environment');
}

// Singleton — never create more than one Supabase client
declare global { interface Window { __supabase?: SupabaseClient; __supabaseServiceRole?: SupabaseClient } }
if (!window.__supabase) {
  window.__supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
}
export const supabase: SupabaseClient = window.__supabase;

// Service role client bypasses RLS - use only on server-side or for invitation acceptance
if (!window.__supabaseServiceRole) {
  window.__supabaseServiceRole = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
export const supabaseServiceRole: SupabaseClient = window.__supabaseServiceRole;

// ── Raw REST helper for public/unauthenticated queries ─────────────────────
// Use this instead of a second Supabase client to avoid the
// "Multiple GoTrueClient instances" warning and Web Lock conflicts.
export async function publicRestGet(table: string, params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams({ ...params, select: params.select ?? '*' }).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Accept': 'application/json',
      'Accept-Profile': 'public',
    },
  });
  if (!res.ok) throw new Error(`REST ${table} failed: ${res.status}`);
  return res.json();
}

// ── Generic JSONB collection helpers ────────────────────────────────────────
// These mirror the Firestore collection patterns so migration is incremental.

type Table =
  | "invoices" | "sales_invoices" | "quotes" | "inventory"
  | "stock_movements" | "task_audit" | "whatsapp_logs"
  | "form_submissions" | "forms" | "documents" | "print_logs"
  | "payments" | "customers";

/** Get all docs in a workspace sub-collection */
export async function sbGetAll<T = Record<string, unknown>>(
  table: Table,
  workspaceId: string
): Promise<(T & { id: string })[]> {
  const { data, error } = await supabase
    .from(table)
    .select("id, data")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`sbGetAll(${table}): ${error.message}`);
  return (data || []).map(row => ({ id: row.id, ...(row.data as T) }));
}

/** Get one doc by id */
export async function sbGet<T = Record<string, unknown>>(
  table: Table,
  id: string
): Promise<(T & { id: string }) | null> {
  const { data, error } = await supabase
    .from(table)
    .select("id, data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`sbGet(${table}): ${error.message}`);
  if (!data) return null;
  return { id: data.id, ...(data.data as T) };
}

/** Insert/upsert a doc */
export async function sbSet<T extends Record<string, unknown>>(
  table: Table,
  workspaceId: string,
  id: string,
  data: T
): Promise<void> {
  const { error } = await supabaseServiceRole
    .from(table)
    .upsert({ id, workspace_id: workspaceId, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(`sbSet(${table}): ${error.message}`);
}

/** Update fields in a doc */
export async function sbUpdate<T extends Record<string, unknown>>(
  table: Table,
  id: string,
  updates: Partial<T>
): Promise<void> {
  const { data, error: fetchErr } = await supabaseServiceRole
    .from(table)
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw new Error(`sbUpdate fetch(${table}): ${fetchErr.message}`);
  const merged = { ...(data?.data || {}), ...updates };
  const { error } = await supabaseServiceRole
    .from(table)
    .update({ data: merged, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`sbUpdate(${table}): ${error.message}`);
}

/** Delete a doc */
export async function sbDelete(table: Table, id: string): Promise<void> {
  const { error } = await supabaseServiceRole.from(table).delete().eq("id", id);
  if (error) throw new Error(`sbDelete(${table}): ${error.message}`);
}

/** Add a new doc with auto-generated id */
export async function sbAdd<T extends Record<string, unknown>>(
  table: Table,
  workspaceId: string,
  data: T
): Promise<string> {
  const id = crypto.randomUUID();
  await sbSet(table, workspaceId, id, data);
  return id;
}

// ── Workspace state helpers ──────────────────────────────────────────────────

export async function sbGetWorkspaceState(workspaceId: string) {
  console.log('[Supabase] Getting workspace state for:', workspaceId);
  // Hard 30-second timeout — if Supabase hangs (large JSON, slow network) we
  // reject rather than blocking the caller forever and freezing the loading screen.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('sbGetWorkspaceState: timeout')), 30000)
  );
  const fetch = (async () => {
    const { data, error } = await supabaseServiceRole
      .from("workspace_state")
      .select("state")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) {
      console.error('[Supabase] Error loading workspace state:', error);
      throw new Error(`sbGetWorkspaceState: ${error.message}`);
    }
    console.log('[Supabase] Workspace state loaded:', data?.state ? 'has data' : 'no data',
      data?.state ? `(${(data.state as any)?.tasks?.length || 0} tasks)` : '');
    return data?.state || null;
  })();
  return Promise.race([fetch, timeout]);
}

export async function sbSetWorkspaceState(
  workspaceId: string,
  state: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('upsert_workspace_state_safe', {
    p_workspace_id: workspaceId,
    p_incoming_state: state,
  });
  if (error) throw new Error(`sbSetWorkspaceState: ${error.message}`);
}

// ── Per-task row operations (tasks table) ────────────────────────────────────

/** Upsert a single task row — instant, isolated, no blob write. */
export async function sbUpsertTask(workspaceId: string, task: Record<string, unknown>): Promise<void> {
  const taskId = task.id as string;
  if (!taskId) throw new Error('sbUpsertTask: task.id is required');
  // Use direct table upsert instead of RPC — the RPC passes data as a JSON
  // argument which fails when task.data contains control characters (e.g.
  // embedded base64 photos or multiline descriptions). Direct .upsert() lets
  // the Supabase JS client serialize the JSONB column safely.
  const { error } = await supabaseServiceRole
    .from('tasks')
    .upsert(
      { id: taskId, workspace_id: workspaceId, data: task, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
  if (error) throw new Error(`sbUpsertTask: ${error.message}`);
}

/** Delete a single task row. */
export async function sbDeleteTask(workspaceId: string, taskId: string): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('delete_task', {
    p_workspace_id: workspaceId,
    p_task_id: taskId,
  });
  if (error) throw new Error(`sbDeleteTask: ${error.message}`);
}

/** Fetch all task rows for a workspace. Returns raw task data objects. */
export async function sbGetTasks(workspaceId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseServiceRole
    .from('tasks')
    .select('data')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`sbGetTasks: ${error.message}`);
  return (data || []).map(row => row.data as Record<string, unknown>);
}

/** Insert a new task and bump the workspace job counter atomically. */
export async function sbInsertTaskWithJobNumber(
  workspaceId: string,
  task: Record<string, unknown>,
  jobCounter: number,
): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('insert_task_with_job_number', {
    p_workspace_id: workspaceId,
    p_task: task,
    p_job_counter: jobCounter,
  });
  if (error) throw new Error(`sbInsertTaskWithJobNumber: ${error.message}`);
}

/**
 * Subscribe to per-task realtime changes for a workspace.
 * Each event delivers exactly one task's data — no full-state re-fetch needed.
 * onInsert/onUpdate receive the task data object; onDelete receives the task id.
 */
export function sbSubscribeTasks(
  workspaceId: string,
  callbacks: {
    onInsert: (task: Record<string, unknown>) => void;
    onUpdate: (task: Record<string, unknown>) => void;
    onDelete: (taskId: string) => void;
  }
) {
  // Fetch a single task row by id — fallback when payload.new.data is null.
  // This happens when REPLICA IDENTITY is not yet FULL on the table.
  const fetchAndDeliver = async (taskId: string, cb: (t: Record<string, unknown>) => void) => {
    try {
      const { data, error } = await supabaseServiceRole
        .from('tasks')
        .select('data')
        .eq('id', taskId)
        .maybeSingle();
      if (!error && data?.data) cb(data.data as Record<string, unknown>);
    } catch (e) {
      console.warn('[sbSubscribeTasks] fallback fetch failed for task', taskId, e);
    }
  };

  const channel = supabase
    .channel(`tasks:${workspaceId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'tasks',
        filter: `workspace_id=eq.${workspaceId}`,
      },
      (payload) => {
        const row = payload.new as any;
        if (row?.data) {
          callbacks.onInsert(row.data);
        } else if (row?.id) {
          fetchAndDeliver(row.id, callbacks.onInsert);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tasks',
        filter: `workspace_id=eq.${workspaceId}`,
      },
      (payload) => {
        const row = payload.new as any;
        if (row?.data) {
          callbacks.onUpdate(row.data);
        } else if (row?.id) {
          fetchAndDeliver(row.id, callbacks.onUpdate);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'tasks',
        filter: `workspace_id=eq.${workspaceId}`,
      },
      (payload) => {
        const row = payload.old as any;
        if (row?.id) callbacks.onDelete(row.id);
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// ── Per-comment row operations (task_comments table) ─────────────────────────

/** Insert a single comment row — each comment is an isolated INSERT, no conflicts. */
export async function sbInsertComment(
  workspaceId: string,
  taskId: string,
  comment: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('insert_task_comment', {
    p_workspace_id: workspaceId,
    p_task_id: taskId,
    p_comment: comment,
  });
  if (error) throw new Error(`sbInsertComment: ${error.message}`);
}

/** Delete a comment row. */
export async function sbDeleteComment(workspaceId: string, commentId: string): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('delete_task_comment', {
    p_workspace_id: workspaceId,
    p_comment_id: commentId,
  });
  if (error) throw new Error(`sbDeleteComment: ${error.message}`);
}

/** Fetch all comments for a task, ordered oldest-first. */
export async function sbGetComments(taskId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseServiceRole
    .from('task_comments')
    .select('data')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`sbGetComments: ${error.message}`);
  return (data || []).map(row => row.data as Record<string, unknown>);
}

/**
 * Subscribe to live comment changes for a single task.
 * onInsert fires for new comments/activity from any user — instant live chat.
 * onDelete fires when a comment is removed.
 */
export function sbSubscribeComments(
  taskId: string,
  callbacks: {
    onInsert: (comment: Record<string, unknown>) => void;
    onDelete: (commentId: string) => void;
  },
) {
  const channel = supabase
    .channel(`task_comments:${taskId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
      (payload) => {
        const row = payload.new as any;
        if (row?.data) callbacks.onInsert(row.data);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
      (payload) => {
        const row = payload.old as any;
        if (row?.id) callbacks.onDelete(row.id);
      }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ── Workspace state subscription (non-task state: spaces, lists, forms etc.) ─

export function sbSubscribeWorkspaceState(
  workspaceId: string,
  onUpdate: (state: Record<string, unknown>) => void
) {
  const channel = supabase
    .channel(`workspace_state:${workspaceId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "workspace_state",
        filter: `workspace_id=eq.${workspaceId}`,
      },
      async () => {
        // Tasks now live in their own table — workspace_state only carries
        // spaces, lists, forms, quotes, counters etc. (all small enough that
        // the realtime payload is never truncated). We still re-fetch to be safe.
        try {
          const state = await sbGetWorkspaceState(workspaceId);
          if (state) onUpdate(state);
        } catch (err) {
          console.warn('[Supabase] Subscription re-fetch failed:', err);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
