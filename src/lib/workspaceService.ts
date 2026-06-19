import { supabase, supabaseServiceRole, sbGetWorkspaceState, sbSetWorkspaceState, sbSubscribeWorkspaceState, sbDeleteTask, sbUpsertTask, sbGetTasks, sbInsertTaskWithJobNumber, sbSubscribeTasks } from "@/lib/supabase";
import { WorkspaceState, FormDefinition, Task } from "@/types/crm";
import { logNewTask } from "@/lib/jobLogService";

type Unsubscribe = () => void;

const emptyWorkspaceState: WorkspaceState = {
  spaces: [],
  folders: [],
  lists: [],
  tasks: [],
  customFields: [],
  forms: [],
  jobCounter: 0,
};

function removeUndefinedValues<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(removeUndefinedValues) as T;
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj as object)) {
      if (value !== undefined) cleaned[key] = removeUndefinedValues(value);
    }
    return cleaned as T;
  }
  return obj;
}

function createSubmissionId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `sub_${randomUuid}`;
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Load once; seeds with empty state on first signup. */
export async function loadWorkspaceState(workspaceId: string): Promise<WorkspaceState> {
  console.log('[WorkspaceService] Loading workspace state for:', workspaceId);
  const state = await sbGetWorkspaceState(workspaceId);
  if (state) {
    // Ensure tasks is always an array — blob no longer stores tasks (they live
    // in the tasks table) so state.tasks may be absent after the migration.
    const safe = {
      ...emptyWorkspaceState,
      ...(state as any),
      tasks: (state as any).tasks ?? [],
    } as WorkspaceState;
    console.log('[WorkspaceService] Loaded existing state:', {
      tasks: safe.tasks.length,
      lists: safe.lists?.length || 0,
      spaces: safe.spaces?.length || 0
    });
    return safe;
  }

  // State row doesn't exist yet — this is a brand-new workspace (first signup).
  // SAFETY GUARD: only write empty state if the row truly does not exist.
  // Never call sbSetWorkspaceState here based on a null read, because a failed
  // RLS read on the anon client also returns null and would wipe real data.
  // sbGetWorkspaceState now uses service role, so null genuinely means no row.
  console.log('[WorkspaceService] No existing state found — seeding empty workspace for new account');
  try {
    await sbSetWorkspaceState(workspaceId, emptyWorkspaceState as any);
  } catch (seedErr) {
    // Seed failing is non-fatal — return empty state in memory without crashing
    console.warn('[WorkspaceService] Could not seed empty workspace:', seedErr);
  }
  return emptyWorkspaceState;
}

/** Persist the entire workspace state to Supabase. */
export async function saveWorkspaceState(workspaceId: string, state: WorkspaceState): Promise<void> {
  await sbSetWorkspaceState(workspaceId, removeUndefinedValues(state) as any);
}

/** Fetch all tasks for a workspace from the tasks table. */
export async function loadTasksForWorkspace(workspaceId: string): Promise<Task[]> {
  const rows = await sbGetTasks(workspaceId);
  return rows as unknown as Task[];
}

/** Upsert a single task row — instant, isolated write. */
export async function upsertTask(workspaceId: string, task: Task): Promise<void> {
  await sbUpsertTask(workspaceId, removeUndefinedValues(task) as any);
}

/** Delete a single task row. */
export async function deleteTaskFromWorkspace(workspaceId: string, taskId: string): Promise<void> {
  await sbDeleteTask(workspaceId, taskId);
}

/** Insert a new task and bump the workspace job counter atomically. */
export async function insertTaskWithJobNumber(
  workspaceId: string,
  task: Task,
  jobCounter: number,
): Promise<void> {
  await sbInsertTaskWithJobNumber(workspaceId, removeUndefinedValues(task) as any, jobCounter);
}

/**
 * Subscribe to per-task realtime changes.
 * Callbacks receive individual task objects — no full-state re-fetch.
 */
export function subscribeTaskChanges(
  workspaceId: string,
  callbacks: {
    onInsert: (task: Task) => void;
    onUpdate: (task: Task) => void;
    onDelete: (taskId: string) => void;
  },
): Unsubscribe {
  return sbSubscribeTasks(workspaceId, {
    onInsert: (t) => callbacks.onInsert(t as unknown as Task),
    onUpdate: (t) => callbacks.onUpdate(t as unknown as Task),
    onDelete: callbacks.onDelete,
  });
}

/** Subscribe to real-time workspace state updates (non-task state only). */
export function subscribeWorkspaceState(
  workspaceId: string,
  onUpdate: (state: WorkspaceState) => void,
): Unsubscribe {
  return sbSubscribeWorkspaceState(workspaceId, (s) => onUpdate(s as WorkspaceState));
}

// ─── Public forms ─────────────────────────────────────────────────────────

export async function publishForm(workspaceId: string, form: FormDefinition): Promise<void> {
  const payload = removeUndefinedValues({ ...form, workspaceId });
  await supabaseServiceRole.from('forms').upsert(
    { id: form.id, workspace_id: workspaceId, data: payload },
    { onConflict: 'id' }
  );
}

export async function unpublishForm(formId: string): Promise<void> {
  await supabaseServiceRole.from('forms').delete().eq('id', formId);
}

export async function loadPublicForm(
  formId: string,
): Promise<{ form: FormDefinition; workspaceId: string } | null> {
  const { data } = await supabase.from('forms').select('data').eq('id', formId).maybeSingle();
  if (!data?.data) return null;
  const { workspaceId, ...form } = data.data as any;
  return { form: form as FormDefinition, workspaceId };
}

export interface StaleTaskOffender {
  title: string;
  job_number?: string | null;
  days_old: number;
}

export interface FormStaleBlock {
  blocked: boolean;
  list_name?: string;
  threshold?: number;
  warning_message?: string;
  /** Total count of stale tasks (may exceed `stale_tasks.length` — the RPC caps the array at 25). */
  total_stale?: number;
  /** Up to 25 offenders, ordered oldest first. */
  stale_tasks?: StaleTaskOffender[];
}

/**
 * Public-form gate: returns whether the form should refuse to render because
 * a stale task is sitting in its target list/folder. Backed by a SECURITY
 * DEFINER RPC so unauthenticated form pages can call it.
 */
export async function checkFormStaleBlock(formId: string): Promise<FormStaleBlock> {
  const { data, error } = await supabase.rpc('check_form_stale_block', { p_form_id: formId });
  if (error) {
    console.warn('[checkFormStaleBlock] failed — defaulting to unblocked:', error.message);
    return { blocked: false };
  }
  return (data as FormStaleBlock) || { blocked: false };
}

/**
 * Verify a supervisor bypass code for a public form.
 * Returns true on match. Network-callable, so a strong workspace password
 * is essential — there's no rate limit at the RPC layer.
 */
export async function verifyFormSupervisorCode(formId: string, code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_form_supervisor_code', {
    p_form_id: formId,
    p_code: code,
  });
  if (error) {
    console.warn('[verifyFormSupervisorCode] failed:', error.message);
    return false;
  }
  return data === true;
}

// ─── Form submissions ──────────────────────────────────────────────────────

export interface FormSubmission {
  id?: string;
  formId: string;
  workspaceId: string;
  task: Task;
  submittedAt: string;
  // Set true by PublicForm when the sticker was already printed at submit
  // time (i.e. WebUSB was available + form's printer granted). Admin uses
  // this to decide whether to print again when it picks up the submission.
  printedAtSubmit?: boolean;
}

/**
 * Atomically claim the next job number from the workspace's counter.
 * Used by the public form so the sticker can print the real job number
 * immediately, before the admin tab processes the submission.
 *
 * Returns null if the RPC isn't available (e.g. the migration hasn't run yet).
 */
export async function claimNextJobNumber(workspaceId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('claim_next_job_number', {
      p_workspace_id: workspaceId,
    });
    if (error) {
      console.warn('[claimNextJobNumber] RPC failed:', error.message);
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (err) {
    console.warn('[claimNextJobNumber] threw:', err);
    return null;
  }
}

/** Write a new form submission. */
export async function submitForm(submission: Omit<FormSubmission, "id">): Promise<string> {
  const docId = createSubmissionId();
  const { error } = await supabaseServiceRole.from('form_submissions').insert(
    { id: docId, workspace_id: submission.workspaceId, data: submission },
  );
  if (error) throw new Error(`Form submission failed: ${error.message}`);

  // Notify the workspace — include customer contact details so staff can
  // recover the booking even if the task fails to create.
  try {
    const { addNotification } = await import('./notificationService');

    const cfv: Array<{ fieldId: string; value: unknown }> = (submission.task as any)?.customFieldValues || [];
    const jobNum: string = (submission.task as any)?.jobNumber || '';

    // Scan all field values for a phone number (digits, spaces, +, hyphens, 7-15 chars)
    // and the first short text value that looks like a person's name.
    const phoneRegex = /^[+\d][\d\s\-().]{6,14}$/;
    let phone = '', name = '';
    for (const { value } of cfv) {
      const v = String(value || '').trim();
      if (!v || v.length < 3) continue;
      if (!phone && phoneRegex.test(v)) { phone = v; continue; }
      // First short text value (≤40 chars, not an email/number/url) treated as name
      if (!name && v.length <= 40 && !/[@./]/.test(v) && !/^\d+$/.test(v)) name = v;
    }

    const parts = [
      jobNum,
      name && `👤 ${name}`,
      phone && `📞 ${phone}`,
    ].filter(Boolean);
    const body = parts.length ? parts.join('  ') : 'A customer submitted a form';

    await addNotification(submission.workspaceId, {
      type: 'query',
      title: `New booking${(submission as any).formName ? ` — ${(submission as any).formName}` : ''}`,
      body,
      link: 'crm',
      meta: jobNum ? { jobNumber: jobNum } : undefined,
    });
  } catch (e) {
    console.error('submission notification failed', e);
  }

  return docId;
}

/** Fetch all pending (unprocessed) form submissions for a workspace. */
export async function getPendingFormSubmissions(
  workspaceId: string,
): Promise<(FormSubmission & { id: string })[]> {
  const { data, error } = await supabase
    .from('form_submissions')
    .select('id, data, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getPendingFormSubmissions: ${error.message}`);
  return (data || []).map(row => ({ id: row.id, ...(row.data as FormSubmission) }));
}

/** Subscribe to new form submissions via Supabase realtime (INSERT only). */
export function subscribeFormSubmissions(
  workspaceId: string,
  onNew: (submission: FormSubmission & { id: string }) => void,
): Unsubscribe {
  const channel = supabase
    .channel(`form_submissions_${workspaceId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'form_submissions', filter: `workspace_id=eq.${workspaceId}` },
      (payload) => {
        const row = payload.new as any;
        onNew({ id: row.id, ...(row.data as FormSubmission) });
      }
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/** Delete a processed form submission. */
export async function deleteFormSubmission(submissionId: string): Promise<void> {
  await supabaseServiceRole.from('form_submissions').delete().eq('id', submissionId);
}

/**
 * Claim the next job number and add a task to workspace state.
 * Uses DELETE...RETURNING to atomically claim the submission —
 * only the first caller to delete it will proceed.
 */
export async function claimJobNumberAndAddTask(
  workspaceId: string,
  submissionId: string,
  buildTask: (jobNumberStr: string) => Task,
  preAssignedJobNumber?: string,
): Promise<{ jobNumberStr: string; updatedState: WorkspaceState; preAssigned: boolean } | null> {
  // Atomically claim the submission by deleting it and getting the deleted row
  const { data: deleted } = await supabaseServiceRole
    .from('form_submissions')
    .delete()
    .eq('id', submissionId)
    .select();

  if (!deleted || deleted.length === 0) {
    console.log(`[claimJob] Submission ${submissionId} already processed — skipping`);
    return null;
  }

  // Load current workspace state — tolerate timeouts (large state JSON can be slow).
  // The RPC append_task_to_workspace is authoritative for the counter via GREATEST,
  // so a stale/empty currentState here only risks a harmless low p_job_counter input.
  let currentState: WorkspaceState = emptyWorkspaceState;
  try {
    const state = (await sbGetWorkspaceState(workspaceId)) as WorkspaceState | null;
    if (state) currentState = state;
  } catch (stateLoadErr) {
    console.warn('[claimJob] workspace_state load timed out — proceeding with empty state; RPC will correct the counter:', stateLoadErr);
  }

  // Honor a pre-assigned job number (claimed atomically when the form was
  // submitted via the claim_next_job_number RPC). The RPC is the authoritative
  // counter — when honoring a pre-assigned number we must NOT write jobCounter
  // back, or we risk lowering it below a value another concurrent RPC already
  // claimed, which causes the next submission to receive a reused number.
  let jobNumberStr: string;
  let counterAfter: number;
  const existingCounter = currentState.jobCounter ?? 0;
  if (preAssignedJobNumber) {
    jobNumberStr = preAssignedJobNumber;
    const parsed = parseInt(preAssignedJobNumber.replace(/[^0-9]/g, ''), 10);
    const isValidPreAssigned = !isNaN(parsed) && parsed >= existingCounter;
    if (isValidPreAssigned) {
      counterAfter = Math.max(existingCounter, parsed);
    } else {
      console.warn('[claimJob] Ignoring stale pre-assigned job number:', {
        preAssignedJobNumber,
        existingCounter,
      });
      counterAfter = existingCounter + 1;
      jobNumberStr = `JOB-${String(counterAfter).padStart(4, '0')}`;
    }
  } else {
    counterAfter = existingCounter + 1;
    jobNumberStr = `JOB-${String(counterAfter).padStart(4, '0')}`;
  }

  const baseTask = buildTask(jobNumberStr);
  const newTask: Task = {
    ...baseTask,
    id: `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };

  // Insert into the tasks table and bump job counter atomically.
  try {
    await sbInsertTaskWithJobNumber(
      workspaceId,
      removeUndefinedValues(newTask) as any,
      Math.max(existingCounter, counterAfter),
    );
  } catch (err) {
    console.error('[claimJob] Atomic insert failed — re-queuing submission:', err);
    try {
      await supabaseServiceRole.from('form_submissions').insert(deleted[0]);
    } catch (reinsertErr) {
      console.error('[claimJob] CRITICAL: failed to re-queue submission after save failure:', reinsertErr);
    }
    return null;
  }

  // Build updatedState for the caller's local UI update.
  // Tasks now come from the tasks table, but the caller only needs the new task
  // appended so the UI shows it immediately without a full re-fetch.
  const updatedState: WorkspaceState = {
    ...currentState,
    tasks: [...currentState.tasks, newTask],
    jobCounter: Math.max(existingCounter, counterAfter),
  };

  // Append-only backup — survives any workspace_state wipe
  await logNewTask(workspaceId, newTask);

  return { jobNumberStr, updatedState, preAssigned: !!preAssignedJobNumber };
}
