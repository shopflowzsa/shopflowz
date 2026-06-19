-- Fix new-user registration stuck on "Setting up workspace"
-- Run in: https://supabase.com/dashboard/project/omqqbinhevyuyfgqvkqk/sql/new

-- ── 1. user_profiles: add missing columns ────────────────────────────────────
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS display_name  TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS phone         TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS address       TEXT;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT NOW();

-- ── 2. workspaces: add missing columns ───────────────────────────────────────
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS plan                   TEXT DEFAULT 'free';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS has_crm_access         BOOLEAN DEFAULT TRUE;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS subscription_status    TEXT DEFAULT 'none';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS subscription_tier      TEXT DEFAULT 'none';
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS trial_ends_at          TIMESTAMPTZ;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS subscription_ends_at   TIMESTAMPTZ;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS monthly_price          NUMERIC;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS brand_name             TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS brand_logo             TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS hidden_features        TEXT[];

-- ── 3. workspace_members: fix INSERT policy (chicken-and-egg on first row) ───
-- Old policy required user to already be a member before they can insert —
-- which blocks new users from adding themselves as the first (owner) row.
DROP POLICY IF EXISTS "workspace_owners_can_insert_members" ON public.workspace_members;
CREATE POLICY "workspace_owners_can_insert_members" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    -- New workspace owner bootstrapping: allow inserting yourself as owner
    (uid = auth.uid()::TEXT AND role = 'owner')
    OR
    -- Existing owner adding another member to their workspace
    EXISTS (
      SELECT 1 FROM public.workspace_members AS self
      WHERE self.workspace_id = workspace_members.workspace_id
        AND self.uid = auth.uid()::TEXT
        AND self.role = 'owner'
    )
  );
