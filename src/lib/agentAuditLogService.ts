// Business-event audit log feeding the (future) monitoring agent's daily
// report. Separate from activityTrackingService.ts (generic staff activity
// feed) — this only captures the four report-relevant event types, each with
// a full line-item snapshot so a report built later doesn't need to re-derive
// context from whatever the record looks like by then.
import { supabaseServiceRole } from './supabase';

export type AgentAuditEventType = 'booking_created' | 'status_collected' | 'stock_sold' | 'stock_booked_out';

// Full context snapshot for a task-related event, including raw custom field
// values (fieldId + value pairs) — labels are resolved later at report time
// against the workspace's customFields definitions, keeping this write path
// simple.
export function taskAuditSnapshot(task: Record<string, unknown>): Record<string, unknown> {
  return {
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    jobNumber: task.jobNumber,
    assignees: task.assignees ?? (task.assignee ? [task.assignee] : []),
    customFieldValues: task.customFieldValues ?? [],
  };
}

export async function logAgentAuditEvent(
  workspaceId: string,
  eventType: AgentAuditEventType,
  entityType: string,
  entityId: string,
  entityTitle: string | undefined,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseServiceRole.from('agent_audit_log').insert({
      workspace_id: workspaceId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      entity_title: entityTitle ?? null,
      details,
    });
  } catch (err) {
    // Audit logging must never break the write it's observing.
    console.error(`[agentAuditLogService] Failed to log ${eventType} for ${entityType}:${entityId}:`, err);
  }
}
