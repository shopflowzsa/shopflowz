-- Create a PostgreSQL function to generate user activity summaries
create or replace function generate_user_activity_summary(
  p_workspace_id text,
  p_user_id text,
  p_date date
) returns boolean language plpgsql security definer as $$
declare
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_tasks_created int := 0;
  v_tasks_updated int := 0;
  v_tasks_completed int := 0;
  v_forms_submitted int := 0;
  v_invoices_created int := 0;
  v_quotes_created int := 0;
  v_total_activities int := 0;
  v_activity_breakdown jsonb := '{}'::jsonb;
  v_entity_interactions jsonb := '{}'::jsonb;
  v_temp_record record;
begin
  -- Set time range for the given date
  v_start_time := p_date::text || ' 00:00:00'::text;
  v_end_time := p_date::text || ' 23:59:59'::text;
  
  -- Count activities by type
  select count(*) into v_tasks_created
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_type = 'task_created'
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  select count(*) into v_tasks_updated
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_type = 'task_updated'
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  select count(*) into v_tasks_completed
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_type = 'task_completed'
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  select count(*) into v_forms_submitted
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_type = 'form_submitted'
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  select count(*) into v_invoices_created
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_type = 'invoice_created'
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  select count(*) into v_quotes_created
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_type = 'quote_created'
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  select count(*) into v_total_activities
  from user_activities
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and activity_date >= v_start_time
    and activity_date <= v_end_time;
  
  -- Build activity breakdown JSON
  v_activity_breakdown := '{}'::jsonb;
  for v_temp_record in 
    select activity_type, count(*) as count
    from user_activities
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and activity_date >= v_start_time
      and activity_date <= v_end_time
    group by activity_type
  loop
    v_activity_breakdown := v_activity_breakdown || jsonb_build_object(v_temp_record.activity_type, v_temp_record.count);
  end loop;
  
  -- Build entity interactions JSON
  v_entity_interactions := '{}'::jsonb;
  for v_temp_record in 
    select entity_type, jsonb_agg(distinct entity_id) as entity_ids
    from user_activities
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and activity_date >= v_start_time
      and activity_date <= v_end_time
      and entity_id is not null
    group by entity_type
  loop
    v_entity_interactions := v_entity_interactions || jsonb_build_object(v_temp_record.entity_type, v_temp_record.entity_ids);
  end loop;
  
  -- Insert or update summary record
  insert into user_activity_summaries (
    workspace_id, user_id, summary_date,
    tasks_created, tasks_updated, tasks_completed,
    forms_submitted, invoices_created, quotes_created,
    total_activities, activity_breakdown, entity_interactions,
    created_at, updated_at
  ) values (
    p_workspace_id, p_user_id, p_date,
    v_tasks_created, v_tasks_updated, v_tasks_completed,
    v_forms_submitted, v_invoices_created, v_quotes_created,
    v_total_activities, v_activity_breakdown, v_entity_interactions,
    now(), now()
  )
  on conflict (workspace_id, user_id, summary_date)
  do update set
    tasks_created = v_tasks_created,
    tasks_updated = v_tasks_updated,
    tasks_completed = v_tasks_completed,
    forms_submitted = v_forms_submitted,
    invoices_created = v_invoices_created,
    quotes_created = v_quotes_created,
    total_activities = v_total_activities,
    activity_breakdown = v_activity_breakdown,
    entity_interactions = v_entity_interactions,
    updated_at = now();
  
  return true;
exception
  when others then
    raise notice 'Error generating activity summary: %', SQLERRM;
    return false;
end;
$$;

-- Add a trigger to automatically generate summaries when activities are added
create or replace function auto_generate_activity_summary() 
returns trigger language plpgsql as $$
declare
  v_date date;
begin
  -- Extract date part from activity_date
  v_date := date(NEW.activity_date);
  
  -- Call the summary generation function asynchronously via pg_notify
  perform pg_notify(
    'generate_summary', 
    json_build_object(
      'workspace_id', NEW.workspace_id, 
      'user_id', NEW.user_id, 
      'date', v_date
    )::text
  );
  
  return NEW;
end;
$$;

-- Create trigger on user_activities
drop trigger if exists user_activity_summary_trigger on user_activities;
create trigger user_activity_summary_trigger
after insert on user_activities
for each row
execute function auto_generate_activity_summary();