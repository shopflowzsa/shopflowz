-- Fix "infinite recursion detected in policy for relation custom_ai_agents" (42P17).
--
-- Root cause: custom_ai_agents' SELECT policy checks custom_ai_agent_access,
-- and custom_ai_agent_access's "Owners can manage" policy joined back to
-- custom_ai_agents to verify ownership — a policy-evaluation cycle.
--
-- Fix: denormalize workspace_id onto custom_ai_agent_access so its own RLS
-- policies never need to query custom_ai_agents at all, breaking the cycle.

ALTER TABLE custom_ai_agent_access ADD COLUMN IF NOT EXISTS workspace_id TEXT;

UPDATE custom_ai_agent_access aa
SET workspace_id = a.workspace_id
FROM custom_ai_agents a
WHERE aa.agent_id = a.id AND aa.workspace_id IS NULL;

ALTER TABLE custom_ai_agent_access ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_ai_agent_access_workspace ON custom_ai_agent_access(workspace_id);

DROP POLICY IF EXISTS "Owners can manage agent access lists" ON custom_ai_agent_access;
CREATE POLICY "Owners can manage agent access lists"
  ON custom_ai_agent_access FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = custom_ai_agent_access.workspace_id AND wm.uid = auth.uid()::TEXT AND wm.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = custom_ai_agent_access.workspace_id AND wm.uid = auth.uid()::TEXT AND wm.role = 'owner'
    )
  );

-- "Members can read their own access rows" is unchanged — already only checks uid.
