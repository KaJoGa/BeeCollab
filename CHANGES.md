# Change log — deployment and test-readiness work (2026-10-06 → 2026-10-07)

Everything the project gained since the original VPS deployment was lost. Grouped by purpose; commit SHAs are on `main`.

## 1. Context and documentation
| Commit | Change |
|---|---|
| `d2222cc` | Added root `CLAUDE.md`, `PLAN.md`, `SETUP.md`; removed the outdated backend `CLAUDE.md`/`README.md` (they still described Supabase and dead VPS URLs) |
| `0aa9b39`, `73b7c3a` | Recorded the live Render/Vercel URLs and verification results |
| (this batch) | Root `README.md` rewritten; `test/` workspace docs 01–09; `OWNER-TODO.md`; this file |

## 2. Make it run reproducibly (local)
| Commit | Change |
|---|---|
| `1fb6f43` | `docker-compose.yml` (Postgres 16), `.env.example` for both apps, **initial Prisma migration** (`20261006210035_init`, 9 tables); frontend `.gitignore` now allows `.env.example` |
| `b8e8dfc` | `.gitattributes`: `*.sql` pinned to LF so Prisma's migration checksum is identical on Windows and Linux |

## 3. Make it deployable on free-tier hosting
| Commit | Change | Why |
|---|---|---|
| `b1129bd` | `GET /health` (`SELECT 1`, 8 s timeout, logs the failure reason) + `WakeServer` in the root layout (pings `/health` on every page load, retries every 3 s, banner after 2 s) | Render and Neon sleep when idle; the frontend wakes them instead of keep-alive pinging (which would burn the 750 h/month allowance) |
| `cde3510` | CORS for REST **and** Socket.io from `FRONTEND_ORIGIN` (comma-separated; unset = `*`); `main.ts` loads `dotenv` first | Lock the live API to the Vercel origin |
| `c736a08` | pg pool: 15 s connect timeout, max 10, idle-error handler; removed stale "Supabase" wording | Neon drops idle connections and cold-starts; an unhandled pool error could crash the process |
| `5df3e9b` | Removed `export const runtime = 'edge'` from the meeting page | Page is a client component; edge gave nothing and was a compatibility risk |
| `f6490cb` | `GET /webrtc/ice-servers`: exchanges `CF_TURN_KEY_ID`/`CF_TURN_API_TOKEN` for 24 h Cloudflare TURN credentials (cached, STUN fallback); frontend fetches them after the socket connects, before creating peer connections | Calls across restrictive NATs need TURN; the long-lived key must never reach the browser. 6 unit tests |

## 4. Make it testable
| Commit | Change |
|---|---|
| `667cfda` | `/health` also returns `commit` (`RENDER_GIT_COMMIT`) and `uptimeSeconds`; new **test-support** module — `GET /test-support/status`, `POST /test-support/cleanup` — disabled by default (404, hidden from Swagger), needs `TEST_SUPPORT_ENABLED=true` + `TEST_ADMIN_TOKEN` (≥ 16 chars, header `x-test-token`), deletes only `@qa.beecollab.test` data in FK-safe order in one transaction. 8 unit tests + an integration run against Postgres with mixed real/test data |
| `878cc85` | 122 `data-testid` attributes + state attributes (`data-enabled`, `data-active`, `data-end-type`, …) across home, login and meeting pages; mobile duplicates prefixed to stay unique. No behaviour change |
| `3399eef` | `test/` workspace: `tools/` (wait-for-deploy, seed-accounts, cleanup, smoke-api 45 checks, smoke-ws 41 checks) and `e2e/` (64 Playwright tests, fake camera/mic, real WebRTC) |
| (this batch) | Playwright `global-teardown` (opt-in cleanup), `timedFetch`, exit-code hardening of the tools, `test/CLAUDE.md`, `.gitignore` for probe scripts, `test/tools/cleanup.sql` (**untested**) |

### Dependency security update (2026-10-07, after the first deployment)
`npm audit` reported 30 vulnerabilities in the backend (1 critical) and 18 in the frontend (1 critical). Applied the non-breaking fixes only (**never `--force`**):
* Backend: `npm audit fix` (lockfile only, 72 packages moved: `ws`, `socket.io` stack, `multer`, `qs`, `body-parser`, `proxy-addr`, …) and `npm update @prisma/client @prisma/adapter-pg prisma` so CLI, client and adapter are **all 7.10.0** (the audit fix alone had moved only the CLI — a version mismatch caught before anything was pushed).
* Frontend: `next` and `eslint-config-next` pinned to **16.4.0** (an exact pin cannot be moved by `audit fix`).
* Result (production dependencies): backend 20 → 6, frontend 9 → 0. The 6 left are the Prisma CLI chain (build-time only; its "fix" would downgrade Prisma) — accepted, see `test/07` R-42.
* Verified locally after the update: `tsc` + `next build`, backend build + Jest (24 pass, same 6 legacy suites fail), `smoke-api` 45/45, `smoke-ws` 41/41, Playwright 64/64 (exit code 0).

## 5. Verification matrix (end of run)
| Check | Local | Live (Vercel + Render + Neon + Cloudflare TURN) |
|---|---|---|
| `smoke-api` | 45/45 | 45/45 (TURN credentials returned) |
| `smoke-ws` | 41/41 | 41/41 |
| Playwright E2E | 64/64 | 64/64 |
| Backend Jest | 15 pass; 6 pre-existing suites fail | – |
| Clean-checkout build (`nest build`, `tsc --noEmit`) | pass | – |

## 6. Defects introduced by this work and fixed during it
Kept here for transparency (the goal was "no new bugs left behind").
| What | How it was caught | Fix |
|---|---|---|
| A scripted edit turned `'\n'` into a real newline in `HealthController`'s log line (syntax error) | `nest build` failed | Rewrote with a regex split |
| QA tools exited with code **127** on Windows (libuv assertion) when `fetch()` connections were still open at process exit — would have shown green test runs as failed in CI | Exit codes checked after the teardown/cleanup runs | `Connection: close` + short wait in the Playwright teardown; `process.exitCode` instead of `process.exit()` in `cleanup`/`seed`/`wait`; `timedFetch` (AbortController) replaces `AbortSignal.timeout`. Re-verified: all tools exit 0/1/2/3/4 as documented |
| **QA endpoints stayed at 404 after the owner enabled them** (reported 2026-10-07). `SETUP.md` had the cell ``true` (menyalakan endpoint …)`` — copying it whole put a sentence in `TEST_SUPPORT_ENABLED`, which the code (exact `"true"`) rejects; and the deliberate "404 identical to an unknown route" gave no way to tell why | Owner report; reproduced locally with that exact value | `8e34ac6`: one `readTestSupportConfig()` (trim, strip quotes, case-insensitive) drives the guard, a startup log line `QA endpoints disabled: <reason>` (never the token) and `/health` → `testSupport`; `8f40b7a`: bare values in the docs. Verified under 5 env configurations and live (`testSupport` field present, commit `8f40b7a`). At the time of writing the live value was still `"disabled"`: the Render environment value itself needs correcting (see OWNER-TODO §1) |
| Test-code mistakes (not application bugs): used a socket's `id` after it disconnected; looked for the own tile by account name (it is "You"); expected kick/force-mute to work on guests | Failing assertions investigated until the cause was proven | Fixed the tests; the guest behaviours are recorded as risks R-05…R-07 |

## 7. Known gaps at the end of this run
* `test/tools/cleanup.sql` was never executed against a database (the automated safety check blocked the verification step); the equivalent backend endpoint **is** verified.
* Screen sharing, real mobile devices and cross-network TURN usage are not automated (see `OWNER-TODO.md`, `test/06-test-ideas.md`).
* The 6 failing legacy Jest suites were left as-is on purpose (reported as R-41).
