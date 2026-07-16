# supremRe™ — MRE Hype Drop

A Supreme-style timed drop that distributes 7 physical MREs among 7 friends.
First-come-first-serve, one meal per person, payment methods are joke gauntlets,
ends in a shareable manifest.

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
| GET    | `/manifest` | Claimed items + who + tier, for the results screen |
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

- `api/src/items.js` — the item list: names, tiers (2×S / 2×A / 2×B / 1×cursed), fake NSNs
- `DROP_TIME` env or `POST /reset { drop_in_seconds }` — go-live time
- `web/config.js` — `PLAYPAL_WIN_RATE` (0.70), `PLAYPAL_SPIN_MS` (1500), poll rate, fake queue size
- `CARD_FIELDS` in `web/app.js` — add/remove/reorder the card-form gauntlet freely

## The three doors

| Door | Axis | Deal |
| ---- | ---- | ---- |
| Ball Pay | courage | Upload "payment verification photo." Any photo passes. Remembered forever — later checkouts are one tap. |
| Card | patience | 10-field escalating form, format-checked speed bumps, reading-required traps. Every field persists to localStorage as typed. |
| Playpal | luck | One spin, ~70% win. Fastest path in the game when it hits; a loss burns your lead and bounces you to payment select. |
