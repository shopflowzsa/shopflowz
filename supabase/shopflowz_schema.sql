-- ============================================================
-- ShopFlowz — Complete Fresh-Install Database Schema
-- Run this entire file in the Supabase SQL Editor for project:
-- https://supabase.com/dashboard/project/omqqbinhevyuyfgqvkqk
-- ============================================================

-- ── 1. CORE AUTH TABLES ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id            TEXT PRIMARY KEY,
  email         TEXT,
  workspace_id  TEXT,
  is_system_admin BOOLEAN DEFAULT FALSE,
  updated_at    TIMESTAMPTZ
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_profiles_self" ON public.user_profiles;
CREATE POLICY "user_profiles_self" ON public.user_profiles
  FOR ALL TO authenticated USING (id = auth.uid()::TEXT);
GRANT ALL ON public.user_profiles TO authenticated, service_role;

-- ── 2. WORKSPACES ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspaces (
  id                    TEXT PRIMARY KEY,
  name                  TEXT,
  owner_uid             TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  store_slug            TEXT UNIQUE,
  store_enabled         BOOLEAN DEFAULT FALSE,
  custom_domain         TEXT,
  custom_domain_status  TEXT DEFAULT 'none',
  custom_domain_enabled BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspaces_members_read" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_owner_write" ON public.workspaces;
DROP POLICY IF EXISTS "public_store_lookup" ON public.workspaces;
CREATE POLICY "workspaces_members_read" ON public.workspaces
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
    AND workspace_members.uid = auth.uid()::TEXT
  ));
CREATE POLICY "workspaces_owner_write" ON public.workspaces
  FOR ALL TO authenticated
  USING (owner_uid = auth.uid()::TEXT);
CREATE POLICY "public_store_lookup" ON public.workspaces
  FOR SELECT TO anon
  USING (store_enabled = TRUE);
GRANT SELECT, INSERT, UPDATE ON public.workspaces TO authenticated, service_role;

-- ── 3. WORKSPACE MEMBERS ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  uid           TEXT NOT NULL,
  email         TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'editor',
  permissions   TEXT[] DEFAULT NULL,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, uid)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_members_can_view_members" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_can_update_own_profile" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_owners_can_insert_members" ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_owners_can_delete_members" ON public.workspace_members;
CREATE POLICY "workspace_members_can_view_members" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members AS self
    WHERE self.workspace_id = workspace_members.workspace_id
    AND self.uid = auth.uid()::TEXT
  ));
CREATE POLICY "workspace_members_can_update_own_profile" ON public.workspace_members
  FOR UPDATE TO authenticated USING (uid = auth.uid()::TEXT);
CREATE POLICY "workspace_owners_can_insert_members" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members AS self
    WHERE self.workspace_id = workspace_members.workspace_id
    AND self.uid = auth.uid()::TEXT
    AND self.role = 'owner'
  ));
CREATE POLICY "workspace_owners_can_delete_members" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members AS self
    WHERE self.workspace_id = workspace_members.workspace_id
    AND self.uid = auth.uid()::TEXT
    AND self.role = 'owner'
  ));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated, service_role;

-- ── 4. WORKSPACE SETTINGS ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  category      TEXT NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, category)
);

ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_settings_members" ON public.workspace_settings;
CREATE POLICY "workspace_settings_members" ON public.workspace_settings
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = workspace_settings.workspace_id
    AND workspace_members.uid = auth.uid()::TEXT
  ));
GRANT ALL ON public.workspace_settings TO authenticated, service_role;

-- ── 5. WORKSPACE STATE (tasks, lists, spaces) ────────────────

CREATE TABLE IF NOT EXISTS public.workspace_state (
  workspace_id  TEXT PRIMARY KEY,
  state         JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.workspace_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_state_members" ON public.workspace_state;
CREATE POLICY "workspace_state_members" ON public.workspace_state
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = workspace_state.workspace_id
    AND workspace_members.uid = auth.uid()::TEXT
  ));
GRANT ALL ON public.workspace_state TO authenticated, service_role;

-- ── 6. INVITATIONS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invitations (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  workspace_id  TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'editor',
  permissions   TEXT[] DEFAULT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_members_can_view_invitations" ON public.invitations;
DROP POLICY IF EXISTS "workspace_owners_can_insert_invitations" ON public.invitations;
DROP POLICY IF EXISTS "workspace_owners_can_update_invitations" ON public.invitations;
DROP POLICY IF EXISTS "workspace_owners_can_delete_invitations" ON public.invitations;
CREATE POLICY "workspace_members_can_view_invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = invitations.workspace_id
    AND workspace_members.uid = auth.uid()::TEXT
  ));
CREATE POLICY "workspace_owners_can_insert_invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = invitations.workspace_id
    AND workspace_members.uid = auth.uid()::TEXT
    AND workspace_members.role IN ('owner','editor')
  ));
CREATE POLICY "workspace_owners_can_update_invitations" ON public.invitations
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = invitations.workspace_id
    AND workspace_members.uid = auth.uid()::TEXT
    AND workspace_members.role = 'owner'
  ));
CREATE POLICY "workspace_owners_can_delete_invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = invitations.workspace_id
    AND workspace_members.uid = auth.uid()::TEXT
    AND workspace_members.role = 'owner'
  ));
-- Allow service_role to manage invitations (for invitation acceptance flow)
DROP POLICY IF EXISTS "service_role_invitations" ON public.invitations;
CREATE POLICY "service_role_invitations" ON public.invitations
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated, service_role;

-- ── 7. JSONB DOCUMENT TABLES (invoices, inventory, etc.) ─────

CREATE TABLE IF NOT EXISTS public.invoices (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.sales_invoices (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.quotes (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.inventory (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.task_audit (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.form_submissions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.forms (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.documents (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.print_logs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes on all JSONB tables
CREATE INDEX IF NOT EXISTS idx_invoices_ws ON public.invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_ws ON public.sales_invoices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_quotes_ws ON public.quotes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ws ON public.inventory(workspace_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ws ON public.stock_movements(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_audit_ws ON public.task_audit(workspace_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_ws ON public.whatsapp_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_ws ON public.form_submissions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_forms_ws ON public.forms(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_ws ON public.documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_print_logs_ws ON public.print_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_ws ON public.payments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_customers_ws ON public.customers(workspace_id);

-- RLS: authenticated users can access their workspace docs
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['invoices','sales_invoices','quotes','inventory',
    'stock_movements','task_audit','whatsapp_logs','form_submissions','forms',
    'documents','print_logs','payments','customers']) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "ws_members_all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "ws_members_all" ON public.%I FOR ALL TO authenticated USING (
      EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = %I.workspace_id AND uid = auth.uid()::TEXT)
    )', t, t);
    EXECUTE format('GRANT ALL ON public.%I TO authenticated, service_role', t);
  END LOOP;
END $$;

-- ── 8. ORDERS (ecommerce) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_workspace_id_idx ON public.orders(workspace_id);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_authenticated_read" ON public.orders;
DROP POLICY IF EXISTS "orders_service_role_all" ON public.orders;
CREATE POLICY "orders_authenticated_read" ON public.orders FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "orders_service_role_all" ON public.orders FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

-- ── 9. USER CARTS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_carts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  cart_data     JSONB NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS user_carts_user_workspace_idx ON public.user_carts(user_id, workspace_id);
ALTER TABLE public.user_carts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_carts_user_policy" ON public.user_carts;
CREATE POLICY "user_carts_user_policy" ON public.user_carts FOR ALL TO authenticated USING (user_id = auth.uid()::TEXT);
GRANT ALL ON public.user_carts TO authenticated, service_role;

-- ── 10. BANKING TRANSACTIONS ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.banking_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    TEXT NOT NULL,
  transaction_date DATE NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  reference       TEXT,
  card_type       TEXT,
  terminal_id     TEXT,
  description     TEXT,
  matched_invoice_id TEXT,
  match_status    TEXT NOT NULL DEFAULT 'unmatched',
  raw_data        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS banking_transactions_workspace_idx ON public.banking_transactions(workspace_id, transaction_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS banking_transactions_dedup_unique ON public.banking_transactions(workspace_id, reference, transaction_date, amount) WHERE reference IS NOT NULL;
ALTER TABLE public.banking_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "banking_ws_members" ON public.banking_transactions;
CREATE POLICY "banking_ws_members" ON public.banking_transactions FOR ALL USING (TRUE) WITH CHECK (TRUE);
GRANT ALL ON public.banking_transactions TO authenticated, service_role;

-- ── 11. USER ACTIVITIES ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_date TIMESTAMPTZ DEFAULT NOW(),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  entity_title  TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_activities_workspace_user_date_idx ON public.user_activities(workspace_id, user_id, activity_date DESC);
ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_activities_read" ON public.user_activities;
DROP POLICY IF EXISTS "user_activities_insert" ON public.user_activities;
CREATE POLICY "user_activities_read" ON public.user_activities FOR SELECT USING (TRUE);
CREATE POLICY "user_activities_insert" ON public.user_activities FOR INSERT WITH CHECK (user_id = auth.uid()::TEXT);
GRANT ALL ON public.user_activities TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.user_activity_summaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  summary_date  DATE NOT NULL,
  tasks_created INT DEFAULT 0, tasks_updated INT DEFAULT 0, tasks_completed INT DEFAULT 0,
  forms_submitted INT DEFAULT 0, invoices_created INT DEFAULT 0, quotes_created INT DEFAULT 0,
  total_activities INT DEFAULT 0, activity_breakdown JSONB DEFAULT '{}', entity_interactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id, summary_date)
);
ALTER TABLE public.user_activity_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity_summaries_all" ON public.user_activity_summaries;
CREATE POLICY "activity_summaries_all" ON public.user_activity_summaries FOR ALL USING (TRUE) WITH CHECK (TRUE);
GRANT ALL ON public.user_activity_summaries TO authenticated, service_role;

-- ── 12. WORKSPACE SNAPSHOTS ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.workspace_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS ws_snapshots_workspace_idx ON public.workspace_snapshots(workspace_id, snapshot_date DESC);
ALTER TABLE public.workspace_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "snapshots_ws_members" ON public.workspace_snapshots;
CREATE POLICY "snapshots_ws_members" ON public.workspace_snapshots FOR ALL USING (TRUE) WITH CHECK (TRUE);
GRANT ALL ON public.workspace_snapshots TO authenticated, service_role;

-- ── 13. EXPENSE SLIPS ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_slips (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_slips_workspace ON public.expense_slips(workspace_id);
ALTER TABLE public.expense_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_slips_auth" ON public.expense_slips;
CREATE POLICY "expense_slips_auth" ON public.expense_slips FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
GRANT ALL ON public.expense_slips TO authenticated, service_role;

-- ── 14. WARNING RULES ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.warning_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  folder_id     TEXT NOT NULL,
  folder_name   TEXT,
  required_fields TEXT[] DEFAULT '{}',
  warning_message TEXT DEFAULT 'Please fill in the required fields before moving this task.',
  enabled       BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warning_rules_workspace ON public.warning_rules(workspace_id);
ALTER TABLE public.warning_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warning_rules_read" ON public.warning_rules;
DROP POLICY IF EXISTS "warning_rules_manage" ON public.warning_rules;
CREATE POLICY "warning_rules_read" ON public.warning_rules FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE uid = auth.uid()::TEXT));
CREATE POLICY "warning_rules_manage" ON public.warning_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = warning_rules.workspace_id AND uid = auth.uid()::TEXT AND role = 'owner'));
GRANT ALL ON public.warning_rules TO authenticated, service_role;

-- ── 15. TECH DATASHEETS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tech_datasheets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT DEFAULT '',
  folder        TEXT DEFAULT '',
  file_url      TEXT NOT NULL,
  file_type     TEXT,
  file_size     BIGINT,
  uploaded_by   TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tech_datasheets_workspace_id ON public.tech_datasheets(workspace_id);
ALTER TABLE public.tech_datasheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "datasheets_ws_members" ON public.tech_datasheets;
CREATE POLICY "datasheets_ws_members" ON public.tech_datasheets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = tech_datasheets.workspace_id AND uid = auth.uid()::TEXT));
GRANT ALL ON public.tech_datasheets TO authenticated, service_role;

-- ── 16. AI AGENT TABLES ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sr_bot_settings (
  workspace_id  TEXT PRIMARY KEY,
  settings      JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.sr_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  title         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.sr_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.sr_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sr_conversations_workspace ON public.sr_conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sr_messages_conversation ON public.sr_messages(conversation_id);
ALTER TABLE public.sr_bot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sr_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sr_bot_settings_ws" ON public.sr_bot_settings;
DROP POLICY IF EXISTS "sr_conversations_user" ON public.sr_conversations;
DROP POLICY IF EXISTS "sr_messages_user" ON public.sr_messages;
CREATE POLICY "sr_bot_settings_ws" ON public.sr_bot_settings FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "sr_conversations_user" ON public.sr_conversations FOR ALL TO authenticated USING (user_id = auth.uid()::TEXT);
CREATE POLICY "sr_messages_user" ON public.sr_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sr_conversations WHERE id = sr_messages.conversation_id AND user_id = auth.uid()::TEXT));
GRANT ALL ON public.sr_bot_settings, public.sr_conversations, public.sr_messages TO authenticated, service_role;

-- ── 17. EMAIL TABLES ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_email_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL,
  user_id         UUID NOT NULL,
  display_name    TEXT DEFAULT '',
  email_address   TEXT NOT NULL,
  imap_host       TEXT NOT NULL,
  imap_port       INTEGER DEFAULT 993,
  imap_secure     BOOLEAN DEFAULT TRUE,
  imap_username   TEXT NOT NULL,
  imap_password   TEXT NOT NULL,
  sent_folder     TEXT DEFAULT 'Sent',
  smtp_port       INTEGER DEFAULT 465,
  use_for_sending BOOLEAN DEFAULT FALSE,
  signature       TEXT DEFAULT '',
  notification_sound TEXT DEFAULT 'ding',
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.user_email_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL,
  account_id    UUID REFERENCES public.user_email_accounts(id) ON DELETE CASCADE,
  uid           INTEGER NOT NULL,
  folder        TEXT DEFAULT 'INBOX',
  message_id    TEXT,
  subject       TEXT DEFAULT '(no subject)',
  from_name     TEXT,
  from_email    TEXT,
  to_recipients JSONB DEFAULT '[]',
  sent_date     TIMESTAMPTZ,
  body_text     TEXT,
  body_html     TEXT,
  is_read       BOOLEAN DEFAULT FALSE,
  fetched_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id, folder, uid)
);
ALTER TABLE public.user_email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_accounts_own" ON public.user_email_accounts;
DROP POLICY IF EXISTS "email_messages_own" ON public.user_email_messages;
CREATE POLICY "email_accounts_own" ON public.user_email_accounts FOR ALL USING (user_id = auth.uid());
CREATE POLICY "email_messages_own" ON public.user_email_messages FOR ALL USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_email_messages_user_folder ON public.user_email_messages(user_id, folder, sent_date DESC);
GRANT ALL ON public.user_email_accounts, public.user_email_messages TO authenticated, service_role;

-- ── 18. HELPER FUNCTIONS ─────────────────────────────────────

CREATE OR REPLACE FUNCTION check_user_workspace_membership(p_uid TEXT)
RETURNS TABLE(workspace_id TEXT, role TEXT, email TEXT, display_name TEXT) AS $$
BEGIN
  RETURN QUERY SELECT wm.workspace_id, wm.role::TEXT, wm.email, wm.display_name
  FROM public.workspace_members wm WHERE wm.uid = p_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION check_user_workspace_membership(TEXT) TO authenticated, service_role;

-- ── DONE ─────────────────────────────────────────────────────
-- All tables, indexes, RLS policies and grants created.
-- ShopFlowz database is ready.
