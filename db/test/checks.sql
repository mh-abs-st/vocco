-- Checks for db/schema.sql (run by db/test/run.sh after applying the schema twice). Any failure raises.
\set ON_ERROR_STOP on

-- Two users; the signup trigger makes their accounts.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

do $$
declare a uuid := '11111111-1111-1111-1111-111111111111'; v integer; n integer;
begin
  select credits into v from public.accounts where user_id = a;
  if v is distinct from 0 then raise exception 'new account should start at 0 credits, got %', v; end if;

  -- Grants are idempotent per ref.
  v := public.grant_credits(a, 10, 'Welcome', 'welcome:a');
  if v <> 10 then raise exception 'grant: expected 10, got %', v; end if;
  v := public.grant_credits(a, 10, 'Welcome', 'welcome:a');
  if v <> 10 then raise exception 'grant twice: expected 10, got %', v; end if;
  v := public.grant_credits(a, 30, 'Purchase', 'paddle:txn_1', 900);
  if v <> 40 then raise exception 'purchase: expected 40, got %', v; end if;
  if (select amount_cents from public.credit_ledger where ref = 'paddle:txn_1') <> 900 then raise exception 'amount_cents not kept'; end if;

  -- Spending with the same ref adds to one ledger line (one line per session).
  v := public.spend_credits(a, 1, 'Live session', 0, 'session:s1');
  v := public.spend_credits(a, 1, 'Live session', 0, 'session:s1');
  v := public.spend_credits(a, 1, 'Live session', 0, 'session:s1');
  if v <> 37 then raise exception 'spend: expected 37, got %', v; end if;
  select count(*), min(delta) into n, v from public.credit_ledger where ref = 'session:s1';
  if n <> 1 or v <> -3 then raise exception 'session line: expected one line of -3, got % lines, delta %', n, v; end if;
  if (select balance_after from public.credit_ledger where ref = 'session:s1') <> 37 then raise exception 'balance_after not updated'; end if;

  -- Not below the floor.
  v := public.spend_credits(a, 100, 'Report', 0, null);
  if v is not null then raise exception 'spending past 0 should fail, got %', v; end if;
  if (select credits from public.accounts where user_id = a) <> 37 then raise exception 'a failed spend changed the balance'; end if;
  -- A small negative floor lets a live session finish its minute.
  v := public.spend_credits(a, 39, 'Live session', -2, 'session:s2');
  if v <> -2 then raise exception 'negative floor: expected -2, got %', v; end if;
  v := public.spend_credits(a, 1, 'Live session', -2, 'session:s2');
  if v is not null then raise exception 'past the negative floor should fail'; end if;

  -- Bad input.
  begin perform public.spend_credits(a, 0, 'x'); raise exception 'zero spend allowed';
  exception when raise_exception then if sqlerrm = 'zero spend allowed' then raise; end if; end;
  begin perform public.grant_credits(a, 5, 'x', null); raise exception 'grant without ref allowed';
  exception when raise_exception then if sqlerrm = 'grant without ref allowed' then raise; end if; end;
end $$;

-- Row level security, as the web app (a signed-in user) sees it.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select count(*) from public.accounts) <> 1 then raise exception 'a user should see only their own account'; end if;
  if exists (select from public.credit_ledger where user_id <> '11111111-1111-1111-1111-111111111111') then raise exception 'saw another user''s ledger'; end if;
  if (select count(*) from public.credit_ledger) = 0 then raise exception 'should see own ledger'; end if;
  if (select count(*) from public.trial_claims) <> 0 or (select count(*) from public.api_costs) <> 0 then raise exception 'trial_claims/api_costs must be hidden'; end if;
end $$;
do $$ begin
  update public.accounts set credits = 1000000;
  if found then raise exception 'a user could change their credits'; end if;
end $$;
do $$ begin
  insert into public.credit_ledger (user_id, delta, reason) values ('11111111-1111-1111-1111-111111111111', 1000, 'free money');
  raise exception 'a user could write to the ledger';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.grant_credits('11111111-1111-1111-1111-111111111111', 1000, 'free money', 'hack:1');
  raise exception 'a user could call grant_credits';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.spend_credits('22222222-2222-2222-2222-222222222222', 1, 'grief', -1000);
  raise exception 'a user could call spend_credits';
exception when insufficient_privilege then null; end $$;
reset role;

set role anon;
do $$ begin
  if (select count(*) from public.accounts) <> 0 then raise exception 'anon should see no accounts'; end if;
end $$;
reset role;

select 'schema checks passed' as result;
