/**
 * Stale Task Service
 *
 * Helpers for the two stale-task warning rules:
 *   • block_new_in_stale_list — when creating a task in a list/folder, check
 *     if any existing task there has been sitting longer than the threshold.
 *     If so, the create is hard-blocked.
 *   • stale_task — periodically warn reception that a task in any folder is
 *     overdue and require them to enter a reason (logged to activity).
 *
 * Acknowledgements are stored in stale_task_acknowledgements with a
 * snooze_until timestamp, so the same task doesn't pop up every page load —
 * once reception explains it, the bot waits before asking again.
 */

import { supabase, supabaseServiceRole } from "@/lib/supabase";
import type { WarningRule } from "@/components/crm/WarningRulesPanel";
import type { Task, List } from "@/types/crm";
import { getInvoices } from "@/lib/invoiceService";
import type { Invoice as SupabaseInvoice } from "@/types/invoice";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StaleAcknowledgement {
  id: string;
  workspace_id: string;
  task_id: string;
  user_id: string;
  reason: string;
  note?: string | null;
  acknowledged_at: string;
  snooze_until: string;
}

// ─── Age helpers ───────────────────────────────────────────────────────────

/**
 * Returns how many full days a task has spent in its current state.
 * Uses createdAt as the floor (no per-list "entered at" timestamp exists in
 * the task model yet — see TODO below).
 *
 * TODO(stale-tasks): once we track when a task entered its current list, use
 * that timestamp instead of createdAt so a job that's been bounced between
 * lists doesn't reset its age. For now createdAt is a conservative proxy.
 */
export function daysInCurrentState(task: Task): number {
  const raw = task.listEnteredAt ?? task.createdAt;
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.floor((Date.now() - ts) / MS_PER_DAY);
}

// ─── Block-new-task check (Rule A) ─────────────────────────────────────────

/**
 * Check whether creating a new task in `listId` is blocked because some
 * existing task in the same list/folder has gone stale.
 *
 * Returns the offender + the matching rule, or null if it's fine.
 */
export function checkBlockNewInStaleList(
  listId: string,
  tasks: Task[],
  lists: List[],
  rules: WarningRule[],
  currentUserId?: string,
): { rule: WarningRule; offender: Task } | null {
  const list = lists.find((l) => l.id === listId);
  if (!list) return null;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.rule_type !== "block_new_in_stale_list") continue;
    if (!rule.stale_threshold_days || rule.stale_threshold_days <= 0) continue;

    // Staff targeting
    if (rule.apply_to_uids?.length) {
      if (!currentUserId || !rule.apply_to_uids.includes(currentUserId)) continue;
    }

    // Rule targets either a specific list or the parent folder.
    const matchesList = rule.list_id && rule.list_id === listId;
    const matchesFolder = rule.folder_id && rule.folder_id === list.parentId;
    if (!matchesList && !matchesFolder) continue;

    const excludeStatuses = new Set((rule.exclude_statuses ?? []).map(s => s.toLowerCase()));

    // Find the oldest task in the same scope as the rule.
    const scope = tasks.filter((t) => {
      if (excludeStatuses.size > 0 && t.status && excludeStatuses.has(t.status.toLowerCase())) return false;
      if (rule.list_id) return t.listId === rule.list_id;
      // Folder scope: any task in any list whose parent is this folder.
      const taskList = lists.find((l) => l.id === t.listId);
      return taskList?.parentId === rule.folder_id;
    });

    const offender = scope
      .filter((t) => daysInCurrentState(t) >= (rule.stale_threshold_days as number))
      .sort((a, b) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
      )[0];

    if (offender) return { rule, offender };
  }

  return null;
}

// ─── Stale-task sweep (Rule B) ─────────────────────────────────────────────

export interface StaleTaskHit {
  rule: WarningRule;
  task: Task;
  daysOverdue: number;
  listName?: string;
}

/**
 * Returns every task that's overdue against any active stale_task rule, MINUS
 * tasks that have an active (non-expired) acknowledgement.
 *
 * Caller decides what to do with the list (show dialog, badge, etc).
 */
export async function findStaleTasks(
  workspaceId: string,
  tasks: Task[],
  lists: List[],
  rules: WarningRule[],
  options: { trigger?: "on_load" | "on_open" | "daily_08"; currentUserId?: string } = {},
): Promise<StaleTaskHit[]> {
  const activeRules = rules.filter((r) => {
    if (!r.enabled || r.rule_type !== "stale_task" || (r.stale_threshold_days ?? 0) <= 0) return false;
    if (options.trigger && (r.stale_check_trigger ?? "on_load") !== options.trigger) return false;
    // Staff targeting
    if (r.apply_to_uids?.length) {
      if (!options.currentUserId || !r.apply_to_uids.includes(options.currentUserId)) return false;
    }
    return true;
  });
  if (activeRules.length === 0) return [];

  // Build hits
  const hits: StaleTaskHit[] = [];
  for (const rule of activeRules) {
    const excludeStatuses = new Set((rule.exclude_statuses ?? []).map(s => s.toLowerCase()));
    const scope = tasks.filter((t) => {
      if (excludeStatuses.size > 0 && t.status && excludeStatuses.has(t.status.toLowerCase())) return false;
      if (rule.list_id) return t.listId === rule.list_id;
      const taskList = lists.find((l) => l.id === t.listId);
      return taskList?.parentId === rule.folder_id;
    });
    for (const t of scope) {
      const days = daysInCurrentState(t);
      if (days < (rule.stale_threshold_days as number)) continue;
      hits.push({
        rule,
        task: t,
        daysOverdue: days - (rule.stale_threshold_days as number),
        listName: lists.find((l) => l.id === t.listId)?.name,
      });
    }
  }
  if (hits.length === 0) return [];

  // Filter out tasks that have an unexpired acknowledgement.
  const taskIds = [...new Set(hits.map((h) => h.task.id))];
  const { data } = await supabase
    .from("stale_task_acknowledgements")
    .select("task_id, snooze_until")
    .eq("workspace_id", workspaceId)
    .in("task_id", taskIds);
  const snoozedIds = new Set<string>();
  const now = Date.now();
  for (const row of data || []) {
    if (new Date(row.snooze_until).getTime() > now) snoozedIds.add(row.task_id);
  }

  return hits.filter((h) => !snoozedIds.has(h.task.id));
}

// ─── Invoice-collected check (Rule D) ──────────────────────────────────────

export interface InvoicedTaskHit {
  rule: WarningRule;
  task: Task;
  invoice: SupabaseInvoice;
  listName?: string;
}

/**
 * Fetches invoices from Supabase and finds tasks in the target folder/list
 * that have a matching invoice (by purchaseOrder = task.jobNumber) but are
 * still sitting in storage — meaning the customer was invoiced but staff
 * haven't moved or closed the job.
 *
 * currentUserId: only rules that target this user (or everyone) fire.
 */
export async function checkInvoicedTasksInStorage(
  workspaceId: string,
  tasks: Task[],
  lists: List[],
  rules: WarningRule[],
  currentUserId?: string,
): Promise<InvoicedTaskHit[]> {
  const activeRules = rules.filter((r) => {
    if (!r.enabled || r.rule_type !== "invoice_collected") return false;
    if (r.apply_to_uids && r.apply_to_uids.length > 0) {
      if (!currentUserId) return false;
      if (!r.apply_to_uids.includes(currentUserId)) return false;
    }
    return true;
  });
  if (activeRules.length === 0) return [];

  // Fetch all invoices from Supabase and build a lookup by purchaseOrder (= job number only)
  const allInvoices = await getInvoices(workspaceId);
  const invoiceByJobNumber = new Map<string, SupabaseInvoice>();
  for (const inv of allInvoices) {
    const po = ((inv as any).purchaseOrder as string | undefined)?.toUpperCase().trim();
    // Only index entries that look like job numbers (JOB-xxxx) to avoid false matches
    if (po && po.startsWith("JOB-")) invoiceByJobNumber.set(po, inv);
  }

  const rawHits: InvoicedTaskHit[] = [];

  for (const rule of activeRules) {
    const excludeStatuses = new Set((rule.exclude_statuses ?? []).map(s => s.toLowerCase()));

    const scope = tasks.filter((t) => {
      if (excludeStatuses.size > 0 && t.status && excludeStatuses.has(t.status.toLowerCase())) return false;
      if (rule.list_id) return t.listId === rule.list_id;
      const taskList = lists.find((l) => l.id === t.listId);
      return taskList?.parentId === rule.folder_id;
    });

    for (const task of scope) {
      const jobKey = task.jobNumber?.toUpperCase().trim();
      if (!jobKey || !jobKey.startsWith("JOB-")) continue;
      const invoice = invoiceByJobNumber.get(jobKey);
      if (!invoice) continue;
      rawHits.push({
        rule,
        task,
        invoice,
        listName: lists.find((l) => l.id === task.listId)?.name,
      });
    }
  }

  if (rawHits.length === 0) return [];

  // Filter out tasks already snoozed (acknowledged within the last 24h)
  const taskIds = [...new Set(rawHits.map((h) => h.task.id))];
  const { data: ackData } = await supabase
    .from("stale_task_acknowledgements")
    .select("task_id, snooze_until")
    .eq("workspace_id", workspaceId)
    .in("task_id", taskIds);
  const snoozedIds = new Set<string>();
  const now = Date.now();
  for (const row of ackData || []) {
    if (new Date(row.snooze_until).getTime() > now) snoozedIds.add(row.task_id);
  }

  return rawHits.filter((h) => !snoozedIds.has(h.task.id));
}

// ─── Record a stale-task acknowledgement ───────────────────────────────────

/**
 * Reception explained why a stale task is still sitting. We:
 *   1. Insert an acknowledgement row with a snooze period (default 24h) so
 *      the bot stops nagging about this same task until tomorrow.
 *   2. Add a system comment to the task so it shows up in the activity feed.
 *   3. Write to user_activities so the AI assistant and reports can see it.
 */
export async function recordStaleReason(args: {
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  userName: string;
  reason: string;
  note?: string | null;
  snoozeHours?: number;
}): Promise<boolean> {
  const snoozeMs = (args.snoozeHours ?? 24) * 60 * 60 * 1000;
  const snoozeUntil = new Date(Date.now() + snoozeMs).toISOString();
  try {
    const { error } = await supabaseServiceRole.from("stale_task_acknowledgements").insert({
      workspace_id: args.workspaceId,
      task_id: args.taskId,
      user_id: args.userId,
      reason: args.reason,
      note: args.note ?? null,
      snooze_until: snoozeUntil,
    });
    if (error) {
      console.error("[staleTaskService] insert failed:", error);
      return false;
    }

    // Mirror to user_activities so the AI/staff reports can surface it.
    await supabaseServiceRole.from("user_activities").insert({
      workspace_id: args.workspaceId,
      user_id: args.userId,
      activity_type: "task_updated",
      activity_date: new Date().toISOString(),
      entity_type: "task",
      entity_id: args.taskId,
      entity_title: args.taskTitle,
      metadata: {
        kind: "stale_task_acknowledged",
        reason: args.reason,
        note: args.note ?? null,
      },
    });

    return true;
  } catch (err) {
    console.error("[staleTaskService] recordStaleReason threw:", err);
    return false;
  }
}
