-- Run this once in the Supabase SQL editor.
create table if not exists public.account_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  trades jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.account_states enable row level security;

drop policy if exists "Users can read their account state" on public.account_states;
create policy "Users can read their account state"
on public.account_states for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their account state" on public.account_states;
create policy "Users can insert their account state"
on public.account_states for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their account state" on public.account_states;
create policy "Users can update their account state"
on public.account_states for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
