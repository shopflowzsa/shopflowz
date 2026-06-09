-- Public-form stale-task gate.
--
-- The "+ Add Task" path inside the admin app already runs
-- checkBlockNewInStaleList. Public booking forms (PublicForm.tsx) are
-- unauthenticated, so they can't read warning_rules / workspace_state directly.
-- These two SECURITY DEFINER functions expose just the minimum needed to
--   1. tell the form whether it should refuse to render, and
--   2. accept a supervisor password to bypass the block.

-- 1) Block check ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_form_stale_block(p_form_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form_data       jsonb;
  v_workspace_id    text;
  v_target_list_id  text;
  v_state           jsonb;
  v_lists           jsonb;
  v_tasks           jsonb;
  v_target_list     jsonb;
  v_target_parent   text;
  v_list_name       text;
  v_rule            record;
  v_offender_title  text;
  v_offender_age    int;
BEGIN
  SELECT data INTO v_form_data FROM forms WHERE id = p_form_id;
  IF v_form_data IS NULL THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;

  v_workspace_id   := v_form_data->>'workspaceId';
  v_target_list_id := v_form_data->>'targetListId';
  IF v_workspace_id IS NULL OR v_target_list_id IS NULL THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;

  SELECT state INTO v_state FROM workspace_state WHERE workspace_id = v_workspace_id;
  IF v_state IS NULL THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;
  v_lists := v_state->'lists';
  v_tasks := v_state->'tasks';

  SELECT lst INTO v_target_list
  FROM jsonb_array_elements(v_lists) AS lst
  WHERE lst->>'id' = v_target_list_id;
  IF v_target_list IS NULL THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;
  v_target_parent := v_target_list->>'parentId';
  v_list_name     := v_target_list->>'name';

  FOR v_rule IN
    SELECT id, list_id, folder_id, stale_threshold_days, warning_message
    FROM warning_rules
    WHERE workspace_id = v_workspace_id
      AND enabled = true
      AND rule_type = 'block_new_in_stale_list'
      AND COALESCE(stale_threshold_days, 0) > 0
      AND (
        (list_id IS NOT NULL AND list_id = v_target_list_id)
        OR (folder_id IS NOT NULL AND folder_id = v_target_parent)
      )
  LOOP
    SELECT t->>'title',
           FLOOR(EXTRACT(EPOCH FROM (NOW() - (t->>'createdAt')::timestamptz)) / 86400)::int
    INTO v_offender_title, v_offender_age
    FROM jsonb_array_elements(v_tasks) AS t
    WHERE (t->>'createdAt') IS NOT NULL
      AND COALESCE((t->>'archived')::boolean, false) = false
      AND CASE
        WHEN v_rule.list_id IS NOT NULL THEN t->>'listId' = v_rule.list_id
        ELSE EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_lists) AS l
          WHERE l->>'id' = t->>'listId' AND l->>'parentId' = v_rule.folder_id
        )
      END
      AND FLOOR(EXTRACT(EPOCH FROM (NOW() - (t->>'createdAt')::timestamptz)) / 86400)
            >= v_rule.stale_threshold_days
    ORDER BY (t->>'createdAt')::timestamptz ASC
    LIMIT 1;

    IF v_offender_title IS NOT NULL THEN
      RETURN jsonb_build_object(
        'blocked',         true,
        'list_name',       v_list_name,
        'offender_title',  v_offender_title,
        'days_old',        v_offender_age,
        'threshold',       v_rule.stale_threshold_days,
        'warning_message', v_rule.warning_message
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('blocked', false);
END $$;

REVOKE ALL ON FUNCTION public.check_form_stale_block(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_form_stale_block(text) TO anon, authenticated;


-- 2) Supervisor-code bypass ────────────────────────────────────────────────
-- Mirrors hashSupervisorPassword(): SHA-256 of `${salt}:${password}` as lowercase hex.
CREATE OR REPLACE FUNCTION public.verify_form_supervisor_code(p_form_id text, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_workspace_id text;
  v_settings     jsonb;
  v_salt         text;
  v_hash         text;
BEGIN
  IF p_code IS NULL OR length(p_code) = 0 THEN RETURN false; END IF;

  SELECT (data->>'workspaceId') INTO v_workspace_id FROM forms WHERE id = p_form_id;
  IF v_workspace_id IS NULL THEN RETURN false; END IF;

  SELECT data INTO v_settings
  FROM workspace_settings
  WHERE workspace_id = v_workspace_id AND category = 'supervisor_security';
  IF v_settings IS NULL THEN RETURN false; END IF;

  v_salt := v_settings->>'salt';
  v_hash := v_settings->>'passwordHash';
  IF v_salt IS NULL OR v_hash IS NULL THEN RETURN false; END IF;

  RETURN encode(extensions.digest(v_salt || ':' || p_code, 'sha256'), 'hex') = v_hash;
END $$;

REVOKE ALL ON FUNCTION public.verify_form_supervisor_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_form_supervisor_code(text, text) TO anon, authenticated;
