# supremRe™ — MRE Hype Drop

A Supreme-style timed drop that distributes physical MREs among 7 friends —
12 real flavors on the shelf, one meal per person, first-come-first-serve.
The drop ends when all 7 operatives have claimed (`PLAYER_COUNT`); the 5
leftovers stay browseable as surplus. Payment methods are joke gauntlets and
it all ends in a shareable manifest. A pre-drop **lookbook** (`#/lookbook`,
linked from the countdown) lets everyone scout the flavors before T-0.

It's a single-page app, but every screen claims a hash route (`#/product/3`,
`#/cart`, `#/checkout/3`, …) so the browser back button walks the
shop → product → cart → checkout stack the way people expect.

## Core principle

The three payment methods (**Ball Pay**, **Card**, **Playpal**) are pure frontend
theater. The backend has exactly **one** endpoint that mutates stock:

```sql
UPDATE mres
SET claimed_by = $user, claimed_at = now()
WHERE id = $mre_id AND claimed_by IS NULL
RETURNING *;
```

Nothing is held or reserved during payment. You can finish a whole payment flow
and still lose the item at `/claim` — lock-at-completion, by design. A partial
unique index (`one_each`) is the DB-level backstop that no operative ever holds
two meals.

## Layout

```
api/   Express + Postgres API  → deploy to Railway
web/   Static no-build SPA     → deploy to Cloudflare Pages
```

## Endpoints

| Method | Path        | Purpose |
| ------ | ----------- | ------- |
| GET    | `/config`   | `drop_time` + server clock (countdown sync) |
| GET    | `/mres`     | Full stock status — polled every ~1.5s |
| POST   | `/claim`    | **The only mutating endpoint.** `{ mre_id, user }` → 200 win, 409 `taken`/`already_have`, 403 `not_live` |
| GET    | `/manifest` | Claimed items + who, for the results screen |
| POST   | `/reset`    | Dev tool. `{ secret, drop_in_seconds? }` clears claims and optionally reschedules the drop |

## Run locally

```bash
# 1. Postgres (any way you like), then:
cd api
npm install
DATABASE_URL=postgres://postgres@localhost:5432/mealdrop npm start

# 2. Frontend — point web/config.js API_BASE at the API, then serve web/:
cd web
npx serve .          # or python3 -m http.server, or open index.html
```

By default the drop goes live 15 minutes after API boot. Reschedule anytime:

```bash
curl -X POST localhost:3000/reset -H 'Content-Type: application/json' \
  -d '{"secret":"hooah","drop_in_seconds":900}'
```

## Resetting between test runs (command post)

Open the site with `#reset` on the URL — e.g. `https://your-site.pages.dev/#reset`
(or `#admin`). The hidden **command post** panel lets you, without touching curl:

- **Reset claims — drop live now**: clears every claim, drop stays open.
- **Reset claims + countdown in N min**: clears claims and reschedules the
  drop. Everyone's open tab snaps back to the countdown within ~15 seconds
  (clients re-sync `drop_time` every ~10 polls) — a full re-run needs no refreshes.
- **Clear this browser's data**: wipes your saved name, card fields, and
  Ball Pay flag on this device only, so you can replay as a fresh operative.
- **Stock control**: a per-item list of all 12 MREs with their holders — clear a
  single claim (e.g. a test user's) or manually assign an item to a name, without
  touching the rest of the board or the schedule. One-per-person still applies to
  manual assigns (`POST /admin/item` under the hood, same secret).

The reset secret is remembered in your browser after first use. Server-side it
is still just `POST /reset` — the panel is a UI over the same endpoint.

## Race test (run this before trusting anything)

Hammers `/claim` with 20 users × 7 items simultaneously and asserts no
double-sell and no double-claim:

```bash
cd api
API_URL=http://localhost:3000 npm run race-test
```

## Deploy

**API → Railway**
1. New project → Deploy from repo, root directory `api/`.
2. Add the Postgres plugin (provides `DATABASE_URL`).
3. Set env vars: `PGSSL=true`, `RESET_SECRET=<something>`, optionally `DROP_TIME`.

**Frontend → Cloudflare Pages**
1. New Pages project from repo. Build command: none. Output directory: `web`.
2. Edit `web/config.js` → set `API_BASE` to your Railway URL.

## Config knobs (friction is tuned by iteration)

- `api/src/items.js` — the item list: names and fake NSNs (no tiers; people decide
  what they want). Bump `ITEMS_VERSION` when editing — the DB wipes and reseeds
  itself on the next boot.
- `PLAYER_COUNT` env (default 7) — how many claims end the drop
- `DROP_TIME` env or `POST /reset { drop_in_seconds }` — go-live time
- `web/config.js` — `PLAYPAL_WIN_RATE` (0.40), `PLAYPAL_WHEEL_RATE` (0.75), spin/wheel/verify durations, poll rate, fake queue size
- `CARD_FIELDS` in `web/app.js` — add/remove/reorder the card-form gauntlet freely

## The three doors

| Door | Axis | Deal |
| ---- | ---- | ---- |
| Ball Pay | courage | Three steps: "upload proof of payment" (the site is explicit about what the photo must show), a fake AI analysis screen, then "pay now." Any photo passes. Verification is remembered forever — later checkouts skip straight to pay now. |
| Card | patience | 10-field escalating form, format-checked speed bumps, reading-required traps. "Save card info" first, then pay with the card on file. Every field persists to localStorage as typed. |
| Playpal | luck | Two games, must win BOTH: slot spin (40%) then the Wheel of Rations (75%). Losses retry in place — the cost is time while rivals check out. Odds are never shown in the UI. Winners still have to press "claim winnings." |
