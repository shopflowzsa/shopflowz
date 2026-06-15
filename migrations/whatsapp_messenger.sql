-- ─── WhatsApp Messenger Tables ───────────────────────────────────────────────
-- Run this in your Supabase Dashboard → SQL Editor

-- One conversation per contact phone number per workspace
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT        NOT NULL,
  contact_phone TEXT        NOT NULL,
  contact_name  TEXT,
  last_message  TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  unread_count  INT         NOT NULL DEFAULT 0,
  window_expires_at TIMESTAMPTZ,          -- 24h from last INBOUND message
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, contact_phone)
);

-- Every individual message (inbound and outbound)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT        NOT NULL,
  conversation_id UUID        NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  wamid           TEXT        UNIQUE,     -- WhatsApp Message ID from Meta (null for temp rows)
  direction       TEXT        NOT NULL CHECK (direction IN ('inbound','outbound')),
  message_type    TEXT        NOT NULL DEFAULT 'text',
  content         TEXT,
  media_url       TEXT,
  status          TEXT        NOT NULL DEFAULT 'sent',
  sent_by_id      TEXT,                   -- auth uid if outbound
  sent_by_name    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wa_convs_workspace    ON whatsapp_conversations (workspace_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msgs_conversation  ON whatsapp_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_wa_msgs_workspace     ON whatsapp_messages (workspace_id);

-- ─── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages      ENABLE ROW LEVEL SECURITY;

-- Workspace members can read/write their own workspace conversations
CREATE POLICY "wa_convs_workspace_access" ON whatsapp_conversations
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text
    )
  );

CREATE POLICY "wa_msgs_workspace_access" ON whatsapp_messages
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()::text
    )
  );

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Required for live updates in the app

ALTER TABLE whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE whatsapp_messages      REPLICA IDENTITY FULL;

-- Add to realtime publication (run separately if the above fails)
-- ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_conversations;
-- ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_messages;
