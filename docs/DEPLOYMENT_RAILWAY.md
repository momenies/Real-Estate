# Deploying on Railway with Supabase

The platform runs as **one** Railway service. Scheduled work (broadcast
dispatch, draft finalisation, subscription reminders) runs inside it via the
NestJS scheduler, so there is no worker to deploy and no Redis to pay for.

## 1. Database (Supabase)

1. Create a Supabase project - this is the single central database for the whole
   network.
2. From **Project Settings → Database** take both connection strings:
   - pooled (port 6543) → `DATABASE_URL`, add `?pgbouncer=true`
   - direct (port 5432) → `DIRECT_URL`, used by migrations

Prisma needs the direct URL because migrations cannot run through a transaction
pooler.

## 2. Storage

Create a public bucket named `property-media` (Storage → New bucket). Take the
**service role** key from Project Settings → API for `SUPABASE_SERVICE_ROLE_KEY`.

Public URLs matter beyond convenience: TikTok's `PULL_FROM_URL` publishing and
the Haraj copy-paste page both need URLs reachable without a header.

## 3. Railway service

Point Railway at the repository. `railway.json` already defines:

```
build:  npm ci && npx prisma generate && npm run build
start:  npx prisma migrate deploy && node dist/main.js
health: /health
```

Migrations run at start, so a fresh environment converges on its own. `/health`
executes `SELECT 1`, so a deploy that cannot reach the database fails its
healthcheck instead of serving errors.

## 4. Environment variables

Copy from `.env.example`. The ones a deploy will not work without:

| Variable | Note |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | pooled / direct |
| `PUBLIC_URL` | the Railway HTTPS domain; used for webhooks and share links |
| `JWT_SECRET` | long random string |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | created on first boot |
| `WHATSAPP_VERIFY_TOKEN` | same value as in the Meta dashboard |
| `WHATSAPP_APP_SECRET` | **required in production** - authenticates webhooks |
| `WHATSAPP_ACCESS_TOKEN` | permanent System User token |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | media mirroring |

## 5. After the first deploy

1. Change the super admin password (it was logged as a warning on boot).
2. Point the Meta webhook at `https://<domain>/webhooks/whatsapp`.
3. Onboard the first office (see [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md)).

## Hardening the database role (recommended)

The RLS migration creates an unprivileged `aqar_app` role. To get
defence-in-depth from PostgreSQL as well as from the application layer, give
that role a password and point `DATABASE_URL` at it, keeping `DIRECT_URL` on the
owner for migrations:

```sql
ALTER ROLE aqar_app WITH LOGIN PASSWORD 'a-strong-password';
```

Then any query that fails to set `app.current_office_id` returns nothing instead
of everything.

## Scaling notes

- `numReplicas` is 1 on purpose. The dispatcher guards against overlapping
  passes **within** a process; running two replicas would need a database
  advisory lock around `dispatchPending()` first.
- The send rate is per office, so more offices scale linearly without any one
  number speeding up.
- `property_deliveries` grows as offices × properties × customers. It is indexed
  on `(officeId, leadId, sentAt)`; archive it by office once it becomes large.
