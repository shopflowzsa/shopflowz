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
