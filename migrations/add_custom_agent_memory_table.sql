-- Real persistent memory for Custom AI Agents. Without this, an agent's
-- "I've logged this to memory" was just conversational text — nothing was
-- ever saved, so facts vanished the moment the chat was closed. This table
-- is what the agent's save_memory tool actually writes to; entries are then
-- re-injected into its system prompt on every future call.
--
-- workspace_id is denormalized (not just derivable via agent_id) so this
-- table's RLS never needs to query custom_ai_agents — see
-- fix_custom_ai_agents_access_rls.sql for why that matters (avoids the
-- policy-recursion bug fixed there).

CREATE TABLE IF NOT EXISTS custom_agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES custom_ai_agents(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (agent_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_custom_agent_memory_agent ON custom_agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_custom_agent_memory_workspace ON custom_agent_memory(workspace_id);

ALTER TABLE custom_agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read agent memory" ON custom_agent_memory;
CREATE POLICY "Members can read agent memory"
  ON custom_agent_memory FOR SELECT
  TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE uid = auth.uid()::TEXT));

DROP POLICY IF EXISTS "Owners can manage agent memory" ON custom_agent_memory;
CREATE POLICY "Owners can manage agent memory"
  ON custom_agent_memory FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = custom_agent_memory.workspace_id AND uid = auth.uid()::TEXT AND role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = custom_agent_memory.workspace_id AND uid = auth.uid()::TEXT AND role = 'owner'
    )
  );
