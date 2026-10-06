# BeeCollab — Plan

Goal: redeploy BeeCollab (original VPS is gone), let a few people try it, and use it as the system under test for the owner's testing portfolio. Claude prepares the app and writes the test spec; a separate "Claude Test" agent runs the tests.

Last updated: 2026-10-07. Status legend: `[ ]` todo, `[x]` done, `[?]` needs owner decision.

## Summary (read this first)
Free, zero-card stack: **Vercel Hobby** (frontend) → **Render free** (NestJS + Socket.io signaling) → **Neon free** (Postgres), plus **Cloudflare TURN** for calls that can't connect P2P. Media is P2P so the server only does signaling; free tiers are enough. Cost of free: Render and Neon sleep when idle, so **opening any page of the frontend wakes the backend** (no keep-alive pinging, no UptimeRobot — it would burn the 750 h/mo Render allowance and keep Neon awake). Owner does account setup ([SETUP.md](SETUP.md)); Claude does code/config; then triage weaknesses, make it testable, write `TEST-SPEC.md`.

Execution order: **Phase 1 (local) → Phase 2 (deploy, needs owner accounts) → Phase 3 (testable) → Phase 4 (triage with owner) → Phase 5 (spec)**. Phases 1 and the code part of 2 need nothing from the owner.

## Decisions
- **Wake-on-open, not keep-alive.** A client component in the root layout calls `GET /health` on every page load (home, login, direct `/meeting/<id>` links), retrying every ~3 s until it answers, and shows a "Waking up the server (~1 min)…" banner meanwhile. `/health` also runs `SELECT 1` so Neon wakes too. (Home page already calls `GET /` once on load, but nothing wakes the server for direct meeting/login links, and a single call doesn't retry through Render's wake-up window.) The call during a cold start may fail with a CORS/503 error from Render's wake-up page — that is why it retries.
- **DB stays PostgreSQL** (SQL is what matters for testability; no MySQL migration).
- **Hosting = Option B (zero-cost, no VM)**: owner is not eligible for Azure for Students (2026-10-07). Backend on Render free, DB on Neon free, frontend on Vercel Hobby, TURN from Cloudflare. Always-on alternatives were checked and rejected (see table).
- **Architecture stays P2P full mesh.** Server load is signaling only, so free-tier hosting is viable; the real limits are client uplink (practical ~4–6 cameras) and NAT traversal (needs TURN).
- Known weaknesses (below) are **not fixed up front**; triaged in Phase 4.

## Phases

### 0. Cleanup & context
- [x] Delete outdated `bee-collab-backend/CLAUDE.md` and `bee-collab-backend/README.md`; remove empty `.dist/`
- [x] Root `CLAUDE.md` (stable context)
- [x] This `PLAN.md`
- [ ] Rewrite root `README.md` (still lists dead VPS URLs / IP) — do after deploy when real URLs exist

### 1. Run locally, reproducibly
- [x] `docker-compose.yml` with Postgres (also reused later for CI / test runs). Docker 27 and Node 24 are installed locally; no local `psql`.
- [x] `.env.example` for backend and frontend (frontend `.gitignore` now allows it)
- [x] Initial migration `20261006210035_init` created and applied locally; use `prisma migrate deploy` for Neon (not `db push`). `prisma.config.ts` comment about port 6543 is stale → tidy in Phase 2
- [x] Deps installed, `prisma generate`, both apps build (`nest build`, `next build`). Verified with real requests: register/login/create meeting, WS join for a user + a guest, chat from both, hand queue, WebRTC offer relay.
- [ ] Still to verify by hand: a real 2-tab call with camera/mic (needs a human browser session)
- [x] Add `GET /health` endpoint → `{ status: 'ok', db: 'up'|'down' }` (does `SELECT 1`; used by wake-on-open, Render health check, and tests). Keep `GET /` as is.
- [x] Remove `export const runtime = 'edge'` from `meeting/[id]/page.tsx` (page is `'use client'`, edge buys nothing, and it's a compatibility risk on Next 16)
- [x] Root-layout `WakeServer` (retry loop + banner; banner only, buttons are not disabled). Verified in Chrome: banner shows with backend down and disappears by itself once it comes up. `/health` verified with DB stopped (`db: "down"` in 0.3 s) and recovers after DB restart (pool survived).

### 2. Deploy
Hosting research (checked 2026-10-07; third-party sources, re-verify before signing up):

| Piece | Option | Notes |
|---|---|---|
| Backend | ~~Azure VM via GitHub Student Pack~~ | **Rejected: owner not eligible.** DigitalOcean's $200 student credit also **ended July 31, 2026**. |
| Backend | **Render free (chosen)** | No card, 750 h/mo (enough for one always-on service). Sleeps after 15 min with no HTTP request **and no WebSocket message** (Render changelog, 2026-02-24), so an active call keeps it awake; first connection after idle pays a cold start (tens of seconds). Wake it via wake-on-open (see Decisions); keep-alive pinging rejected (burns most of the 750 h, ToS not explicitly addressed). If a test run needs it awake, call `/health` first. Free-tier WebSocket "throttling" claim from one blog is unverified → test in Phase 2. Skip Render's own free Postgres (historically time-limited; not re-checked). |
| Backend | Oracle Cloud Always Free | Rejected: card required, ARM capacity hard to get, allowance cut to ~2 OCPU/12 GB in June 2026. |
| Backend | GCP e2-micro | Rejected: US regions only, 1 GB RAM, card required. |
| Backend | Koyeb free | Native WebSockets, scale-to-zero after 1 h, but card required (~$29 hold) since Feb 2026. |
| Backend | Railway / Fly.io | Trial credit only / no free tier for new users. Not suitable. |
| Frontend | **Vercel Hobby (chosen)** | First-party Next.js host, no config. Hobby is non-commercial only (fine for a college/portfolio project). Limits ~100 GB bandwidth/mo, 10 s function timeout — irrelevant for a mostly-static client app. |
| Frontend | ~~Cloudflare Pages~~ | Rejected: `@cloudflare/next-on-pages` is deprecated and reportedly broken on Next 16; the current path (`@opennextjs/cloudflare`) wants the Node runtime. More moving parts for no gain. |
| Database | **Neon free (chosen)**: 100 compute-h/mo, scale-to-zero. Alt: Supabase free (pauses after 7 days idle, 500 MB) | Scale-to-zero means first query after idle is slow (docs: free = 100 CU-h/project/mo ≈ 400 h at 0.25 CU, 1 GB storage, autosuspend after 5 min; so 24/7 is impossible — wake-on-open only) and idle connections get dropped → verify the `pg` Pool survives that (possible unhandled pool `error` crash); use Neon's pooled connection string. |
| TURN | Cloudflare Realtime TURN | 1,000 GB/mo free allowance (shared with SFU); $0.05/GB beyond. Alternative: self-host coturn on the VM. |
| HTTPS/WSS | Provided by Render / Vercel (`*.onrender.com`, `*.vercel.app`) | No custom domain needed. Camera/mic need HTTPS and the HTTPS frontend needs WSS; both are satisfied by default. |

- [x] Hosting decision: Option B (see Decisions)
- [x] **Owner:** Neon, Cloudflare TURN and Render done (2026-10-07). Vercel deployed: https://beecollab.vercel.app (verified: pages 200, bundle points at the Render URL, wake-on-open `/health` call fires, home shows "System Online", no console errors). Remaining: set `FRONTEND_ORIGIN` on Render (CORS is still `*`).
- [x] TURN (code done 2026-10-07; needs real Cloudflare creds on Render to be exercised): backend endpoint (e.g. `GET /webrtc/ice-servers`, JWT incl. guests) calls `POST https://rtc.live.cloudflare.com/v1/turn/keys/$CF_TURN_KEY_ID/credentials/generate-ice-servers` with `Authorization: Bearer $CF_TURN_API_TOKEN`, body `{"ttl": 86400}` (max 48 h), returns `iceServers` (201). Implemented as `webrtc/` module (6 unit tests, Cloudflare mocked); frontend fetches it right after the socket connects, before any peer connection, and falls back to STUN. Verified in Chrome as a guest (`/webrtc/ice-servers` → 200). Keys stay server-side.
- [x] Prisma/pg Pool: 15 s connect timeout, max 10, idle error handler (Neon drops idle connections). Owner verified `/health` → `db: up` against Neon (2026-10-07). Don't pass `channel_binding=require`.
- [ ] Align `docker-compose.yml` Postgres major version with whatever Neon created
- [x] CORS (REST + Socket.io) now reads `FRONTEND_ORIGIN` (comma-separated); unset = `*`. Verified allowed vs blocked origin. **Set it on Render once the Vercel URL exists.**
- [x] Backend LIVE on Render: https://beecollab-rwbj.onrender.com (owner deployed 2026-10-07). Verified from outside: `/health` db up (0.23 s warm), tables exist (read-only lookup → 404 not 500), `/api/docs` 200, **TURN creds returned by Cloudflare**, `wss://` Socket.io works (2 guests: join, state, chat, WebRTC offer relay; connect ~130 ms). No `render.yaml` (settings are in the dashboard).
- [ ] Verify Neon cold-start behaviour with Prisma + `pg` Pool; verify Socket.io stays stable on Render free (long call, >15 min)
- [ ] Deploy, smoke-test a 3-person call across different networks (incl. mobile data) to validate TURN
- [ ] Rewrite README with real URLs

### 3. Make it testable
- [ ] Stable staging URL + seeded test accounts (script) and a way to reset DB state between runs
- [ ] `data-testid` on key meeting-room controls (mic, cam, chat, raise hand, leave, participant list, etc.)
- [ ] Fake-media notes for automated browsers (Chromium `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`)
- [ ] Decide what's testable at which level: API (REST), WebSocket events, UI/E2E, WebRTC connectivity, performance/load (signaling), security
- 6 of 8 backend spec suites FAIL on the original commit too (Nest scaffold specs missing providers: AuthService, UsersService, MeetingsService + controllers). Pre-existing, not a regression.
- [ ] Replace empty Nest spec scaffolds with real unit tests where cheap, or delete them

### 4. Triage known weaknesses (discuss with owner)
Candidates found while reading the code. Each is either **fix** or **leave as a documented test finding**. Verify each before treating it as a bug.
- `poll:vote` with a non-existent poll/option id → unhandled Prisma FK error surfaced as WS `exception` (server survives). Observed 2026-10-07
- Home page "System Offline" indicator checks once on load and never refreshes (stays stale after the server wakes)
- Guest vs. DB: `poll:vote` / reactions with a guest `sub` (FK to `User`) likely fail
- `meeting:join` doesn't check room code or membership, only capacity (REST `join` does check the code)
- `webrtc:*` relay, `media:speaking`, `poll:vote`, `reaction:send` don't verify sender is in the room or has a role
- Chat `isMe` compares `senderId` to the token (marked "simplification for demo") → wrong alignment of own messages
- Meeting end hard-deletes everything; `ENDED` status unused
- No rate limiting; CORS `*`; no TURN until Phase 2
- Single-node assumptions (no Redis adapter)
- Mesh quality degrades past ~5 cameras (design limit, document rather than fix)

### 5. Test spec for Claude Test
- [ ] `TEST-SPEC.md`: scope, environments/URLs, accounts, how to reset state, feature inventory, test levels, expected behaviours, known issues list from Phase 4, reporting format
- [ ] Owner hands it to the Claude Test agent

## Open questions
1. Which weaknesses to fix vs. keep as findings (Phase 4)
