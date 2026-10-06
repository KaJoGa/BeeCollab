# BeeCollab — Plan

Goal: redeploy BeeCollab (the original VPS is gone), let a few people try it, and use it as the **system under test** for the owner's software-testing portfolio. Claude prepares the app and the QA workspace (`test/`); a separate QA agent ("Claude QA") does the testing.

Last updated: 2026-10-07 (end of the autonomous run). Legend: `[x]` done · `[ ]` todo · `[~]` partly / owner action.

## Status at a glance
| Phase | State |
|---|---|
| 0. Context & docs | ✅ done |
| 1. Run locally, reproducibly | ✅ done |
| 2. Deploy (Vercel + Render + Neon + Cloudflare TURN) | ✅ done, live, CORS locked |
| 3. Make it testable | ✅ done (test ids, tools, E2E, opt-in cleanup) |
| 4. Triage weaknesses | ⏸ **deferred to QA by the owner's decision** — documented, reproduced, not fixed (`test/07-…`) |
| 5. Test spec for QA | ✅ done as the `test/` folder (docs 01–09 + tools + 64 E2E) |

Live: frontend https://beecollab.vercel.app · backend https://beecollab-rwbj.onrender.com (`/health`, `/api/docs`).
Verified end of run — local and live: `smoke-api` 45/45, `smoke-ws` 41/41, Playwright E2E 64/64. Details: [CHANGES.md](CHANGES.md). Things only the owner can do: [OWNER-TODO.md](OWNER-TODO.md).

## Decisions
- **DB stays PostgreSQL** (SQL is what matters for testability; no MySQL migration).
- **Hosting: zero-cost, no VM** — Vercel Hobby (frontend), Render free (NestJS + Socket.io), Neon free (Postgres), Cloudflare TURN. Owner is not eligible for Azure for Students; other always-on options were checked and rejected (table below).
- **Wake-on-open, not keep-alive.** A root-layout client component calls `GET /health` on every page load, retries every ~3 s, and shows a banner after 2 s. `/health` runs `SELECT 1` so Neon wakes too. No UptimeRobot/cron pinging (burns Render's 750 h/month and keeps Neon awake).
- **Architecture stays P2P full mesh**; server load is signaling only. Limits: client uplink (≈ 4–6 cameras) and NAT traversal (TURN).
- **Known weaknesses are intentionally not fixed.** They are test material for Claude QA. Only defects *introduced by the deployment/test work* are fixed (listed in CHANGES.md §6).
- **QA data hygiene:** every automated account uses `@qa.beecollab.test`; a guarded, disabled-by-default cleanup endpoint (`/test-support/*`) deletes only that data.
- **Push policy:** push to `main` only when a live test needs it (every push redeploys Render and drops live sockets).

## What exists now
* Backend: `/health` (db, commit, uptime), CORS from `FRONTEND_ORIGIN`, Neon-tolerant pg pool, `/webrtc/ice-servers` (Cloudflare TURN, STUN fallback), hidden `/test-support/*`. 29 backend tests of which the 6 legacy suites still fail (pre-existing).
* Frontend: `WakeServer`, 122 `data-testid` hooks, no behaviour changes beyond ICE servers and removing the edge runtime.
* Infra files: `docker-compose.yml`, `.env.example` ×2, Prisma migration, `.gitattributes`.
* `test/`: docs 01–09, `tools/` (wait-for-deploy, seed-accounts, cleanup, smoke-api, smoke-ws, cleanup.sql [untested]), `e2e/` (5 spec files, global setup/teardown), `CLAUDE.md` for the QA agent.

## Remaining / next (none block the demo)
- [ ] **Owner (optional):** enable the QA cleanup on Render; hand `test/` to Claude QA; manual screen-share and real-phone checks → [OWNER-TODO.md](OWNER-TODO.md)
- [ ] **Claude QA:** first sprint in `test/06-test-ideas.md` §8 (authz matrices, mobile viewport, reconnect, expiry, screen share, TURN-forced)
- [ ] **After QA reports:** owner picks which `R-xx` findings to fix (Phase 4) and which stay as documented known issues
- [ ] Verify a > 15 min call on Render free stays up (WebSocket traffic should keep it awake; not measured)
- [ ] Decide what to do with the 6 failing legacy Jest suites (repair or replace) — reported as R-41
- [ ] `test/tools/cleanup.sql` was never executed; run it on a local DB before trusting it
- [ ] Optional: CI (GitHub Actions) running build + typecheck + backend Jest + smoke against a service container

## Hosting research (checked 2026-10-07; third-party sources, re-verify before relying)
| Piece | Option | Notes |
|---|---|---|
| Backend | ~~Azure VM (Student Pack)~~ | Rejected: owner not eligible. DigitalOcean's $200 student credit ended 2026-07-31. |
| Backend | **Render free (chosen)** | No card, 750 h/mo. Sleeps after 15 min with no HTTP request **and no WebSocket message** (Render changelog 2026-02-24), so an active call keeps it awake; the first request after idle takes ~1 min. WebSockets work (verified live). |
| Backend | Oracle Always Free / GCP e2-micro / Koyeb / Railway / Fly.io | Rejected: card required, scarce ARM capacity, US-only 1 GB RAM, trial-only, or no free tier. |
| Frontend | **Vercel Hobby (chosen)** | Non-commercial use only (fine here). |
| Frontend | ~~Cloudflare Pages~~ | Rejected: `next-on-pages` deprecated/broken on Next 16; OpenNext needs the Node runtime. |
| Database | **Neon free (chosen)** | 100 CU-h/project/month (≈ 400 h at 0.25 CU), 1 GB, autosuspend after 5 min → 24/7 impossible, wake-on-open only. Alt: Supabase free (pauses after 7 days idle). |
| TURN | **Cloudflare Realtime TURN (chosen)** | 1 000 GB/month free, then $0.05/GB. Credentials ≤ 48 h, minted server-side. |
| HTTPS/WSS | Provided by Render/Vercel | No custom domain needed. |

## Open questions
1. Which `R-xx` findings to fix vs. keep as documented known issues (after QA reports).
2. Should `TEST_SUPPORT_ENABLED` stay on in Render permanently, or only during QA runs? (Recommendation: only during QA runs.)
