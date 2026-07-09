-- Custom AI Agents — owner-created, bring-your-own-Claude-API-key bots.
-- Separate from sr_bot_settings (standard NVIDIA-backed assistant) and
-- ai_assistant_settings — purely additive, does not touch either.

CREATE TABLE IF NOT EXISTS custom_ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  agent_name TEXT NOT NULL DEFAULT 'Custom Agent',
  avatar_emoji TEXT NOT NULL DEFAULT '🤖',
  model TEXT NOT NULL DEFAULT 'claude-3-5-haiku-20241022',
  system_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant for a workspace management app. Be concise and honest.',
  api_key TEXT NOT NULL DEFAULT '',
  has_api_key BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  visibility_mode TEXT NOT NULL DEFAULT 'all' CHECK (visibility_mode IN ('all', 'selected')),
  position_index INT NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_ai_agents_workspace ON custom_ai_agents(workspace_id);

ALTER TABLE custom_ai_agents ENABLE ROW LEVEL SECURITY;

-- Per-agent staff allow-list, only consulted when visibility_mode = 'selected'
CREATE TABLE IF NOT EXISTS custom_ai_agent_access (
  agent_id UUID NOT NULL REFERENCES custom_ai_agents(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  PRIMARY KEY (agent_id, uid)
);

ALTER TABLE custom_ai_agent_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read custom agents they're allowed to see" ON custom_ai_agents;
CREATE POLICY "Members can read custom agents they're allowed to see"
  ON custom_ai_agents FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE uid = auth.uid()::TEXT)
    AND (
      visibility_mode = 'all'
      OR EXISTS (
        SELECT 1 FROM custom_ai_agent_access
        WHERE agent_id = custom_ai_agents.id AND uid = auth.uid()::TEXT
      )
      OR EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = custom_ai_agents.workspace_id AND uid = auth.uid()::TEXT AND role = 'owner'
      )
    )
  );

DROP POLICY IF EXISTS "Owners can manage custom agents" ON custom_ai_agents;
CREATE POLICY "Owners can manage custom agents"
  ON custom_ai_agents FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = custom_ai_agents.workspace_id AND uid = auth.uid()::TEXT AND role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_id = custom_ai_agents.workspace_id AND uid = auth.uid()::TEXT AND role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Owners can manage agent access lists" ON custom_ai_agent_access;
CREATE POLICY "Owners can manage agent access lists"
  ON custom_ai_agent_access FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM custom_ai_agents a
      JOIN workspace_members wm ON wm.workspace_id = a.workspace_id
      WHERE a.id = custom_ai_agent_access.agent_id AND wm.uid = auth.uid()::TEXT AND wm.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM custom_ai_agents a
      JOIN workspace_members wm ON wm.workspace_id = a.workspace_id
      WHERE a.id = custom_ai_agent_access.agent_id AND wm.uid = auth.uid()::TEXT AND wm.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "Members can read their own access rows" ON custom_ai_agent_access;
CREATE POLICY "Members can read their own access rows"
  ON custom_ai_agent_access FOR SELECT
  TO authenticated
  USING (uid = auth.uid()::TEXT);
