# Running the platform

## Onboarding an office

1. Add its number in the Meta dashboard, copy the `phone_number_id`.
2. `POST /api/offices` as super admin (see [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md)).
   This creates the office, its guardrail settings, the owner's WhatsApp
   identity, and the 90-day trial in one transaction.
3. Ask the owner to send anything to the number. He needs no training beyond:
   *"send me the photos, the price, the district, and the location pin."*

## What runs on a schedule

| Job | Cadence | What it does |
|---|---|---|
| `DraftFinalizerService` | 10s | Finds drafts idle ~25s and replies once - asks for the missing field, or shows the summary |
| `BroadcastDispatcherService` | 30s | Sends queued broadcasts, paced, re-checking anti-spam before each message |
| `SubscriptionsScheduler` | daily 09:00 | Reminds owners at 14/7/3/1 days, expires lapsed subscriptions |

All three guard against overlapping runs and log rather than throw, so one bad
office cannot stall the others.

## Daily checks

```bash
curl https://<domain>/health
curl -H "Authorization: Bearer <token>" https://<domain>/api/admin/overview
curl -H "Authorization: Bearer <token>" https://<domain>/api/admin/subscriptions/expiring?days=14
```

`overview` is the honest picture of the network: offices, published properties,
customers, active customers in the last 30 days, broadcasts, and deliveries.

## Converting a trial

```bash
curl -X POST https://<domain>/api/admin/offices/<officeId>/subscription/activate \
  -H "Authorization: Bearer <super-admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{"plan":"BASIC","months":12,"priceSar":3600}'
```

Activation extends from the *current* end date, so converting early never costs
the office the remainder of its trial.

## When an owner says "the customer got it twice"

They did not, unless something wrote outside the ledger. Check:

```sql
SELECT * FROM property_deliveries WHERE "leadId" = '<lead>' ORDER BY "sentAt" DESC;
SELECT status, "skipReason", "sentAt" FROM broadcast_recipients WHERE "leadId" = '<lead>';
```

`broadcast_recipients` records the decision made for every customer in every
broadcast, including why they were skipped. That table answers almost every
"why did / didn't this send" question without guesswork.

## When an owner says "nothing happened when I sent photos"

In order:

1. `SELECT * FROM webhook_events ORDER BY "receivedAt" DESC LIMIT 5;` - did the
   webhook arrive at all? If not, the problem is in the Meta dashboard.
2. `SELECT * FROM messages WHERE "officeId" = '<id>' ORDER BY "createdAt" DESC;`
   - was it attributed to this office?
3. Is the sender's `wa_id` on a `users` row for that office? If not, the owner is
   being treated as a customer. This is the most common misconfiguration.
4. Check the subscription: an expired office is told so rather than silently
   ignored.

## Backups

Everything of value is in PostgreSQL plus the storage bucket. Supabase's
point-in-time recovery covers the database; enable bucket backups separately.
The WhatsApp media ids in `property_media` expire, so the bucket is the only
copy of a property's photos.

## Rotating the WhatsApp token

Update `WHATSAPP_ACCESS_TOKEN` and redeploy. In-flight broadcasts are unaffected:
recipients stay `PENDING` and are retried, since sends are attempted up to three
times before being marked `FAILED`.
