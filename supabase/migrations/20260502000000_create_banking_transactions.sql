-- Banking & Matching: store imported card machine transactions
create table if not exists public.banking_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  transaction_date date not null,
  amount numeric(10,2) not null,
  reference text,
  card_type text,
  terminal_id text,
  description text,
  matched_invoice_id text,
  match_status text not null default 'unmatched', -- unmatched | matched | ignored
  raw_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists banking_transactions_workspace_idx
on public.banking_transactions (workspace_id, transaction_date desc);

-- Partial unique index for deduplication: only enforces uniqueness when reference is NOT NULL
-- This allows multiple NULL references (handled by client-side dedup) while preventing true duplicates
drop index if exists banking_transactions_dedup_unique;
create unique index banking_transactions_dedup_unique
on public.banking_transactions (workspace_id, reference, transaction_date, amount)
where reference is not null;

alter table public.banking_transactions enable row level security;

create policy "workspace members can manage banking transactions"
on public.banking_transactions for all
using (true)
with check (true);
