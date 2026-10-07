# BeeCollab — project context

College project: Google-Meet-style video meetings (WebRTC **full mesh**, no SFU). Deployed on free-tier hosting and used as the **system under test** for the owner's software-testing portfolio. Claude's job here: keep it deployable and testable; a separate QA agent works in `test/`. Roadmap/status: [PLAN.md](PLAN.md). What changed and why: [CHANGES.md](CHANGES.md). Owner-only actions: [OWNER-TODO.md](OWNER-TODO.md).

**Live:** frontend https://beecollab.vercel.app (Vercel Hobby) · backend https://beecollab-rwbj.onrender.com (Render free) · DB Neon free Postgres · TURN Cloudflare. Free tiers sleep when idle, so the frontend wakes the backend on every page load via `GET /health` (no keep-alive pinging). `/health` returns `{status, db, commit, uptimeSeconds}`; `commit` is how you confirm which build is live after a push (`cd test && API_URL=… npm run wait -- --commit <sha>`).

**`test/` is LOCAL-ONLY and git-ignored on purpose** (owner decision: it exists for the QA agent only). Never `git add -f test`, never push it. Files stay on disk; edit them freely. Earlier commits on `main` still contain it in history (it was pushed before this decision).

## Layout
Monorepo, no root package.json. Each app has its own `npm install`.

| | `bee-collab-backend/` | `bee-collab-frontend/` | `test/` |
|---|---|---|---|
| Stack | NestJS 11, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL, Socket.io | Next 16.2 (App Router), React 19, socket.io-client, lucide-react | Playwright, socket.io-client, Node ESM tools |
| Port | 3000 | 3001 | – |
| Dev | `npm run start:dev` | `npm run dev` | – |
| Build/run | `npm run build` → `npm run start:prod` | `npm run build` → `npm start` | `npm run smoke`, `npm run e2e` |
| Tests | `npm test` (15 pass; **6 legacy scaffold suites fail**, pre-existing), `npm run test:e2e` | none | 45 REST + 41 WS checks, 64 E2E tests |

First time locally: `docker compose up -d`; backend `cp .env.example .env`, `npx prisma generate && npx prisma migrate deploy`; frontend `cp .env.example .env.local`. Production/Neon uses `prisma migrate deploy` with `DIRECT_URL`. `run.bat` starts both apps in dev mode. `NEXT_PUBLIC_*` is baked in at build time.

Backend env: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `FRONTEND_ORIGIN` (CORS, comma-separated; unset = `*`), `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`, optional `TEST_SUPPORT_ENABLED` + `TEST_ADMIN_TOKEN`.

**Database: PostgreSQL, deliberately kept** (owner wants SQL so it can be tested). Do not migrate to MySQL.

**Next.js 16 has breaking changes.** `bee-collab-frontend/AGENTS.md` says to read `node_modules/next/dist/docs/` before writing frontend code.

## Backend map (`bee-collab-backend/src`)
- `signaling/signaling.gateway.ts` — **all** WebSocket events on namespace `/meetings`; `signaling.service.ts` the DB side. JWT in `handshake.auth.token` (`WsJwtGuard`).
- `meetings/` — REST CRUD, `meetings.cleanup.service.ts` (30 s sweep, deletes expired meetings), agenda/poll/reaction services.
- `events/meeting-events.listener.ts` — Observer: auto-ends a meeting when the last participant leaves.
- `repositories/` — Repository pattern (interfaces + Prisma impls, DI tokens in `tokens.ts`).
- `common/` — `ResponseInterceptor` (`{success,data,message,timestamp,path}`), `HttpExceptionFilter`, `cors.ts` (`getAllowedOrigins`).
- `auth/` — `POST /auth/register|login|guest`. Swagger at `/api/docs`.
- `health/` — `GET /health`. `webrtc/` — `GET /webrtc/ice-servers` (Cloudflare TURN creds, STUN fallback, cached). `test-support/` — `GET /test-support/status`, `POST /test-support/cleanup`: **404 unless `TEST_SUPPORT_ENABLED=true`**, header `x-test-token`, deletes only `@qa.beecollab.test` data.
- `prisma/prisma.service.ts` — pg Pool tuned for Neon (15 s connect timeout, idle-error handler).
- `src/generated/prisma/` is tracked but unused (imports use `@prisma/client`).

Schema models: User, Meeting, Participant, ChatMessage, Agenda, Poll, PollOption, PollResponse, Reaction.

## Frontend map (`bee-collab-frontend/src/app`)
- `page.tsx` home, `login/page.tsx`, `meeting/[id]/page.tsx` (**one ~2950-line client component**: WebRTC perfect-negotiation per peer, stats polling, bitrate caps, audio-only mode, chat/people/agenda/polls, inline mobile CSS), `WakeServer.tsx` (root layout; pings `/health`, banner while waking).
- ~122 `data-testid` hooks plus state attributes; catalogue in `test/08-selectors-and-test-data.md`. Mobile-only duplicates are prefixed `mobile-`/`ctrl-mobile-`. **When adding UI, keep ids unique per layout and update that doc.**
- Auth state in `localStorage`: `token`, `guestName`. `/meeting/[id]` accepts a UUID or an 8-char room code. The own tile is labelled "You".

## Behaviour that is easy to get wrong
- **Guests** have a JWT (`sub = guest_<uuid>`, `isGuest`) and **no DB rows**; kick/force-mute/co-host/poll-vote/REST create+join do **not** work for them (documented as risks R-01…R-07).
- A meeting is **hard-deleted** when the host ends it, it expires, or the **last socket disconnects**. Keep one socket open in tests.
- API defaults: `maxParticipants` 10, `duration` 15 (Swagger claims 60). Capacity enforced on WS join (distinct users).
- Single-node by design; media never touches the server.
- A socket's `id` is `undefined` after disconnect (socket.io-client).

## Working agreements
- Owner mixes Indonesian and English; reply in the language they use.
- **Known weaknesses are intentionally NOT fixed** — they are material for QA (`test/07-observed-behaviors-and-risks.md`). Fix only defects introduced by your own change.
- Commit in small, separate commits. Push to `main` only when a live test needs it: every push redeploys Render and drops live sockets (confirm with `/health` `commit`).
- Match existing style (backend `.prettierrc`; frontend plain TS with inline styles). Several frontend files use CRLF; preserve line endings when editing.
- Never put secrets in chat, docs or git. Owner's secrets live in Render env and their own notes.
- Prefer the Write tool over shell heredocs for files containing many quotes (shell quoting broke repeatedly).
