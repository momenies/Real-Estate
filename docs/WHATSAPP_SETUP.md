# Connecting WhatsApp

Every office gets its own WhatsApp number. Inbound webhooks are routed to the
right tenant by `phone_number_id`, so the number _is_ the tenant key.

## 1. Meta app

1. At [developers.facebook.com](https://developers.facebook.com) create a
   **Business** app and add the **WhatsApp** product.
2. Note the **App Secret** (Settings → Basic) → `WHATSAPP_APP_SECRET`.
3. Create a **System User** with a permanent token carrying
   `whatsapp_business_messaging` and `whatsapp_business_management`
   → `WHATSAPP_ACCESS_TOKEN`.

A permanent System User token matters: the 24-hour test token will expire in the
middle of a working day and every office will go silent at once.

## 2. Webhook

- **Callback URL:** `https://<your-app>/webhooks/whatsapp`
- **Verify token:** any string; the same value goes in `WHATSAPP_VERIFY_TOKEN`
- **Subscribe to:** `messages`

The `GET` handler answers Meta's handshake. The `POST` handler verifies
`X-Hub-Signature-256` against the raw request bytes - which is why the app is
created with `rawBody: true`, since re-serialising the parsed JSON would produce
a different signature.

Without `WHATSAPP_APP_SECRET` the app logs a warning and accepts unsigned
webhooks. That is fine locally and unacceptable in production: anyone who
learned the URL could inject messages into any office.

## 3. Register a number for an office

Add the number in the Meta dashboard, copy its **Phone number ID**, then:

```bash
curl -X POST https://<your-app>/api/offices \
  -H "Authorization: Bearer <super-admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "مكتب الرياض للعقارات",
    "ownerName": "أبو محمد",
    "ownerPhone": "0501234567",
    "city": "الرياض",
    "whatsappPhoneNumberId": "123456789012345",
    "whatsappDisplayNumber": "+966501234567"
  }'
```

This creates the office, its settings, the owner's WhatsApp identity and the
90-day free trial in one transaction.

`ownerPhone` is normalised to a `wa_id` (`0501234567` → `966501234567`), and
that is how the platform knows a message came from the **owner** rather than a
customer. Get it wrong and the owner will be treated as a lead and offered the
customer questionnaire.

## 4. The broadcast template

This is not an optional nicety. Free-form messages - text, images, the property
card - are only accepted within **24 hours of the customer's last message**.
Past that Meta rejects the send with error **131047**.

The headline feature is _"أرسلها لعملاء آخر شهر"_, and by construction most of
that audience last wrote days or weeks ago. **Without an approved template, the
broadcast reaches almost nobody.**

### Submit this template

`WhatsApp → Message Templates → Create template`

| Field        | Value            |
| ------------ | ---------------- |
| **Name**     | `aqar_new_offer` |
| **Category** | Marketing        |
| **Language** | Arabic           |

**Body** - three variables, each of which must stay on one line:

```
عرض جديد من {{1}} 🏡

{{2}}
السعر: {{3}}

تحب نرسل لك الصور والتفاصيل والموقع؟
```

**Buttons** - Quick reply, in this order:

| #   | Text            |
| --- | --------------- |
| 0   | `أرسل التفاصيل` |
| 1   | `إيقاف العروض`  |

Sample values for the review form (Meta rejects a submission with empty
samples): `مكتب الرياض للعقارات` · `فيلا للبيع · النرجس · 400 م² · 5 غرف` ·
`1,800,000 ريال`.

Then set the name in `WHATSAPP_BROADCAST_TEMPLATE`, or per office in its
settings from the dashboard.

### How the platform uses it

`BroadcastDispatcherService` decides per recipient, after anti-spam has decided
_whether_ to send at all:

| Customer's last message    | Channel                                          |
| -------------------------- | ------------------------------------------------ |
| under ~23.5 hours ago      | free-form: photo + full property card            |
| older, template configured | `aqar_new_offer` with the three values filled in |
| older, no template         | **skipped** as `OUTSIDE_24H_WINDOW`              |

That last row is deliberate. Sending anyway would burn delivery attempts on a
rejection the office owner never sees, and leave him believing the offer went
out.

**Button 0 carries the property's ref code** as its payload
(`lead:property:FLB-002`), stamped on at send time. So the tap does two things
at once: it is an inbound message, which reopens the 24-hour window, and it
tells the bot which offer to send in full - photo, card and location. That
round trip is why the teaser only needs three fields.

Note the ~23.5 hours rather than 24: a recipient can wait minutes in the queue
between the check and the send, and a send that lands a second past the
boundary is rejected outright. The margin sends those leads by template
instead, which always works.

### Deduplication still applies

The teaser and the details are the same property, and `property_deliveries`
recorded it when the teaser went out - so no other broadcast will offer it
again. The customer's own request for details is exempt: refusing them the
thing they just asked for would be the rule working against its purpose.

## 5. Verifying the wiring

```bash
curl "https://<your-app>/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=OK"
# -> OK
```

Then message the office number from another phone. A `leads` row should appear,
and the customer should receive the qualification buttons.

## Known limits

- 3 quick-reply buttons per message, titles ≤ 20 characters
- 10 rows per list, titles ≤ 24 characters
- Media ids expire, which is why media is mirrored to storage on arrival

`WhatsappApiService` clips text to these limits rather than letting Meta reject
the whole message.
