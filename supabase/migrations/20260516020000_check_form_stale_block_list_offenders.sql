-- Replace check_form_stale_block to return EVERY stale task in scope, not just
-- the oldest one. Reception needs to see which specific jobs are blocking
-- (the kanban shows e.g. 10 tasks, but maybe only one has aged past threshold).
-- The function returns at most 25 offenders to keep payloads bounded; if more
-- exist the `total_stale` field exceeds `stale_tasks.length`.

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
  v_offenders       jsonb;
  v_total_stale     int;
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
    -- Count + collect all tasks past the threshold for this rule's scope.
    WITH scoped AS (
      SELECT
        t,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - (t->>'createdAt')::timestamptz)) / 86400)::int AS days_old
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
    ),
    stale AS (
      SELECT * FROM scoped WHERE days_old >= v_rule.stale_threshold_days
    )
    SELECT
      COUNT(*)::int,
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'title',      t->>'title',
          'job_number', t->>'jobNumber',
          'days_old',   days_old
        )
        ORDER BY days_old DESC
      ) FILTER (WHERE rn <= 25), '[]'::jsonb)
    INTO v_total_stale, v_offenders
    FROM (
      SELECT t, days_old, ROW_NUMBER() OVER (ORDER BY days_old DESC) AS rn FROM stale
    ) ranked;

    IF v_total_stale > 0 THEN
      RETURN jsonb_build_object(
        'blocked',         true,
        'list_name',       v_list_name,
        'threshold',       v_rule.stale_threshold_days,
        'warning_message', v_rule.warning_message,
        'total_stale',     v_total_stale,
        'stale_tasks',     v_offenders
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('blocked', false);
END $$;

REVOKE ALL ON FUNCTION public.check_form_stale_block(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_form_stale_block(text) TO anon, authenticated;
