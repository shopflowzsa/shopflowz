-- Per-agent opt-in web search — lets a Custom AI Agent look up current
-- information (e.g. prices) via Anthropic's server-side web search tool
-- instead of answering only from its system prompt.
ALTER TABLE custom_ai_agents ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN NOT NULL DEFAULT false;
