# The network dashboard

`/dashboard` — the platform owner's single screen. It is the "لوحة تحكم واحدة"
from the brief: the one place where every office's inventory and customers are
visible together.

**It is not for the office owner.** Their interface is the WhatsApp thread, and
that is the whole product thesis. An office user who signs in here is turned
away — the page checks the role, and the API refuses cross-office data to any
token that is not the super admin's. There is a test for exactly that.

## Running it

It ships inside the API process — no separate build, no second service, no CDN.
After `npm run start:dev`, open `http://localhost:3000/dashboard/` and sign in
with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`.

The token lives in `sessionStorage` and is sent as a bearer header; nothing else
is stored. The page itself is public HTML — everything it *shows* goes through
the authenticated API.

## The four views

| View | What it answers |
|---|---|
| نظرة عامة | How big is the network, and what expires soon |
| المكاتب | Every office: status, plan, days left, inventory and customer counts; converting a trial to a paid plan |
| العقارات | Search inventory **across all offices** — the query no single office can run |
| التحليلات | Supply by property type and city, demand by customer intent |

## Design notes worth keeping

**The charts use one hue on purpose.** Every chart here is a single series of
magnitudes, so the *length* of the bar carries the value and the colour carries
nothing. That removes the entire colour-blindness question rather than
mitigating it: there is no second series to confuse the first with. The bar
colour (`#2a78d6` light, `#3987e5` dark) was checked with the palette validator
against both surfaces rather than eyeballed.

**Values sit at the bar tip**, in text ink, never in the data colour — so the
chart is fully readable in greyscale, or with the colours off entirely.

**Status is never colour alone.** Subscription states pair a coloured glyph with
a written label, because `warning` and `serious` sit below 3:1 on the light
surface by design.

**Dark mode is chosen, not flipped.** The dark values are their own steps for
the dark surface, declared under both `prefers-color-scheme` and the
`data-theme` toggle so a manual choice wins either way.

## Extending it

Add a view by adding a `<section class="view" id="view-x">`, a tab button with
`data-view="x"`, and a loader in the `LOADERS` map in `app.js`. The `renderBars`
helper takes `[{ name, value, sub?, tooltip? }]` and handles scale, labels and
hover.

Keep it dependency-free. The value of this page is that it deploys with the API
and cannot drift from it.
