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

/** Atomically remove one task and add its ID to the tombstone list. */
export async function sbDeleteTask(workspaceId: string, taskId: string): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('delete_task_from_workspace', {
    p_workspace_id: workspaceId,
    p_task_id: taskId,
  });
  if (error) throw new Error(`sbDeleteTask: ${error.message}`);
}

/** Atomically replace one task's record in the tasks array (by id). */
export async function sbUpdateTask(workspaceId: string, task: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('update_task_in_workspace', {
    p_workspace_id: workspaceId,
    p_task: task,
  });
  if (error) throw new Error(`sbUpdateTask: ${error.message}`);
}

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
        // Always fetch fresh state on any DB change notification.
        // Relying on payload.new.state fails for large workspaces because
        // Supabase truncates realtime messages above ~1MB — the state field
        // arrives as null and no update is applied on the receiving tab.
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
