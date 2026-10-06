# 07 — Observed behaviours and suspected defects

These came from the developer reading the code and from probing the running system. **Nothing here was fixed on purpose** — they are the raw material for QA findings. Treat each as a *lead*: confirm, characterise (severity, scope, reproduction), then report with [09-reporting.md](09-reporting.md).

**Evidence levels**
* **VERIFIED** — reproduced against the running system (local and/or live); the way is stated.
* **CODE** — read in the source, plausible, not yet reproduced.
* **IDEA** — a hypothesis worth testing.

IDs are stable; cite them in reports (e.g. "relates to R-05").

## A. Guests (identity without a database row) — the largest source of defects
Guests have a JWT but **no `User` row**, so every feature that needs a foreign key to `User` must special-case them. Some were special-cased, others were missed.

| ID | Observation | Evidence | Suggested check | Likely severity |
|---|---|---|---|---|
| **R-01** | `POST /meetings` with a **guest token** → **500 Internal server error** (foreign-key failure). The UI hides the button, the API does not stop it. | VERIFIED (curl, local) | Authz matrix; expect 403, got 500 | Medium |
| **R-02** | `POST /meetings/:id/join` with a guest token → **500**. | VERIFIED | same | Low (UI uses WS) |
| **R-03** | `GET /users/me` with a guest token → **404 "User not found"**. | VERIFIED | | Low |
| **R-05** | Guests cannot vote in polls: `poll:vote` stores `PollResponse.userId` with a FK to `User`. The UI offers the vote buttons to guests. | VERIFIED (WebSocket probe: guest `poll:vote` on a real poll → the guest receives `exception`, nobody receives `poll:updated`) | Guest joins, host launches a poll, guest clicks an option → no vote, no feedback | Medium |
| **R-06** | **A guest cannot be kicked**: `meeting:kick` looks the target up in `Participant`, which has no row → server answers `error "Participant not found"`; the UI shows no feedback and the guest stays. | VERIFIED (WebSocket probe: host `meeting:kick` on a guest → host gets `error {"message":"Participant not found"}`; the guest receives no `meeting:kicked` and stays connected). The registered-user variant works. | Host kicks guest in the people panel | Medium |
| **R-07** | **Force-mute on a guest throws** a Prisma `P2025` ("record to update not found") before `media:force-mute` is emitted, so the guest is **not** muted. `media:ask-unmute` works for guests (it only relays). | VERIFIED (WebSocket probe: host `media:force-mute` on a guest → host gets `exception`, the guest never receives `media:force-mute`; backend log shows Prisma `P2025`) | Host uses "Mute user" on a guest with the mic on | Medium |
| R-07b | Co-host promotion of a guest (`meeting:make-cohost`) targets a missing `Participant` row too. The UI offers it. | VERIFIED (probe: `exception` on the host's socket) | | Low |
| R-07c | Guest chat messages are never stored: later joiners and refreshed pages lose them. Guest hand-raise and role state live only on the socket. | VERIFIED (E2E asserts the late joiner does not see a guest message) | By design? Decide and document | Low |

## B. Authorization and information exposure
| ID | Observation | Evidence | Suggested check | Severity |
|---|---|---|---|---|
| **R-04** | Any authenticated user (**including a guest**) can read the details, participant list **and full chat history** of *any* meeting by UUID, and the response includes the room code. | VERIFIED (`GET /meetings/:id`, `/participants`, `/chat` → 200 with a token of a stranger, local) | IDOR matrix | High (privacy) |
| **R-08** | `meeting:join` does **not** check the room code or membership — knowing the UUID is enough (and R-04 hands out the UUID/code). | VERIFIED (stranger joined by UUID without code) | | High |
| **R-09** | A socket with a **garbage token** stays connected (the handshake only checks a token is *present*); guarded events then fail, but the **unguarded `media:speaking`** works and reaches every member of any room whose UUID the sender passes — even if the sender never joined. | VERIFIED | Spoof speaking indicators in someone else's meeting | Medium |
| R-09b | `webrtc:offer/answer/ice-candidate` relay to any socket id for any valid token; the sender's room membership is not checked. `poll:vote`, `reaction:send`, `chat:message` accept any `meetingId` from a valid token without checking the sender joined that room. | CODE (gateway) | Cross-room matrix | Medium |
| R-09c | `meeting:join` of a **non-existent** meeting raises an unhandled error (`exception` event; backend logs a Prisma error) instead of a clean refusal. | VERIFIED | | Low |
| R-10 | Error bodies may leak internals (e.g. Prisma messages) on 500s. | IDEA | Provoke 500s and read `error` | Medium |
| R-11 | Room code is only 8 hex characters (32 bits) with no rate limiting; codes are the only gate to a meeting *if* R-08 were fixed. | CODE | brute-force feasibility | Medium |
| R-12 | **No rate limiting anywhere**: registration, login, `/auth/guest` (free tokens), meeting creation. | VERIFIED by absence in code; IDEA for impact | local burst test | Medium |
| R-13 | JWT stored in `localStorage` and sent in the Socket.io handshake; any XSS exposes it. Chat text is rendered by React (escaped) — verify no `dangerouslySetInnerHTML` regressions. | CODE | | Medium |
| R-14 | Password policy is minimum 6 characters; no breach/complexity check; registration reveals whether an email exists (409). | VERIFIED | | Low |

## C. API contract / behaviour
| ID | Observation | Evidence | Suggested check | Severity |
|---|---|---|---|---|
| **R-15** | Swagger says `duration` defaults to **60**; the API actually defaults to **15** (and `maxParticipants` 10, schema says 50). The UI form sends 60. | VERIFIED (`POST /meetings` without those fields) | Contract test against Swagger | Low |
| R-16 | Room-code lookup is **case-sensitive**: `abcd1234` → 404. Only the *guest* join panel upper-cases input. | VERIFIED (API) | | Low |
| **R-17** | A **registered** user typing a lower-case code in the home "Join" box ends on `/meeting/<lowercase>` with the **joining screen never disappearing** (the lookup 404s and the page silently gives up). | VERIFIED (Playwright probe: URL `/meeting/03e6d926`, joining screen still present after 6 s) | Also try garbage codes | Medium (UX dead end) |
| R-18 | Joining/entering a code that does not exist gives **no error message** (navigates to `/meeting/<text>` and hangs). | CODE + R-17 | | Medium |
| R-19 | Create-meeting failure shows only "Failed to create meeting. Please try again." regardless of cause (validation, auth, outage). | CODE | | Low |
| R-20 | `ENDED` status/`endedAt` are never persisted: meetings are hard-deleted, so there is no history or audit trail, and a refresh/rejoin after an end gives 404. | VERIFIED | | Design |
| R-21 | Meeting auto-deletes the moment the last socket disconnects — **including a brief network drop of a solo host** (their meeting and chat are gone, the room code stops working). | VERIFIED (probe: solo host's meeting `GET` 200 while connected → 404 within 1.5 s of the socket closing) | Solo host reconnect | Medium |
| R-22 | `agenda:create` appends with `order` restarting at 0 on every call (a second call creates duplicate `order` values); the UI hides the form once an agenda exists, so only the API/socket can trigger it. | CODE | | Low |
| R-23 | `poll:vote` rebroadcasts **all** polls (`poll:updated` replaces the client's list); `isActive`/`closePoll` exist but have no UI/event. | CODE | | Low |

## D. Frontend
| ID | Observation | Evidence | Suggested check | Severity |
|---|---|---|---|---|
| **R-24** | **Own chat messages are shown as someone else's** (left-aligned, with the sender's name rather than "You") because `isMe` compares `senderId` to the *token* (code comment: "Simplification for demo"). | VERIFIED (Playwright probe: own message text `"Q | QA probe-chat | 06:13 AM | my own message"`, `flex-direction: row`) | Visual check | Medium |
| R-25 | Chat timestamps use `new Date()` **at render time**, so every message shows the current time and all change when the list re-renders. | CODE | Send messages minutes apart | Low |
| R-26 | Agenda "Current Item" progress bar is a hard-coded 45% and never advances. | CODE | | Low |
| R-27 | In the meeting component `useState`/`useEffect` calls appear **after an early `return`** (React hook-order rule). Works while `meetingId` is always present. | CODE | lint (`react-hooks/rules-of-hooks`) | Low |
| R-28 | The "Ask to unmute" prompt and "Meeting ID copied" use blocking `window.confirm/alert`; screen-share conflict uses `alert`. Automation must handle dialogs; users get blocked UI. | CODE + VERIFIED (E2E handles the dialog) | | Low |
| R-29 | The home page "System Online/Offline" chip checks `GET /` once on load and never updates (it can stay "Offline" after the server wakes). | VERIFIED earlier (observed stuck "System Offline" while the wake banner had already cleared) | | Low |
| R-30 | Home page fetches `/meetings` for every logged-in visit and silently logs out on 401; a transient 401 (e.g. clock skew) drops the session. | CODE | | Low |
| R-31 | Mixed-language strings: `"Membuka dari tab lain. Koneksi ini ditutup."`, expiry reason `"…durasi habis."` and `"Pertemuan berakhir…"` in an English UI; the expiry detection matches the substrings `durasi`, `habis`, `time`. | CODE | i18n | Low |
| R-32 | Many icon-only buttons have no accessible name (`aria-label`), colour contrast not checked, no keyboard focus management in modals. | IDEA | axe | Medium (a11y) |
| R-33 | After a kick the user gets a "Rejoin" button that simply reloads; there is no ban — the host cannot keep someone out. | CODE | | Design |
| R-34 | Duplicate-tab handling: the *older* tab is silently disconnected with only a console error; the user sees a frozen meeting. | CODE + VERIFIED at socket level | | Low |

## E. WebRTC / infrastructure
| ID | Observation | Evidence | Suggested check | Severity |
|---|---|---|---|---|
| R-35 | Full-mesh topology: upload grows with (N−1); quality degrades noticeably past ~4–6 cameras (bitrate caps 1200/600/300 kbps). Max participants goes up to 10 in the UI. | CODE (design limit) | Scale test | Design |
| R-36 | Neon and Render free tiers sleep: first request after ~15 min idle takes up to ~1 min; wake-on-open hides it on page load but **API calls made by scripts** (not via the page) can time out. | VERIFIED | Cold-start measurements | Ops |
| R-37 | Every push to `main` redeploys and drops all live sockets; there is no graceful drain beyond Render's 30 s shutdown window. | CODE/ops | deploy during a call | Ops |
| R-38 | Single backend instance only: socket state (`socket.data`, rooms) is in memory and there is no Redis adapter; the speaking-queue helper reads local sockets only. | CODE | | Design |
| R-39 | TURN credentials are valid 24 h and handed to **any** authenticated user, including guests (free tokens, R-12) — anyone can relay arbitrary traffic through the owner's Cloudflare quota (1 000 GB/month free). | CODE + VERIFIED that guests receive them | | Medium (cost) |
| R-40 | CORS on the live backend is restricted to the Vercel origin (REST + Socket.io) — but CORS only constrains browsers, not scripts. | VERIFIED | | Info |
| R-41 | Backend unit-test scaffolds: 6 of 8 original Jest suites fail on a clean checkout (missing providers). | VERIFIED | | Quality |

## F. Things that look wrong but are intentional (avoid false positives)
* Login returns **201** (Nest default for `@Post`).
* The own tile is labelled "You" (`data-name="You"`), not the account name.
* A meeting disappears when empty (by design: no history) — but see R-21 for the harsh consequence.
* `/health` answers 200 even when `db:"down"` (liveness vs readiness); the *body* tells the truth.
* Cleanup/test endpoints return 404 on the live backend (disabled on purpose).
* Mobile controls are present in the DOM but hidden on desktop (ids prefixed `mobile-`).

## Where to start
Highest information value per hour: **R-04/R-08/R-09** (authorization), **R-06/R-07** (guests vs host tools), **R-17/R-18** (dead-end join), **R-21** (solo host drop), **R-24** (own messages), then the reconnect behaviours in [06](06-test-ideas.md).
