# Setting up Supabase for Vocco

Vocco keeps accounts and credits in its **own** Supabase project (not Offro's). About 10 minutes. The keys go in your
local `apps/server/.env` (and later the host's settings), never in chat, issues or commits.

## 1. Create the project

1. https://supabase.com/dashboard → **New project**.
2. Name: `vocco`. Region: the one closest to your users (e.g. **Central EU (Frankfurt)** for Europe).
3. Set a strong database password and keep it in your password manager (the app doesn't need it).

## 2. Create the tables

1. In the project: **SQL Editor → New query**.
2. Paste all of [`db/schema.sql`](../db/schema.sql) and press **Run**. It should finish with "Success. No rows returned".
3. Safe to run again later (when the schema changes): it only adds and replaces, it never drops data.

What it creates: `accounts` (credit balance), `credit_ledger` (every change), `trial_claims` (free-trial checks, hashes
only), `api_costs` (what requests cost us, numbers only), the `spend_credits` / `grant_credits` functions, and row level
security (users can only read their own account and ledger; only the server writes).

## 3. Copy the keys into the server's `.env`

**Project settings → API Keys**:

| `.env` | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | Project settings → Data API → Project URL (`https://<ref>.supabase.co`) | |
| `SUPABASE_SECRET_KEY` | API Keys → **Secret keys** (`sb_secret_…`) | Server only. Full access to the database. |
| `SUPABASE_PUBLISHABLE_KEY` | API Keys → **Publishable key** (`sb_publishable_…`) | Used by the web app for sign-in (#9). Safe to expose. |

Older projects may only show the legacy keys: put the `service_role` key in `SUPABASE_SERVICE_ROLE_KEY` and the `anon`
key in `SUPABASE_ANON_KEY` instead (the server accepts either).

## 4. Check it

```bash
npm run dev:server
```

The server log should say **`Supabase: connected, schema in place.`** Otherwise it says what's wrong:

- `SUPABASE_URL / SUPABASE_SECRET_KEY are not set` — the `.env` lines are empty.
- `couldn't connect (Database error 401 …)` — the key is wrong (or it's the publishable key in the secret slot).
- `missing tables: …` — step 2 wasn't run (or ran in another project).

`http://localhost:8787/health` also shows `"accounts": true`.

## 5. Sign-in (#9)

Once Supabase is set up, Vocco asks people to sign in before a session (Home and topics stay open). Two ways in:
an emailed link, and Google.

**Where people come back to.** Authentication → **URL Configuration**:
- **Site URL:** your production address once you have one (e.g. `https://vocco.app`); `http://localhost:5173` until then.
- **Redirect URLs:** add `http://localhost:5173/**` (local work) and later `https://<your domain>/**`. A sign-in link
  only returns to an address on this list; anything else falls back to the Site URL.

**Email links** work out of the box (Authentication → Providers → Email is on by default). Supabase's built-in
email sender is only for testing: it sends very few emails an hour. Before real users, set your own sender in
Authentication → **Emails → SMTP Settings** (for example Resend: host `smtp.resend.com`, port 465, user `resend`, the
password is a Resend API key, and a sender on your own domain).

**Google:**
1. Google Cloud Console → APIs & Services → **Credentials → Create credentials → OAuth client ID** → Web application.
2. **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase shows this exact URL
   on the Google provider page).
3. Copy the client ID and secret into Supabase → Authentication → Providers → **Google** → enable → Save.
4. In the Google consent screen, set the app name (Vocco), support email and your domain.

**Check it:** `npm run dev`, open http://localhost:5173, press **Sign in**, send yourself a link, open it on the same
device: you come back signed in, and **Account** shows your email and 0 credits (free credits come with #11).

## 6. Production

Put the same three variables in the host's environment settings (#28), add the production address to the
Redirect URLs, and set **`TRIAL_SECRET`** to a long random value (`openssl rand -hex 32`) once: it's the key for the
anonymous free-credit hashes, so never change it afterwards.
- Nothing in CI needs these keys: CI tests the schema on its own throwaway Postgres (`db/test/run.sh`).

## Manual credit changes

In the SQL Editor (the ref must be unique; it's what stops double grants):

```sql
select public.grant_credits('<user uuid>', 20, 'Support: goodwill', 'manual:2026-11-13-1');
select public.spend_credits('<user uuid>', 60, 'Refund', -100000);
```

Find a user's uuid in **Authentication → Users**.
