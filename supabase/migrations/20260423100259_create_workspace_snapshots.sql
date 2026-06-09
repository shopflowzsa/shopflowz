create table if not exists public.workspace_snapshots (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text not null,
  snapshot_date   date not null,
  state           jsonb not null default '{}',
  task_count      integer not null default 0,
  created_at      timestamptz not null default now(),

  constraint workspace_snapshots_workspace_date_unique unique (workspace_id, snapshot_date)
);

-- Index for fetching snapshots by workspace
create index if not exists workspace_snapshots_workspace_id_idx
  on public.workspace_snapshots (workspace_id, snapshot_date desc);

-- RLS
alter table public.workspace_snapshots enable row level security;

create policy "workspace members can manage snapshots"
  on public.workspace_snapshots
  for all
  using (true)
  with check (true);
