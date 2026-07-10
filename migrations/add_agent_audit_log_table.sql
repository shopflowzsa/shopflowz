-- Dedicated business-event audit log for the future monitoring agent's daily
-- report — distinct from user_activities (staff activity feed) and task_audit
-- (task edit-history/recovery). Each row is one reportable event with a full
-- line-item snapshot (including custom fields) captured at the time it
-- happened, so a later report doesn't need to re-derive context from the
-- current state of the record (which may have changed since).
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('booking_created', 'status_collected', 'stock_sold', 'stock_booked_out')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_title TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_log_workspace ON agent_audit_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_occurred ON agent_audit_log(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_type ON agent_audit_log(workspace_id, event_type);

ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read agent audit log" ON agent_audit_log;
CREATE POLICY "Members can read agent audit log"
  ON agent_audit_log FOR SELECT
  TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE uid = auth.uid()::TEXT));
