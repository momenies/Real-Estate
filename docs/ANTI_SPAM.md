# Anti-spam and deduplication

Two things are being protected at once, and they are the same thing: the
customer should not be annoyed, and **a number that annoys people gets reported
and then banned by Meta.** For a real-estate office, losing the WhatsApp number
means losing the business.

## The rules, in order

`AntiSpamService.check()` evaluates these for every (customer, property) pair.
The order is deliberate and load-bearing.

| # | Rule | Skip reason | Why |
|---|---|---|---|
| 1 | Customer opted out | `OPTED_OUT` | Absolute. Nothing overrides it. |
| 2 | Already received **this property** | `ALREADY_RECEIVED_PROPERTY` | The most visible form of spam, and the easiest to prevent. |
| 3 | Daily cap reached | `DAILY_CAP_REACHED` | Default: one promotional message per customer per day. |
| 4 | Cooldown active | `COOLDOWN_ACTIVE` | Default: 20 hours between messages to the same customer. |
| 5 | Quiet hours | `QUIET_HOURS` | Default: 22:00–08:00 in the office's timezone. |

**Why quiet hours is last.** Rules 1–4 answer *"should this customer ever get
this message?"*. Quiet hours only answers *"is now a good time?"*. If quiet
hours were checked first, a duplicate would be reported as a mere deferral, and
the caller would queue a message it should have dropped. That was a real bug;
`anti-spam.service.spec.ts` has a regression test named
*"reports a duplicate as a duplicate even during quiet hours"*.

Consequently `BroadcastsService.plan()` treats `QUIET_HOURS` as **deferrable** -
those recipients stay `PENDING` and go out when the window opens - while every
other reason produces a `SKIPPED` row.

## How deduplication is guaranteed

`property_deliveries` has a unique constraint on `(propertyId, leadId)`. It is
the single ledger for *every* path that can reach a customer:

- a broadcast the owner triggered
- the automatic "آخر الموجود" sent to a newly qualified customer

Because both write to it, a customer who received a villa from the auto-send
will not receive it again from a broadcast an hour later. The end-to-end run
confirms this: of two customers in the window, the one who had already seen the
property was skipped with `ALREADY_RECEIVED_PROPERTY`.

The delivery record, the daily counter and the customer's `lastBroadcastAt` are
written in **one transaction**, so a crash can never leave the dedup record
missing while the customer has already received the message.

## The daily cap

`lead_daily_quotas` is keyed by `(leadId, day)` where `day` is the calendar day
**in the office's own timezone**, not the server's. An office in Riyadh should
not have its daily cap reset at 3 a.m. local time.

## Checked twice

Rules are evaluated when the broadcast is planned *and* again immediately before
each individual send. The gap between the two can be minutes, and another
broadcast may have reached that customer in between.

## Pacing

Sending is paced at `broadcastRatePerMinute` (default 20) per office, in batches,
with a delay between individual messages. Bursts are exactly what gets a number
flagged. There is no setting that removes the pause.

## Opt-out

Any customer can send `إيقاف` (or `stop`) to stop everything, and `اشتراك` to
resume. Every broadcast body carries the opt-out line. This is both good manners
and the cheapest insurance against being reported.

## What an office can tune

Via `PATCH /api/offices/me/settings`, within bounded ranges:

| Setting | Default | Range |
|---|---|---|
| `dailyCapPerLead` | 1 | 1–10 |
| `minHoursBetweenMessages` | 20 | 0–72 |
| `quietHoursStart` / `quietHoursEnd` | 22 / 8 | 0–23 / 0–24 |
| `broadcastRatePerMinute` | 20 | 1–60 |

Deduplication is **not** tunable. There is no configuration that lets an office
send the same property to the same customer twice.
