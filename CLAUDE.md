# BeeCollab — project context

College project: Google-Meet-style video meetings (WebRTC **full mesh**, no SFU). Being prepared for redeployment and to serve as the **system under test** for the owner's software-testing portfolio. Claude's job here: get it deployable and testable, then write a test spec that the owner hands to a separate "Claude Test" agent. See [PLAN.md](PLAN.md) for roadmap and status.

**Target hosting (decided, not yet deployed):** frontend on Vercel (Hobby), backend on Render free, DB on Neon free, TURN from Cloudflare. Free tiers sleep when idle, so the frontend wakes the backend on every page load via `GET /health` (no keep-alive pinging). Details in PLAN.md; owner's account steps in [SETUP.md](SETUP.md).

## Layout
Monorepo, no root package.json. Each app has its own `npm install`.

| | `bee-collab-backend/` | `bee-collab-frontend/` |
|---|---|---|
| Stack | NestJS 11, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL, Socket.io | Next 16.2 (App Router), React 19, socket.io-client, lucide-react |
| Port | 3000 | 3001 |
| Dev | `npm run start:dev` | `npm run dev` |
| Build | `npm run build` → `npm run start:prod` (`node dist/src/main`) | `npm run build` → `npm start` |
| Test | `npm test`, `npm run test:e2e` (mostly empty Nest scaffolds) | none |

`run.bat` (Windows) installs deps and launches both. Backend needs `.env`: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`; optional `DIRECT_URL` (used by `prisma.config.ts` for migrations). Frontend needs `NEXT_PUBLIC_API_URL` (falls back to `http://<hostname>:3000`). First time: `docker compose up -d` (local Postgres, see docker-compose.yml), copy `.env.example` → `.env` / `.env.local`, then in the backend `npx prisma generate && npx prisma migrate dev` (production/Neon: `npx prisma migrate deploy`).

**Database: PostgreSQL, deliberately kept** (owner wants SQL so it can be tested; a previous Firebase/NoSQL project could not). Do not migrate to MySQL.

**Next.js 16 has breaking changes.** `bee-collab-frontend/AGENTS.md` says to read `node_modules/next/dist/docs/` before writing frontend code. Install deps first.

## Backend map (`bee-collab-backend/src`)
- `signaling/signaling.gateway.ts` — **all** WebSocket events on namespace `/meetings` (join, `webrtc:*` relay, media toggle/speaking, chat, hand/queue, agenda, poll, reaction, kick, force-mute, ask-unmute, co-host). `signaling.service.ts` holds the DB side. JWT comes in `handshake.auth.token`, verified by `WsJwtGuard`.
- `meetings/` — REST CRUD (`POST /meetings`, `GET /meetings/code/:roomCode`, `POST /:id/join`, …), `meetings.cleanup.service.ts` (30 s interval, deletes meetings past `duration`), agenda/poll/reaction services.
- `events/meeting-events.listener.ts` — Observer pattern (`@nestjs/event-emitter`); auto-ends a meeting when the last participant leaves.
- `repositories/` — Repository pattern: interfaces + Prisma impls bound via tokens in `tokens.ts`.
- `common/` — `ResponseInterceptor` wraps every REST response as `{success, data, message, timestamp, path}`; `HttpExceptionFilter` does the same for errors. Frontend strips it with `unwrap()`.
- `auth/` — `POST /auth/register|login|guest`. Swagger at `/api/docs`.
- `src/generated/prisma/` is tracked, but imports use `@prisma/client`; treat as generated noise.

Schema models: User, Meeting, Participant, ChatMessage, Agenda, Poll, PollOption, PollResponse, Reaction.

## Frontend map (`bee-collab-frontend/src/app`)
- `page.tsx` home (create / join by code / guest join), `login/page.tsx`, `meeting/[id]/page.tsx` (**one ~2900-line client component**: WebRTC perfect-negotiation per peer, stats polling, bitrate caps that shrink as the mesh grows, audio-only mode, chat/people/agenda/polls panels, inline mobile CSS). No shared components, no frontend tests.
- Auth state is in `localStorage`: `token`, `guestName`. `/meeting/[id]` accepts a UUID or an 8-char room code.
- `WakeServer.tsx` (mounted in root layout) pings `GET /health` until backend+DB are up and shows a banner meanwhile.

## Behaviour that is easy to get wrong
- **Guests** have a JWT (`sub = guest_<uuid>`, `isGuest: true`) and **no DB rows**. Every gateway handler needs an explicit guest path. Guest chat is in-memory only; guest hand state lives on `socket.data`.
- Ending a meeting (host, expiry, or last person leaves) **hard-deletes** participants, chat and the meeting row. `ENDED` status is effectively unused.
- Defaults: create-meeting `maxParticipants` 10, `duration` 15 min (schema defaults 50/60 are not what the API uses). Capacity is enforced on WS join, counting distinct users.
- Server is single-node by design (in-memory socket state, no Redis adapter).
- Media never touches the server; load is on clients' CPU/uplink. Server cost is signaling only. WebRTC uses Google STUN only — **no TURN yet** (planned).
- Known weaknesses are intentionally **not** fixed yet; they are candidate test findings and will be triaged with the owner (see PLAN.md). Don't silently "fix" them.

## Working agreements
- Owner mixes Indonesian and English; reply in the language they use.
- Owner wants to discuss before changing the known weaknesses; ask first.
- Match existing style (backend has `.prettierrc`; frontend is plain TS with inline styles).
- Don't commit unless asked.
