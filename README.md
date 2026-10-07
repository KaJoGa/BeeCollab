# 🐝 BeeCollab

**BeeCollab** is a Google-Meet-style video meeting web app: peer-to-peer video/audio, screen sharing, live chat, hand raise, polls, agenda, reactions and host controls. It is a college project, now deployed on free-tier hosting and used as the **system under test** for a software-testing portfolio.

| | |
|---|---|
| 🌐 App | https://beecollab.vercel.app |
| 🔌 API | https://beecollab-rwbj.onrender.com (health: `/health`, Swagger: `/api/docs`) |

> The free hosting **sleeps** when idle. Opening any page of the app wakes the backend automatically (a banner says so); the first load after a long pause can take up to a minute.

## Features
* **Auth:** register / sign in (JWT), password-strength hint, show/hide password, logout confirmation, and **guest access** (display name only, no account).
* **Meetings:** create with title, duration and capacity; join by 8-character room code or link; automatic start, expiry and cleanup.
* **Real-time video:** WebRTC **full mesh** (no media server), screen sharing, voice-activity highlight, device switching, connection stats (RTT / bitrate / signal bars), bitrate caps that shrink as the mesh grows, and a **data-saver (audio-only)** mode.
* **Collaboration:** chat (persisted for registered users), hand-raise speaking queue, polls, agenda with live "current item", emoji reactions.
* **Host tools:** host and co-host roles, kick, force-mute, ask-to-unmute, end for everyone.
* **Reliability for free hosting:** wake-on-open, STUN + **Cloudflare TURN** fallback for restrictive networks, health endpoint reporting the deployed commit.

## Architecture
```
Browser ◄──── WebRTC (P2P, STUN/TURN) ────► Browser
   │  REST + Socket.io (/meetings)               │
   └──────────►  NestJS backend  ◄───────────────┘
                     │  Prisma
                     ▼
              PostgreSQL (Neon)        Cloudflare TURN (credentials minted by the backend)
```
The server never touches media; it handles authentication, meeting bookkeeping and **signaling**.

| Layer | Stack | Hosted on |
|---|---|---|
| Frontend | Next.js 16 (App Router, React 19), TypeScript, socket.io-client | Vercel (Hobby) |
| Backend | NestJS 11, Socket.io, Passport JWT, Prisma 7 (`@prisma/adapter-pg`), Swagger | Render (free) |
| Database | PostgreSQL | Neon (free, scale-to-zero) |
| NAT traversal | Google/Cloudflare STUN, Cloudflare Realtime TURN | Cloudflare |

### Software-engineering patterns used
| Pattern | Where |
|---|---|
| Repository + dependency inversion | `src/repositories/` — interfaces with Prisma implementations bound by DI tokens |
| Response envelope (interceptor) | `ResponseInterceptor` wraps every REST success in `{success,data,message,timestamp,path}` |
| Central exception filter | `HttpExceptionFilter` formats every error the same way |
| Observer / event-driven | `@nestjs/event-emitter`: services emit `meeting.ended`, `participant.joined/left`, `participant.media_changed`; `MeetingEventsListener` reacts (e.g. auto-end an empty meeting) |
| OpenAPI documentation | `@nestjs/swagger` at `/api/docs` |
| Guarded tooling | `test-support` endpoints are 404 unless explicitly enabled, token-protected, and scoped to `@qa.beecollab.test` data |

## Run it locally
Requirements: Node 20+, Docker, npm.
```bash
docker compose up -d                              # Postgres 16 on :5432

cd bee-collab-backend
cp .env.example .env                              # defaults match docker-compose
npm install
npx prisma generate && npx prisma migrate deploy
npm run start:dev                                 # http://localhost:3000   (Swagger: /api/docs)

cd ../bee-collab-frontend
cp .env.example .env.local
npm install
npm run dev                                       # http://localhost:3001
```
Windows shortcut: `run.bat` installs dependencies and starts both apps. Environment variables are documented in `bee-collab-backend/.env.example` and [test/02-environments-and-access.md](test/02-environments-and-access.md).

## Deployment (what is running)
| Piece | Service | Notes |
|---|---|---|
| Frontend | Vercel, root directory `bee-collab-frontend` | `NEXT_PUBLIC_API_URL` is baked in at build time |
| Backend | Render web service, root `bee-collab-backend` | build `npm install --include=dev && npx prisma generate && npm run build`, start `npm run start:prod`, Node 24 |
| Database | Neon | pooled URL for the app (`DATABASE_URL`), direct URL for migrations (`DIRECT_URL`); apply schema with `npx prisma migrate deploy` |
| TURN | Cloudflare | `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` on Render; browsers only ever receive short-lived credentials |
| CORS | `FRONTEND_ORIGIN` on Render | the Vercel origin; unset = `*` (local development) |

Every push to `main` redeploys both apps. `GET /health` returns `{ status, db, commit, uptimeSeconds }` so you can see which build is live. Step-by-step account setup: [SETUP.md](SETUP.md). Roadmap and decisions: [PLAN.md](PLAN.md). Change history of the deployment work: [CHANGES.md](CHANGES.md).

## Testing
Everything for testers lives in the local-only folder **`test/`** (git-ignored on purpose: it is handed to the QA agent directly and is not part of the published repository, so the `test/...` links in this file only work on the owner's machine): system and API documentation, feature inventory, test ideas, a risk list, Playwright E2E specs (real WebRTC with fake devices), and REST/WebSocket smoke tools.
```bash
cd test && npm install && npx playwright install chromium
npm run smoke     # ≈ 90 REST + WebSocket checks
npm run e2e       # 64 browser tests (WEB_URL / API_URL select the environment)
```
Backend unit tests: `cd bee-collab-backend && npm test` (note: 6 generated suites are known to fail — see [test/07-observed-behaviors-and-risks.md](test/07-observed-behaviors-and-risks.md), R-41).

## Repository layout
```
BeeCollab/
├── bee-collab-backend/     NestJS API + signaling (src/, prisma/, .env.example)
├── bee-collab-frontend/    Next.js app (src/app: home, login, meeting/[id], WakeServer)
├── test/                   QA workspace (local only, git-ignored): docs 01–09, tools/, e2e/
├── docker-compose.yml      local Postgres
├── run.bat                 Windows launcher
├── CLAUDE.md               context for AI assistants working in the repo
├── PLAN.md                 roadmap, decisions, status
├── SETUP.md                owner's account setup guide (Indonesian)
├── CHANGES.md              change log of the deployment/test-readiness work
└── OWNER-TODO.md           things only the owner can do (Indonesian)
```

## License
Educational project. No warranty.
