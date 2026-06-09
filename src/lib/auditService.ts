import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { Task } from "@/types/crm";

export type AuditAction = "create" | "update" | "delete" | "restore";

export interface TaskAuditEntry {
  id?: string;
  taskId: string;
  taskData: Task;
  action: AuditAction;
  timestamp: string;
  userId?: string;
  metadata?: {
    previousData?: Partial<Task>;
    reason?: string;
    source?: string; // "manual", "bulk", "deduplication", etc.
  };
}

// ─── Audit Logging Functions ──────────────────────────────────────────────────

/**
 * Log a task operation to the audit collection
 */
export async function logTaskAudit(
  workspaceId: string,
  taskId: string,
  taskData: Task,
  action: AuditAction,
  userId?: string,
  metadata?: TaskAuditEntry['metadata']
): Promise<void> {
  try {
    const entry: TaskAuditEntry = {
      taskId,
      taskData: { ...taskData },
      action,
      timestamp: new Date().toISOString(),
      userId,
      metadata,
    };
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await supabaseServiceRole.from("task_audit").insert({ id, workspace_id: workspaceId, data: entry });
    console.log(`[Audit] Logged ${action} for task ${taskId} (${taskData.title})`);
  } catch (error) {
    console.error(`[Audit] Failed to log ${action} for task ${taskId}:`, error);
  }
}

/**
 * Log task creation
 */
export async function logTaskCreated(
  workspaceId: string,
  task: Task,
  userId?: string,
  source: string = "manual"
): Promise<void> {
  await logTaskAudit(workspaceId, task.id, task, "create", userId, { source });
}

/**
 * Log task update
 */
export async function logTaskUpdated(
  workspaceId: string,
  newTask: Task,
  previousTask: Task,
  userId?: string,
  source: string = "manual"
): Promise<void> {
  await logTaskAudit(workspaceId, newTask.id, newTask, "update", userId, {
    previousData: previousTask,
    source
  });
}

/**
 * Log task deletion
 */
export async function logTaskDeleted(
  workspaceId: string,
  deletedTask: Task,
  userId?: string,
  reason: string = "user_action",
  source: string = "manual"
): Promise<void> {
  await logTaskAudit(workspaceId, deletedTask.id, deletedTask, "delete", userId, {
    reason,
    source
  });
}

/**
 * Log task restoration
 */
export async function logTaskRestored(
  workspaceId: string,
  restoredTask: Task,
  userId?: string,
  fromAuditId?: string
): Promise<void> {
  await logTaskAudit(workspaceId, restoredTask.id, restoredTask, "restore", userId, {
    reason: `Restored from audit entry ${fromAuditId}`,
    source: "audit_restore"
  });
}

/**
 * Log multiple task deletions (for bulk operations like deduplication)
 */
export async function logTasksBulkDeleted(
  workspaceId: string,
  deletedTasks: Task[],
  userId?: string,
  metadata?: { reason?: string; removedCount?: number; dedupKey?: string }
): Promise<void> {
  // Log each deleted task individually for proper auditability
  const promises = deletedTasks.map(task => 
    logTaskAudit(workspaceId, task.id, task, "delete", userId, {
      reason: metadata?.reason || "Bulk deletion",
      source: "bulk_operation",
      ...metadata
    })
  );
  
  await Promise.all(promises);
  console.log(`[Audit] Logged bulk deletion of ${deletedTasks.length} tasks`);
}

// ─── Audit Retrieval Functions ────────────────────────────────────────────────

/**
 * Get audit history for a specific task
 */
export async function getTaskAuditHistory(
  workspaceId: string,
  taskId: string
): Promise<TaskAuditEntry[]> {
  try {
    const { data } = await supabase
      .from("task_audit")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    return (data || [])
      .map(r => ({ id: r.id, ...(r.data as any) } as TaskAuditEntry))
      .filter(e => e.taskId === taskId);
  } catch (error) {
    console.error(`Failed to get audit history for task ${taskId}:`, error);
    return [];
  }
}

/**
 * Get recent deletions for recovery
 */
export async function getRecentDeletedTasks(
  workspaceId: string,
  limit: number = 50
): Promise<TaskAuditEntry[]> {
  try {
    const { data } = await supabase
      .from("task_audit")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit * 5);
    return (data || [])
      .map(r => ({ id: r.id, ...(r.data as any) } as TaskAuditEntry))
      .filter(e => e.action === "delete")
      .slice(0, limit);
  } catch (error) {
    console.error("Failed to get recent deletions:", error);
    return [];
  }
}

/**
 * Search audit logs by task title or job number
 */
export async function searchAuditLogs(
  workspaceId: string,
  searchTerm: string,
  limit: number = 100
): Promise<TaskAuditEntry[]> {
  try {
    const { data } = await supabase
      .from("task_audit")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const allEntries = (data || []).map(r => ({ id: r.id, ...(r.data as any) } as TaskAuditEntry));
    const searchLower = searchTerm.toLowerCase();
    return allEntries.filter(entry =>
      entry.taskData?.title?.toLowerCase().includes(searchLower) ||
      entry.taskData?.jobNumber?.toLowerCase().includes(searchLower) ||
      (entry.taskId || "").toLowerCase().includes(searchLower)
    );
  } catch (error) {
    console.error("Failed to search audit logs:", error);
    return [];
  }
}

/**
 * Get all audit entries for analytics
 */
export async function getAuditSummary(
  workspaceId: string,
  days: number = 7
): Promise<{
  created: number;
  updated: number;
  deleted: number;
  restored: number;
  totalEntries: number;
}> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data } = await supabase
      .from("task_audit")
      .select("*")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since.toISOString());
    const entries = (data || []).map(r => (r.data as any) as TaskAuditEntry);
    const summary = { created: 0, updated: 0, deleted: 0, restored: 0, totalEntries: entries.length };
    entries.forEach(entry => { (summary as any)[entry.action]++; });
    return summary;
  } catch (error) {
    console.error("Failed to get audit summary:", error);
    return { created: 0, updated: 0, deleted: 0, restored: 0, totalEntries: 0 };
  }
}

// ─── Cleanup Functions ─────────────────────────────────────────────────────────

/**
 * Clean up old audit entries (useful for storage management)
 */
export async function cleanupOldAuditEntries(
  workspaceId: string,
  daysToKeep: number = 90
): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const { data } = await supabaseServiceRole
      .from("task_audit")
      .delete()
      .eq("workspace_id", workspaceId)
      .lt("created_at", cutoffDate.toISOString())
      .select("id");
    console.log(`[Audit Cleanup] Removed ${data?.length || 0} old audit entries`);
    return data?.length || 0;
  } catch (error) {
    console.error("Failed to cleanup old audit entries:", error);
    return 0;
  }
}