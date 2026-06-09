CREATE TABLE IF NOT EXISTS public.sequence_counters (
  workspace_id TEXT NOT NULL,
  counter_type TEXT NOT NULL,
  counter      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, counter_type)
);
GRANT ALL ON public.sequence_counters TO authenticated, service_role;

INSERT INTO public.sequence_counters (workspace_id, counter_type, counter)
SELECT workspace_id, 'invoice', COALESCE(MAX(CASE WHEN data->>'number' ~ '^[0-9]+$' THEN (data->>'number')::BIGINT ELSE 0 END), 0)
FROM public.invoices GROUP BY workspace_id
ON CONFLICT (workspace_id, counter_type) DO UPDATE SET counter = GREATEST(sequence_counters.counter, EXCLUDED.counter);

INSERT INTO public.sequence_counters (workspace_id, counter_type, counter)
SELECT workspace_id, 'quote', COALESCE(MAX(CASE WHEN data->>'number' ~ '^[0-9]+$' THEN (data->>'number')::BIGINT ELSE 0 END), 0)
FROM public.quotes GROUP BY workspace_id
ON CONFLICT (workspace_id, counter_type) DO UPDATE SET counter = GREATEST(sequence_counters.counter, EXCLUDED.counter);

CREATE OR REPLACE FUNCTION public.claim_next_counter(p_workspace_id TEXT, p_counter_type TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE v_counter BIGINT;
BEGIN
  INSERT INTO public.sequence_counters(workspace_id, counter_type, counter)
  VALUES (p_workspace_id, p_counter_type, 1)
  ON CONFLICT (workspace_id, counter_type)
  DO UPDATE SET counter = sequence_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.claim_next_counter(TEXT, TEXT) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  target_email TEXT,
  performed_by TEXT,
  ip           TEXT,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
GRANT ALL ON public.admin_audit_log TO service_role;
