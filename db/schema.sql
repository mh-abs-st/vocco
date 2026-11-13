-- Vocco: accounts, credits, free trials and cost tracking.
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run. Safe to run again (it only adds and
-- replaces; it never drops data). Pattern adapted from Offro's schema, for Vocco's own Supabase project.
--
-- Who can do what:
--   * Signed-in users (the web app, with the publishable key and their session) may READ their own account and
--     ledger rows. Nothing else.
--   * Only the server (the secret key) writes, through the functions below.

-- ---------------------------------------------------------------------------------------------------------------
-- Accounts: one row per user, with the credit balance.
create table if not exists public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  credits integer not null default 0,        -- free credits are added by the server after the trial checks (#11)
  trial_status text,                         -- 'granted' or 'denied:<reason>' (#11)
  paddle_customer_id text unique,            -- payments (#13)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every change to a balance: purchases and free credits (+), live minutes and reports (−).
-- `ref` makes grants idempotent (a payment id: webhook retries are harmless) and merges one live session's
-- minutes into one line (ref 'session:<id>').
create table if not exists public.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text not null,
  ref text unique,
  balance_after integer,
  amount_cents integer,                      -- what a purchase actually cost the buyer (for /admin/usage)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, updated_at desc);

-- An account row for every new user. It starts at 0 credits: the server adds the free credits once the trial
-- checks pass (#11).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (user_id, email, credits) values (new.id, new.email, 0)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Spend credits atomically. Returns the new balance, or null if it would go below p_floor (0 normally; a live
-- session may be allowed a small negative floor so it isn't cut off mid-sentence, #10). The same p_ref adds to
-- one ledger line (one line per session, not one per minute).
create or replace function public.spend_credits(p_user uuid, p_amount integer, p_reason text, p_floor integer default 0, p_ref text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  update public.accounts set credits = credits - p_amount, updated_at = now()
    where user_id = p_user and credits - p_amount >= p_floor
    returning credits into v_balance;
  if not found then return null; end if;
  insert into public.credit_ledger (user_id, delta, reason, ref, balance_after)
    values (p_user, -p_amount, p_reason, p_ref, v_balance)
  on conflict (ref) do update
    set delta = public.credit_ledger.delta - p_amount, balance_after = v_balance, updated_at = now();
  return v_balance;
end $$;

-- Add credits once per p_ref. Returns the new balance (unchanged if that ref was already granted).
create or replace function public.grant_credits(p_user uuid, p_amount integer, p_reason text, p_ref text, p_amount_cents integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_ref is null then raise exception 'a grant needs a ref'; end if;
  insert into public.credit_ledger (user_id, delta, reason, ref, amount_cents) values (p_user, p_amount, p_reason, p_ref, p_amount_cents)
  on conflict (ref) do nothing;
  if not found then
    select credits into v_balance from public.accounts where user_id = p_user;
    return v_balance; -- already granted
  end if;
  update public.accounts set credits = credits + p_amount, updated_at = now()
    where user_id = p_user returning credits into v_balance;
  update public.credit_ledger set balance_after = v_balance where ref = p_ref;
  return v_balance;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Free trial checks (#11): which browsers, networks and emails already had free credits.
-- Only keyed hashes are stored (never the raw IP address, browser id or email).
create table if not exists public.trial_claims (
  id bigserial primary key,
  kind text not null check (kind in ('browser', 'network', 'email')),
  key_hash text not null,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists trial_claims_key_idx on public.trial_claims (kind, key_hash, created_at desc);
-- Claims older than a year can be removed:  delete from public.trial_claims where created_at < now() - interval '12 months';

-- ---------------------------------------------------------------------------------------------------------------
-- What each request cost us (#12): Claude tokens, speech-to-text seconds, pronunciation seconds, voice characters.
-- Numbers only: never a transcript, a report or anything the user said.
create table if not exists public.api_costs (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete set null,
  activity text not null,                    -- 'session', 'report', …
  provider text not null,                    -- 'anthropic', 'deepgram', 'azure', 'tts'
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  audio_seconds numeric not null default 0,
  characters integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists api_costs_created_idx on public.api_costs (created_at);
-- Cost rows older than two years can be removed:  delete from public.api_costs where created_at < now() - interval '24 months';

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security.
alter table public.accounts enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.trial_claims enable row level security;  -- no policies: only the server reads and writes
alter table public.api_costs enable row level security;     -- no policies: only the server reads and writes

drop policy if exists "read own account" on public.accounts;
create policy "read own account" on public.accounts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "read own ledger" on public.credit_ledger;
create policy "read own ledger" on public.credit_ledger for select to authenticated using ((select auth.uid()) = user_id);

-- Only the server may call these (Supabase lets anon/authenticated call public functions by default).
revoke execute on function public.spend_credits(uuid, integer, text, integer, text) from public, anon, authenticated;
revoke execute on function public.grant_credits(uuid, integer, text, text, integer) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Manual adjustments (SQL Editor):
--   add (goodwill, support; the ref must be unique):  select public.grant_credits('<user uuid>', 20, 'Support: goodwill', 'manual:2026-11-13-1');
--   remove (after a refund; may go negative):         select public.spend_credits('<user uuid>', 60, 'Refund', -100000);
