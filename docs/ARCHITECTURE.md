# Architecture

## The shape of the problem

A traditional real-estate office has an owner who will not learn a dashboard, a
pile of properties that live in his phone's camera roll, and a customer list
that lives in his WhatsApp chat history. Anything that asks him to change how he
works will be abandoned in a week.

So the product is inverted: **the office owner's interface is the WhatsApp
conversation he already uses all day.** Everything else - the database, the
network effects, the admin console - exists behind that conversation and is
never shown to him.

## One database, many offices

Every office is a row, not a schema and not a deployment.

```
offices ──┬── office_settings   (anti-spam guardrails)
          ├── subscriptions     (3-month trial -> paid)
          ├── users             (the owner's WhatsApp identity)
          ├── properties ── property_media
          ├── leads
          ├── conversations     (per-person bot state)
          ├── broadcasts ── broadcast_recipients
          ├── property_deliveries  (the deduplication ledger)
          ├── lead_daily_quotas    (the daily cap counter)
          └── external_accounts / external_publications
```

Every tenant-owned table carries `officeId`. That single choice is what makes
the network view possible later: one `GROUP BY` spans the whole market, whereas
a database-per-office design would have made it a data-migration project.

## Isolation, twice

Isolation is enforced in two independent layers, because the whole proposition
collapses the first time one office sees another's inventory.

**1. Application layer** — `src/common/prisma/tenant.extension.ts`

A Prisma client extension rewrites every query for the office in scope:

- reads get the tenant filter merged into `where`
- writes are *stamped* with `officeId`, so a forged id in a request body is
  overwritten rather than trusted
- a unique lookup pinned to another office is refused outright
- a tenant query with **no** office in scope throws, rather than silently
  returning everything

The scope itself lives in an `AsyncLocalStorage` opened by
`TenantContextMiddleware`. This has to be middleware rather than a guard:
`AsyncLocalStorage` only survives inside the callback it was started with, and
middleware's `next()` is the one place that encloses the guards, the handler and
every service call beneath it.

One subtlety worth knowing: Prisma promises are **lazy**. `TenantStore.runAsOffice`
awaits its callback *inside* the scope for that reason - returning an unawaited
Prisma promise would run the query after the scope had already closed, with no
tenant filter attached. There is a regression test for this.

**2. Database layer** — `prisma/migrations/*_row_level_security`

PostgreSQL RLS policies enforce the same rule for anything that reaches the
database outside the application: the Supabase SQL editor, a BI tool, a future
service. The API connects as an unprivileged `aqar_app` role which sets
`app.current_office_id` on the connection; migrations keep running as the owner,
which is not subject to the policies.

`PrismaService.runInTenantTransaction()` combines both: it opens a transaction,
sets the database-level tenant with `SET LOCAL` (transaction-scoped, so nothing
leaks to the next borrower of a pooled connection), and runs the work inside the
application scope too.

The super admin is the single principal that lifts the filter, in both layers.

## The owner's conversation

```
photo, photo, video, "فيلا للبيع النرجس 1.85 مليون", 📍pin
        │
        ▼
  one DRAFT property, media attached, text parsed
        │  (owner stops typing for ~25s)
        ▼
  DraftFinalizerService asks for the ONE missing field,
  or shows the summary with [نشر] [تعديل] [إلغاء]
        │
        ▼
  PUBLISHED  →  [عملاء آخر شهر] [عملاء آخر أسبوع] [لاحقاً]
```

Two design decisions carry this flow:

**Drafts group a burst.** Photos, a video, the price and a location pin arrive
as separate WhatsApp messages over several minutes. They all land on the same
open draft, so the owner never has to "start" or "finish" anything.

**The bot waits for a pause.** Replying to each of eight photos would be
unbearable, so `DraftFinalizerService` watches for ~25 seconds of silence and
then responds exactly once. That debounce is the difference between a tool that
feels calm and one that feels like a chatbot.

Free text is parsed by `src/common/utils/property-parser.ts`, which reads
Arabic-Indic digits, `مليون`/`الف` multipliers, districts, areas, room counts
and features. It blanks out measurements *before* looking for a price, so
"مساحة 400 م 5 غرف" can never be mistaken for an asking price.

## The customer's conversation

A customer who writes nothing but "السلام عليكم" still ends up as a qualified
lead: quick-reply buttons capture intent, property type, district and budget in
four taps, `lastSearchAt` is stamped, and the latest matching offers are sent
immediately.

`lastSearchAt` is the field that makes the owner's mental model work. When he
says "send it to everyone who searched this month", he means people who
*expressed a need*, not people who happened to open a chat.

## Broadcasting

Recipients are resolved **when the broadcast is planned**, and every exclusion is
written down as a row with its reason - so the owner can be told why 40
customers became 12, and a retry never re-litigates a decision.

`BroadcastDispatcherService` then sends in small paced batches. It is a
database-backed queue rather than Redis, so the platform runs as a single
Railway service. Before each individual send it re-runs the anti-spam check,
because another broadcast may have reached that customer in the meantime.

See [ANTI_SPAM.md](ANTI_SPAM.md) for the rules and their precedence.

## Subscriptions

An office starts on a 90-day trial the moment it is created. When the period
ends there is a grace window, and only then do **writes** freeze - adding
inventory and broadcasting, the things the subscription pays for. Reading and
receiving messages never stop, and no data is deleted, so renewing restores
everything instantly. That asymmetry is deliberate: an office that loses its
customer list on day 91 tells every other office in town.

## Why these technology choices

- **NestJS** — the module graph maps onto the domain, and its scheduler removes
  the need for a separate worker service.
- **Prisma** — the client extension is what makes tenant isolation structural
  rather than a rule people must remember.
- **PostgreSQL/Supabase** — RLS and `GROUP BY` in the same engine; storage for
  media in the same account.
- **No Redis** — one service is cheaper to run and simpler to reason about; the
  send rate is deliberately slow anyway.
- **WhatsApp Cloud API** — the official path. Unofficial libraries get numbers
  banned, and the number *is* the office's business.
