-- Store account dashboard support.

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_workspace_id_idx ON public.orders(workspace_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON public.orders(created_at DESC);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_authenticated_read ON public.orders;
CREATE POLICY orders_authenticated_read ON public.orders
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS orders_service_role_all ON public.orders;
CREATE POLICY orders_service_role_all ON public.orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
