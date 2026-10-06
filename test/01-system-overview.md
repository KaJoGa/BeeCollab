# 01 — System overview

## What it is
BeeCollab lets people open a meeting room (video, audio, screen share, chat, hand raise, polls, agenda, reactions). Media is **peer-to-peer WebRTC in a full mesh** — there is no media server. The backend only does authentication, meeting bookkeeping, and **signaling** (relaying WebRTC setup messages and room events).

```
 Browser A ◄──────── WebRTC media (P2P, via STUN or TURN relay) ────────► Browser B
    │  REST (https) + Socket.io (wss, namespace /meetings)                    │
    └───────────────────────────►  NestJS backend  ◄──────────────────────────┘
                                       │  Prisma (pg adapter)
                                       ▼
                               PostgreSQL (Neon)         Cloudflare TURN (short-lived credentials,
                                                         requested by the backend, never in the bundle)
```

| Piece | Tech | Hosting |
|---|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, inline styles + a CSS module | Vercel (Hobby) |
| Backend | NestJS 11, Socket.io, Passport JWT, Prisma 7 + `@prisma/adapter-pg`, `@nestjs/event-emitter`, `@nestjs/schedule` | Render (free) |
| Database | PostgreSQL | Neon (free, scale-to-zero) |
| TURN/STUN | Cloudflare Realtime TURN + public STUN | Cloudflare |

**Consequence of free hosting:** Render sleeps after ~15 minutes with no HTTP request or WebSocket message; Neon suspends its compute after ~5 minutes idle. The first request after a pause takes up to ~1 minute. The frontend hides this with *wake-on-open* (see below).

## Identity model
| Kind | How created | Stored in DB? | Token |
|---|---|---|---|
| **Registered user** | `POST /auth/register` | yes (`User`) | JWT `{ sub: <uuid>, email }` |
| **Guest** | `POST /auth/guest` with a display name | **no** | JWT `{ sub: "guest_<uuid>", name, isGuest: true }` |

Tokens are stored by the frontend in `localStorage` (`token`, plus `guestName` for guests). Default lifetime 1 day. Guests can join meetings but the UI does not let them create one.

Roles inside a meeting: `HOST` (creator), `CO_HOST` (promoted by the host), `PARTICIPANT`. Guests are always participants.

## Data model (PostgreSQL)
`User(id, email unique, name, passwordHash, avatarUrl?)` · `Meeting(id, title, roomCode unique, hostId→User, status SCHEDULED|LIVE|ENDED, maxParticipants, duration[min], startedAt?, endedAt?)` · `Participant(id, meetingId, userId→User, socketId?, role, audioEnabled, videoEnabled, handRaisedAt?, joinedAt, leftAt?; unique(meetingId,userId))` · `ChatMessage(id, meetingId, senderId→User, message text, type TEXT|SYSTEM)` · `Agenda(meetingId cascade, title, duration[s], order, startTime?, endTime?, isActive)` · `Poll(meetingId cascade, question, isActive)` → `PollOption(text)` · `PollResponse(pollId, optionId, userId→User; unique(pollId,userId))` · `Reaction(meetingId cascade, type, userId? — not a FK)`.

Because `Participant`, `ChatMessage` and `PollResponse` have foreign keys to `User`, **guests (who have no `User` row) cannot be persisted there** — the code works around this per feature (see risks).

## Meeting lifecycle (important for test design)
1. `POST /meetings` → `SCHEDULED`; the creator gets a `HOST` participant row. Room code = 8 uppercase hex characters.
2. The first WebSocket `meeting:join` (registered **or** guest) flips it to `LIVE` and sets `startedAt`.
3. A meeting is **hard-deleted** (participants → chat → meeting row; agenda/polls/reactions cascade) when **any** of these happens:
   - the host ends it (`meeting:end` or `DELETE /meetings/:id`),
   - the **last participant disconnects** (event listener auto-end),
   - it **expires**: a sweep every 30 s deletes `LIVE` meetings where `startedAt + duration` has passed (clients get `meeting:ended` with a reason containing "durasi"/"habis").
4. There is no ended-meeting history: `ENDED` status exists but is effectively never persisted. After deletion, `GET /meetings/:id` is `404`.

> Test-design consequence: a meeting disappears the moment its last socket disconnects. To keep one alive during a test, keep at least one socket connected.

## Capacity
* API: `maxParticipants` 2–500 (default **10**), `duration` 1–1440 minutes (default **15** — Swagger claims 60).
* UI form: 2–10 participants, default duration 60.
* Enforced on WebSocket join by counting **distinct users** already in the room (not counting the joiner). A refused socket receives `meeting:full` and is disconnected.
* The same user opening a second tab: the **older** socket receives an `error` and is disconnected.

## Frontend behaviour worth knowing
* **Wake-on-open:** a root-layout component calls `GET /health` on every full page load (home, login, direct meeting links), retries every 3 s until `db: "up"`, and shows a banner *"Waking up the server, this can take up to a minute…"* after 2 s.
* **Joining screen:** the meeting page shows a full-screen loader until meeting info is fetched (+0.8 s).
* **Meeting existence poll:** every 15 s the meeting page calls `GET /meetings/:id`; a `404` shows the "meeting ended" screen.
* **End screens** (`meeting-ended-overlay`, `data-end-type` = `ended | kicked | expired | full`): all except `kicked` run a 30 s countdown then return home.
* **Layouts:** a desktop bottom bar and a mobile top bar/kebab menu both exist in the DOM; mobile ones are hidden by CSS. A screen-share changes the grid into "large share + sidebar" layout.
* **Bandwidth control:** video bitrate cap shrinks as the mesh grows (1200 kbps for 1 peer, 600 for ≤3, 300 beyond); audio capped at 32 kbps with DTX; "Data saver" stops receiving remote video.
* **Connection stats** (RTT, ↓/↑ rate, 4 signal bars) are shown on the local tile, polled every 2 s.
* **Own tile** is labelled "You" (`data-name="You"`), never with the account name.

## Operational limits you will meet
| Resource | Limit | Effect |
|---|---|---|
| Render free | 750 instance-hours/month, sleeps after 15 min idle | cold starts; suspension if hours run out |
| Neon free | 100 compute-hours/month, 1 GB storage, autosuspend 5 min | slow first query; DB-full risk |
| Cloudflare TURN | 1 000 GB/month free | only used when P2P fails |
| Vercel Hobby | ~100 GB bandwidth/month | irrelevant for tests |

## Source layout (for white-box readers)
`bee-collab-backend/src/` — `signaling/signaling.gateway.ts` (all WebSocket events), `meetings/` (REST + cleanup sweep + agenda/poll/reaction services), `events/meeting-events.listener.ts` (auto-end), `repositories/` (Prisma behind interfaces), `auth/`, `chat/`, `users/`, `webrtc/` (ICE servers), `health/`, `test-support/` (disabled-by-default cleanup).
`bee-collab-frontend/src/app/` — `page.tsx` (home), `login/page.tsx`, `meeting/[id]/page.tsx` (one ~2 950-line client component with all meeting UI and WebRTC), `WakeServer.tsx`.
