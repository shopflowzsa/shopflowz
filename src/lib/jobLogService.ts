/**
 * jobLogService.ts
 *
 * Append-only backup of every task ever created.
 * Written at task creation time — never deleted, never overwritten.
 * Acts as a permanent recovery reference if workspace_state is ever lost.
 */

import { supabaseServiceRole } from "@/lib/supabase";
import { Task } from "@/types/crm";

/**
 * Reconcile recent job_log entries against the tasks table.
 * Inserts any tasks created in the last 7 days that are missing from the
 * tasks table (ON CONFLICT DO NOTHING — existing tasks are never overwritten).
 * Safe to call on every page load; the realtime subscription picks up any
 * newly inserted rows and adds them to the in-memory workspace state.
 */
export async function reconcileRecentJobLog(workspaceId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: logRows, error } = await supabaseServiceRole
      .from("job_log")
      .select("task_id, full_task")
      .eq("workspace_id", workspaceId)
      .gte("created_at", cutoff);
    if (error || !logRows?.length) return;

    const rows = logRows
      .filter(r => r.task_id && r.full_task)
      .map(r => ({
        id: r.task_id as string,
        workspace_id: workspaceId,
        data: r.full_task,
        updated_at: new Date().toISOString(),
      }));
    if (!rows.length) return;

    // ignoreDuplicates: true → INSERT ... ON CONFLICT DO NOTHING
    // Never overwrites an existing task with stale job_log data.
    const { error: upsertErr } = await supabaseServiceRole
      .from("tasks")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (upsertErr) {
      console.warn("[JobLog] Reconcile failed:", upsertErr.message);
    } else {
      console.log(`[JobLog] Reconcile checked ${rows.length} recent job(s)`);
    }
  } catch (err) {
    console.warn("[JobLog] Reconcile exception:", err);
  }
}

/**
 * Write a new task to the job_log table.
 * Fires-and-forgets — errors are logged but never crash the app.
 */
export async function logNewTask(workspaceId: string, task: Task): Promise<void> {
  try {
    const { error } = await supabaseServiceRole.from("job_log").insert({
      workspace_id: workspaceId,
      job_number: task.jobNumber ?? null,
      title: task.title ?? null,
      status: task.status ?? null,
      list_id: task.listId ?? null,
      custom_field_values: task.customFieldValues ?? [],
      photos: task.photos ?? [],
      created_at: task.createdAt ?? new Date().toISOString(),
      task_id: task.id,
      full_task: task as unknown as Record<string, unknown>,
    });

    if (error) {
      console.warn("[JobLog] Failed to log task:", task.jobNumber, error.message);
    } else {
      console.log("[JobLog] ✅ Backed up:", task.jobNumber ?? task.id);
    }
  } catch (err) {
    // Never let a backup failure affect the main app
    console.warn("[JobLog] Exception logging task:", err);
  }
}
