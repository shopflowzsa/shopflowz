-- Per-agent opt-in access to the app's own business data (agent_audit_log) —
-- lets an agent like a "monitoring agent" actually answer "what happened
-- today" instead of having no tool to look anything up with. Off by default,
-- same reasoning as web_search_enabled: not every custom agent should see
-- business data by default.
ALTER TABLE custom_ai_agents ADD COLUMN IF NOT EXISTS app_data_access BOOLEAN NOT NULL DEFAULT false;
