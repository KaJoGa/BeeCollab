# BeeCollab

**BeeCollab** is a Google-Meet-style video meeting web application featuring peer-to-peer audio/video calling, screen sharing, real-time chat, hand-raising, polls, agenda tracking, reactions, and comprehensive host management tools.

| | Deployment Link |
|---|---|
| **Live App** | [https://beecollab.vercel.app](https://beecollab.vercel.app) |
| **API Docs** | [Swagger UI](https://beecollab-rwbj.onrender.com/api/docs) |

> [!NOTE]
> The backend is deployed on a free-tier instance that **sleeps when idle**. Accessing the app or Swagger documentation for the first time will automatically wake the server; initial cold starts may take approximately 30–60 seconds.

---

## Features

* **Authentication & Access:** Email & password sign-up/sign-in (JWT), password-strength indicators, show/hide password, and **guest access** (join meetings instantly with just a display name, no account needed).
* **Meeting Management:** Create instant meetings with customizable duration and participant limits, join via direct link or 8-character room code, and automatic meeting lifecycle cleanup.
* **Real-Time Video & Audio:** WebRTC **full mesh** (peer-to-peer, no media server required), screen sharing, active speaker detection, device switching, real-time connection stats (RTT, bitrate, signal quality), and adaptive bitrate caps with an **audio-only data-saver mode**.
* **Interactive Collaboration:** Live in-meeting chat, hand-raise speaking queue, interactive polls, agenda tracking with live active-item indicators, and floating emoji reactions.
* **Host & Co-host Controls:** Assign co-hosts, kick participants, remote mute, request to unmute, and end the meeting for all participants.
* **Bilingual Interface:** Built-in English and Indonesian language support with instant toggle.
* **Free-Tier Resilience:** Automatic wake-on-open mechanism, STUN servers + **Cloudflare Realtime TURN** relay fallback for restrictive NATs and firewalls.

---

## Architecture

```
Browser ◄──── WebRTC (P2P, STUN/TURN) ────► Browser
   │  REST + Socket.io (/meetings)               │
   └──────────►  NestJS backend  ◄───────────────┘
                     │  Prisma
                     ▼
              PostgreSQL (Neon)        Cloudflare TURN (credentials minted by the backend)
```

The application uses a full-mesh architecture where media streams flow directly between peers; the backend server only handles authentication, meeting state management, and **WebRTC signaling**.

| Layer | Stack | Platform |
|---|---|---|
| Frontend | Next.js 16 (App Router, React 19), TypeScript, socket.io-client | Vercel (Hobby) |
| Backend | NestJS 11, Socket.io, Passport JWT, Prisma 7 (`@prisma/adapter-pg`) | Render (Free) |
| Database | PostgreSQL | Neon (Serverless Postgres) |
| NAT Traversal | Google/Cloudflare STUN, Cloudflare Realtime TURN | Cloudflare |

### Software Engineering Patterns
| Pattern | Implementation |
|---|---|
| Repository + Dependency Inversion | `src/repositories/` — interfaces with Prisma implementations bound by NestJS DI tokens |
| Response Envelope (Interceptor) | `ResponseInterceptor` wraps REST responses uniformly in `{success, data, message, timestamp, path}` |
| Central Exception Filter | `HttpExceptionFilter` provides standard error formatting across all REST endpoints |
| Observer / Event-Driven | `@nestjs/event-emitter`: services emit lifecycle events (`meeting.ended`, `participant.left`, etc.); `MeetingEventsListener` handles reactive logic |
| Guarded Tooling | Optional test-support endpoints are protected, disabled by default, and scoped to test data |

---

## Run It Locally

### Prerequisites
* Node.js 20+
* Docker & Docker Compose
* npm

### Setup Steps
```bash
# 1. Start local PostgreSQL
docker compose up -d

# 2. Setup backend
cd bee-collab-backend
cp .env.example .env                              # Defaults match docker-compose
npm install
npx prisma generate && npx prisma migrate deploy
npm run start:dev                                 # Runs on http://localhost:3000

# 3. Setup frontend
cd ../bee-collab-frontend
cp .env.example .env.local
npm install
npm run dev                                       # Runs on http://localhost:3001
```

> **Windows shortcut:** Run `run.bat` from the root directory to install dependencies and start both apps simultaneously. Environment variables are documented in `bee-collab-backend/.env.example` and `bee-collab-frontend/.env.example`.

---

## Deployment Overview

| Component | Platform | Configuration Notes |
|---|---|---|
| Frontend | Vercel | Root directory `bee-collab-frontend`, `NEXT_PUBLIC_API_URL` set at build time |
| Backend | Render | Root directory `bee-collab-backend`, Node 24 runtime, starts with `npm run start:prod` |
| Database | Neon | Pooled connection for the runtime app (`DATABASE_URL`), direct URL for migrations (`DIRECT_URL`) |
| TURN Relay | Cloudflare | Ephemeral TURN credentials generated server-side |
| CORS | Backend environment | Locked to the frontend origin via `FRONTEND_ORIGIN` |

---

## Testing

### Backend Unit Tests
```bash
cd bee-collab-backend
npm test
```

The test suite covers core authentication, meeting lifecycle handling, and signaling event routing.

---

## Repository Layout

```
BeeCollab/
├── bee-collab-backend/     # NestJS API, WebSocket signaling gateway & Prisma schema
├── bee-collab-frontend/    # Next.js 16 web client & WebRTC UI components
├── docker-compose.yml      # Local PostgreSQL 16 container definition
├── run.bat                 # Windows development launcher script
└── README.md               # Project documentation
```