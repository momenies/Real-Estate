# Connecting WhatsApp

Every office gets its own WhatsApp number. Inbound webhooks are routed to the
right tenant by `phone_number_id`, so the number *is* the tenant key.

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

## 4. Message templates

Free-form replies are only allowed within 24 hours of the customer's last
message. To reach a customer who has been quiet longer, an approved template is
required. Submit one in the Meta dashboard (category **Marketing**, Arabic) and
send it with `WhatsappApiService.sendTemplate()`.

Within the 24-hour window - which covers replies and most broadcasts to recently
active customers - plain messages are used.

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
