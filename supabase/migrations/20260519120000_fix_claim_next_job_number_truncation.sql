-- Fix: claim_next_job_number was using LPAD(text, 4, '0'), which TRUNCATES
-- when the input is longer than 4 chars. Once jobCounter exceeded 9999,
-- every call started returning "JOB-1411" (the first 4 digits) regardless
-- of the actual counter value, causing repeated job numbers on the form.
--
-- Fix: pad to at least 4 — never truncate. Use GREATEST(4, length(...))
-- as the LPAD width so longer numbers pass through unchanged.

CREATE OR REPLACE FUNCTION public.claim_next_job_number(p_workspace_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_counter int;
  v_existing jsonb;
BEGIN
  SELECT state INTO v_existing
  FROM workspace_state
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  IF v_existing IS NULL THEN
    v_new_counter := 1;
    INSERT INTO workspace_state (workspace_id, state)
    VALUES (
      p_workspace_id,
      jsonb_build_object(
        'spaces', '[]'::jsonb,
        'folders', '[]'::jsonb,
        'lists', '[]'::jsonb,
        'tasks', '[]'::jsonb,
        'customFields', '[]'::jsonb,
        'forms', '[]'::jsonb,
        'jobCounter', v_new_counter
      )
    )
    ON CONFLICT (workspace_id) DO UPDATE
      SET state = jsonb_set(
        workspace_state.state,
        '{jobCounter}',
        to_jsonb(COALESCE((workspace_state.state->>'jobCounter')::int, 0) + 1)
      );
    SELECT (state->>'jobCounter')::int INTO v_new_counter
    FROM workspace_state
    WHERE workspace_id = p_workspace_id;
  ELSE
    v_new_counter := COALESCE((v_existing->>'jobCounter')::int, 0) + 1;
    UPDATE workspace_state
    SET state = jsonb_set(state, '{jobCounter}', to_jsonb(v_new_counter))
    WHERE workspace_id = p_workspace_id;
  END IF;

  -- Pad to AT LEAST 4 digits; never truncate.
  RETURN 'JOB-' || LPAD(v_new_counter::text, GREATEST(4, length(v_new_counter::text)), '0');
END;
$function$;
