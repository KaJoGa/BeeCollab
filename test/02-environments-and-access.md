# 02 — Environments and access

## Live deployment (shared; free tier)
| What | URL |
|---|---|
| Frontend | https://beecollab.vercel.app |
| Backend API | https://beecollab-rwbj.onrender.com |
| Swagger UI | https://beecollab-rwbj.onrender.com/api/docs (JSON: `/api/docs-json`) |
| Health + build id | https://beecollab-rwbj.onrender.com/health → `{ status, db, commit, uptimeSeconds, testSupport }` |

* `commit` is the deployed git SHA (first 7 chars; `dev` when running locally). Use it to confirm the build you are testing: `npm run wait -- --commit <sha>`.
* `uptimeSeconds` small ⇒ the server just (re)started — useful to detect a cold start or a redeploy that killed your sockets.
* **Every push to `main` redeploys both apps** (Render ≈ 1–3 min, Vercel ≈ 1–2 min) and drops live WebSocket connections. If a long test fails oddly, check whether `commit`/`uptimeSeconds` changed.
* Cold start: after ~15 min idle the first request can take ≈ 1 minute. `tools/wait-for-deploy.mjs` and the Playwright `global-setup` handle it; for manual testing open `/health` first.

## Local environment
Prerequisites: Node 20+ (developed on 24), Docker (for Postgres), npm.

```bash
# from the repository root
docker compose up -d                       # Postgres 16 on localhost:5432 (user/pass/db: beecollab)

cd bee-collab-backend
cp .env.example .env                       # defaults already point at the docker database
npm install
npx prisma generate
npx prisma migrate deploy                  # applies prisma/migrations (use `migrate dev` while developing)
npm run build && npm run start:prod        # http://localhost:3000   (or: npm run start:dev)

cd ../bee-collab-frontend
cp .env.example .env.local                 # NEXT_PUBLIC_API_URL=http://localhost:3000
npm install
npm run build && npx next start -p 3001    # http://localhost:3001   (or: npm run dev)
```
Windows: `run.bat` at the repo root installs and starts both in dev mode.

Reset the local database completely: `docker compose down -v && docker compose up -d` then `npx prisma migrate deploy`.
`NEXT_PUBLIC_*` values are baked in **at build time**; rebuild the frontend after changing them.

### Backend environment variables
| Variable | Purpose | Local default |
|---|---|---|
| `DATABASE_URL` | Postgres (runtime; on Neon use the *pooled* host) | docker URL in `.env.example` |
| `DIRECT_URL` | Postgres for Prisma migrations (Neon: *direct* host) | same as above |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | token signing / lifetime | dev values; `1d` |
| `PORT` | listen port | `3000` |
| `FRONTEND_ORIGIN` | comma-separated allowed browser origins for REST + Socket.io CORS; empty ⇒ `*` | unset |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | Cloudflare TURN; unset ⇒ STUN only | unset |
| `TEST_SUPPORT_ENABLED`, `TEST_ADMIN_TOKEN` | enable the QA cleanup endpoints (below) | unset (disabled) |

## Test accounts
Create them yourself — registration is open. **Always use the suffix `@qa.beecollab.test`.**

* `npm run seed` creates/verifies `alice@`, `bob@`, `carol@qa.beecollab.test` (password `QaPassw0rd!`, override with `QA_PASSWORD`). Idempotent.
* The test helpers create throw-away users with `uniqueEmail('label')` → `label-<timestamp>-<rand>@qa.beecollab.test`.
* Guests need no account: `POST /auth/guest {"name":"…"}` or the UI.

Password rules: ≥ 6 characters. Display name ≥ 2. Email must be a valid address (`.test` TLD is accepted).

## Cleaning up test data
Tests leave users and meetings behind (meetings vanish by themselves when empty; **users persist**). Two options:

1. **Local:** reset the docker volume (above).
2. **Any environment, if the backend owner enabled it:** the guarded endpoints
   * `GET  /test-support/status` and `POST /test-support/cleanup`, header `x-test-token: <TEST_ADMIN_TOKEN>`
   * They return **404** unless `TEST_SUPPORT_ENABLED=true` **and** `TEST_ADMIN_TOKEN` (≥ 16 chars) are set on the backend, and **401** for a missing/wrong token. Surrounding whitespace, quotes and upper case (`TRUE`) in the env values are tolerated.
   * To tell "disabled" from "wrong token" **without** the token: `GET /health` → `testSupport: "enabled" | "disabled"`; without a token an *enabled* instance answers **401**, a disabled one **404**. The reason for "disabled" is logged once at startup (`QA endpoints disabled: …`, never containing the token).
   * Cleanup deletes only data belonging to users whose email ends with `@qa.beecollab.test` (their meetings, participations, chat messages, poll votes, and the users) in foreign-key order inside one transaction. Everything else is untouched.
   * Run it while no test is executing (a row inserted mid-way can make the user delete fail).
   * CLI: `TEST_ADMIN_TOKEN=… API_URL=… npm run cleanup` (exit codes: 0 ok · 1 failed · 2 no token · 3 disabled (404) · 4 wrong token (401)).
   * Automatic after an E2E run: `QA_CLEANUP=1 TEST_ADMIN_TOKEN=… npm run e2e` — the Playwright `global-teardown` calls cleanup once at the end. Without `QA_CLEANUP=1` (or without a token) it does nothing; if the backend has the feature disabled it just logs `404`.

   On the live deployment this is **disabled by default**; ask the owner to enable it (see `OWNER-TODO.md` in the repo root) if you want automated cleanup there.

## Running the suites
```bash
# local
npm run smoke && npm run e2e
# live (PowerShell: $env:API_URL=...)
API_URL=https://beecollab-rwbj.onrender.com WEB_URL=https://beecollab.vercel.app npm run e2e
npm run e2e -- e2e/03-meeting-room.spec.ts          # one file
npm run e2e -- -g "kick"                            # by title
npm run e2e:headed                                  # watch the browsers
npm run e2e:report                                  # open the HTML report of the last run
```
Playwright config highlights: Chromium only; fake camera + microphone (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`); `workers: 1` (meetings are stateful); traces/screenshots kept on failure in `test-results/`.

## What works headless, what does not
| Works | Does not (yet) |
|---|---|
| Real WebRTC between two browser contexts using fake devices (video frames really arrive) | `getDisplayMedia` (screen share) — needs a flag or a different approach |
| Multiple isolated users via separate contexts | Real network impairment (use CDP throttling or `tc` if you want it) |
| `window.confirm` handling (`page.on('dialog')`) | Firefox/WebKit: not configured |
| Cold-start simulation with `page.route` | Mobile layout: add a mobile viewport project (the mobile-only controls exist, ids prefixed `mobile-`/`ctrl-mobile-`) |

## Etiquette on the shared live deployment
* No load tests against live (free tier, shared with demos). Use local for volume.
* Keep runs sequential; do not push to `main` while someone is mid-test.
* Do not paste tokens from the browser into reports; they expire in 1 day but still grant access.
