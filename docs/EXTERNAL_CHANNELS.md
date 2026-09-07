# TikTok and Haraj

Two external channels, deliberately handled in opposite ways - because one has
an official API and the other does not.

## TikTok — full automation, officially

The office signs in **once** with OAuth. After that the platform holds a
refreshable token and publishes property videos through the official Content
Posting API.

```
GET  /api/integrations/tiktok/authorize   -> consent URL (signed state)
GET  /api/integrations/tiktok/callback    -> stores tokens for the office
POST /api/integrations/tiktok/publish     -> publishes a property's video
```

Details worth knowing:

- **`state` is HMAC-signed** with the app secret and expires after 15 minutes.
  It carries the office id, so the callback can be trusted about which tenant
  started the flow. This is the CSRF defence for OAuth; without it, an attacker
  could attach their own TikTok account to someone else's office.
- **`PULL_FROM_URL`** - TikTok fetches the video straight from the Supabase
  bucket rather than the platform re-uploading the bytes. This is why media is
  mirrored to public storage on arrival.
- **Tokens refresh automatically** when within five minutes of expiry.
- Captions are generated from the property: type, deal, district, price, area,
  plus hashtags.

## Haraj — prepared, not automated

Haraj has no partner API, and automating a logged-in session is precisely what
gets accounts banned there. So the platform stops one step short **on purpose**.

```
POST /api/integrations/haraj/prepare  -> builds the listing, returns a share link
GET  /share/haraj/:token              -> the copy-paste page (public, no login)
POST /api/integrations/haraj/posted   -> record where it was published
```

The share link opens a self-contained page - no framework, no build step, no
login - designed for an owner opening a WhatsApp link on an old phone:

- the **title** with a one-tap copy button
- the **listing body**, fully written from the property's fields
- the **photos** in order, tap-and-hold to save
- a **map link** if a location pin was dropped

A human still presses publish on Haraj. That is both the safe path and the
compliant one, and it costs the owner about fifteen seconds.

Tokens are 128-bit and expire after 14 days. The page sends `noindex`, but the
token *is* the credential - treat the link as shareable-secret.

## Adding another channel

`external_accounts` and `external_publications` are keyed by an
`ExternalPlatform` enum that already includes Snapchat, Instagram and X. A
platform with an API follows the TikTok shape; one without follows the Haraj
shape. The decision is not technical - it is whether automation risks the
office's account.
