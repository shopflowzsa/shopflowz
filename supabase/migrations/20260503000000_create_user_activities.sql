-- User Activities: store user activity data for generating reports
create table if not exists public.user_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id text not null,
  activity_type text not null, -- task_created, task_updated, task_completed, form_submitted, invoice_created, etc.
  activity_date timestamptz not null default now(),
  entity_type text not null, -- task, invoice, quote, form, etc.
  entity_id text, -- ID of the related entity
  entity_title text, -- Title or name of the related entity
  metadata jsonb not null default '{}', -- Additional context data
  created_at timestamptz not null default now()
);

-- Indexes for efficient querying
create index if not exists user_activities_workspace_user_date_idx
on public.user_activities (workspace_id, user_id, activity_date desc);

create index if not exists user_activities_activity_type_idx
on public.user_activities (workspace_id, activity_type, activity_date desc);

create index if not exists user_activities_entity_idx
on public.user_activities (workspace_id, entity_type, entity_id);

alter table public.user_activities enable row level security;

-- RLS policies
create policy "workspace members can view workspace activities"
on public.user_activities for select
using (true);

create policy "users can insert their own activities"
on public.user_activities for insert
with check (user_id = auth.uid());

-- Daily activity summaries (pre-aggregated for performance)
create table if not exists public.user_activity_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id text not null,
  summary_date date not null,
  tasks_created integer not null default 0,
  tasks_updated integer not null default 0,
  tasks_completed integer not null default 0,
  forms_submitted integer not null default 0,
  invoices_created integer not null default 0,
  quotes_created integer not null default 0,
  total_activities integer not null default 0,
  activity_breakdown jsonb not null default '{}', -- Detailed breakdown by activity type
  entity_interactions jsonb not null default '{}', -- Summary of interactions with entities
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint user_activity_summaries_workspace_user_date_unique unique (workspace_id, user_id, summary_date)
);

-- Index for fetching summaries
create index if not exists user_activity_summaries_workspace_date_idx
on public.user_activity_summaries (workspace_id, summary_date desc);

alter table public.user_activity_summaries enable row level security;

-- RLS policies
create policy "workspace members can view activity summaries"
on public.user_activity_summaries for select
using (true);

create policy "system can manage activity summaries"
on public.user_activity_summaries for all
using (true)
with check (true);