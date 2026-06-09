-- Per-user IMAP account credentials (one per user per workspace)
CREATE TABLE IF NOT EXISTS user_email_accounts (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id      uuid NOT NULL,
  user_id           uuid NOT NULL,
  display_name      text NOT NULL DEFAULT '',
  email_address     text NOT NULL,
  imap_host         text NOT NULL,
  imap_port         integer NOT NULL DEFAULT 993,
  imap_secure       boolean NOT NULL DEFAULT true,
  imap_username     text NOT NULL,
  imap_password     text NOT NULL,
  sent_folder       text NOT NULL DEFAULT 'Sent',
  smtp_port         integer NOT NULL DEFAULT 465,
  use_for_sending   boolean NOT NULL DEFAULT false,
  signature         text NOT NULL DEFAULT '',
  notification_sound text NOT NULL DEFAULT 'ding',
  last_synced_at    timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Cached email messages (synced from IMAP)
CREATE TABLE IF NOT EXISTS user_email_messages (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id  uuid NOT NULL,
  user_id       uuid NOT NULL,
  account_id    uuid REFERENCES user_email_accounts(id) ON DELETE CASCADE,
  uid           integer NOT NULL,
  folder        text NOT NULL DEFAULT 'INBOX',
  message_id    text,
  subject       text NOT NULL DEFAULT '(no subject)',
  from_name     text,
  from_email    text,
  to_recipients jsonb NOT NULL DEFAULT '[]',
  sent_date     timestamptz,
  body_text     text,
  body_html     text,
  is_read       boolean NOT NULL DEFAULT false,
  fetched_at    timestamptz DEFAULT now(),
  UNIQUE(workspace_id, user_id, folder, uid)
);

-- RLS
ALTER TABLE user_email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_email_messages  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own email accounts"
  ON user_email_accounts FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "users manage own email messages"
  ON user_email_messages FOR ALL
  USING (user_id = auth.uid());

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_messages_user_folder
  ON user_email_messages(user_id, folder, sent_date DESC);
