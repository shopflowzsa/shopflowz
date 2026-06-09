-- Idempotent migration: ensure every table the import/export service touches
-- exists with the correct shape, indexes, RLS, and grants.
-- Safe to re-run: uses CREATE IF NOT EXISTS / DROP POLICY IF EXISTS throughout.
-- No existing data is touched.

-- ── invitations: ensure invited_by column exists ──────────────────────────────
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS invited_by TEXT;

-- ── workspace_state ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_state (
  workspace_id TEXT PRIMARY KEY,
  state        JSONB NOT NULL DEFAULT '{}'
);
ALTER TABLE public.workspace_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_state_members" ON public.workspace_state;
CREATE POLICY "workspace_state_members" ON public.workspace_state FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = workspace_state.workspace_id
      AND workspace_members.uid = auth.uid()::TEXT
  ));
GRANT ALL ON public.workspace_state TO authenticated, service_role;

-- ── workspace_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  category     TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, category)
);
CREATE INDEX IF NOT EXISTS idx_workspace_settings_ws ON public.workspace_settings(workspace_id);
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_settings_members" ON public.workspace_settings;
CREATE POLICY "workspace_settings_members" ON public.workspace_settings FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_members.workspace_id = workspace_settings.workspace_id
      AND workspace_members.uid = auth.uid()::TEXT
  ));
GRANT ALL ON public.workspace_settings TO authenticated, service_role;

-- ── Simple tables (id TEXT PK, workspace_id, data JSONB) ──────────────────────

-- customers
CREATE TABLE IF NOT EXISTS public.customers (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_ws ON public.customers(workspace_id);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_members" ON public.customers;
CREATE POLICY "customers_members" ON public.customers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = customers.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.customers TO authenticated, service_role;

-- invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_ws ON public.invoices(workspace_id);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoices_members" ON public.invoices;
CREATE POLICY "invoices_members" ON public.invoices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = invoices.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.invoices TO authenticated, service_role;

-- sales_invoices
CREATE TABLE IF NOT EXISTS public.sales_invoices (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_ws ON public.sales_invoices(workspace_id);
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_invoices_members" ON public.sales_invoices;
CREATE POLICY "sales_invoices_members" ON public.sales_invoices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = sales_invoices.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.sales_invoices TO authenticated, service_role;

-- quotes
CREATE TABLE IF NOT EXISTS public.quotes (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotes_ws ON public.quotes(workspace_id);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotes_members" ON public.quotes;
CREATE POLICY "quotes_members" ON public.quotes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = quotes.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.quotes TO authenticated, service_role;

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_ws ON public.payments(workspace_id);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_members" ON public.payments;
CREATE POLICY "payments_members" ON public.payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = payments.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.payments TO authenticated, service_role;

-- inventory
CREATE TABLE IF NOT EXISTS public.inventory (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_ws ON public.inventory(workspace_id);
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_members" ON public.inventory;
CREATE POLICY "inventory_members" ON public.inventory FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = inventory.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.inventory TO authenticated, service_role;

-- stock_movements
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ws ON public.stock_movements(workspace_id);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_movements_members" ON public.stock_movements;
CREATE POLICY "stock_movements_members" ON public.stock_movements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = stock_movements.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.stock_movements TO authenticated, service_role;

-- orders
CREATE TABLE IF NOT EXISTS public.orders (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_ws ON public.orders(workspace_id);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_members" ON public.orders;
CREATE POLICY "orders_members" ON public.orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = orders.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.orders TO authenticated, service_role;

-- ecommerce_customers
CREATE TABLE IF NOT EXISTS public.ecommerce_customers (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ecommerce_customers_ws ON public.ecommerce_customers(workspace_id);
ALTER TABLE public.ecommerce_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ecommerce_customers_members" ON public.ecommerce_customers;
CREATE POLICY "ecommerce_customers_members" ON public.ecommerce_customers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = ecommerce_customers.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.ecommerce_customers TO authenticated, service_role;

-- forms
CREATE TABLE IF NOT EXISTS public.forms (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_forms_ws ON public.forms(workspace_id);
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "forms_members" ON public.forms;
CREATE POLICY "forms_members" ON public.forms FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = forms.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.forms TO authenticated, service_role;

-- form_submissions
CREATE TABLE IF NOT EXISTS public.form_submissions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_ws ON public.form_submissions(workspace_id);
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_submissions_members" ON public.form_submissions;
CREATE POLICY "form_submissions_members" ON public.form_submissions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = form_submissions.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.form_submissions TO authenticated, service_role;

-- documents
CREATE TABLE IF NOT EXISTS public.documents (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_ws ON public.documents(workspace_id);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "documents_members" ON public.documents;
CREATE POLICY "documents_members" ON public.documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = documents.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.documents TO authenticated, service_role;

-- whatsapp_logs
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_ws ON public.whatsapp_logs(workspace_id);
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_logs_members" ON public.whatsapp_logs;
CREATE POLICY "whatsapp_logs_members" ON public.whatsapp_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = whatsapp_logs.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.whatsapp_logs TO authenticated, service_role;

-- expense_slips
CREATE TABLE IF NOT EXISTS public.expense_slips (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_slips_ws ON public.expense_slips(workspace_id);
ALTER TABLE public.expense_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_slips_members" ON public.expense_slips;
CREATE POLICY "expense_slips_members" ON public.expense_slips FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = expense_slips.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.expense_slips TO authenticated, service_role;

-- banking_transactions
CREATE TABLE IF NOT EXISTS public.banking_transactions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_banking_transactions_ws ON public.banking_transactions(workspace_id);
ALTER TABLE public.banking_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "banking_transactions_members" ON public.banking_transactions;
CREATE POLICY "banking_transactions_members" ON public.banking_transactions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_members.workspace_id = banking_transactions.workspace_id AND workspace_members.uid = auth.uid()::TEXT));
GRANT ALL ON public.banking_transactions TO authenticated, service_role;
