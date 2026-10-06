# 03 — Feature inventory

Legend for **Auto**: ✅ covered by the starter suite (file in parentheses) · 🟡 partly · ❌ not automated. "smoke-api/ws" = `tools/smoke-*.mjs`. Expected behaviour is what the code does today and was verified unless marked *(code reading)*.

## A. Authentication & identity
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| A1 | Register | Email valid, name ≥ 2, password ≥ 6; unknown fields rejected (400). Duplicate email → 409 "Email already in use". Success returns a token and the UI logs in immediately and redirects. | ✅ smoke-api, 01-auth |
| A2 | Login | Wrong password / unknown email → 401 "Invalid credentials" (same message for both). Success → 201 + token; UI redirects to `?redirect=` or `/`. | ✅ smoke-api, 01-auth |
| A3 | Guest login | Name ≥ 2 → guest token (`guest_<uuid>`); UI stores `guestName`. | ✅ smoke-api, 01-auth, 02-home |
| A4 | Password UX | Live strength hint (register mode), show/hide toggle, native `minLength=6` blocks the request. | ✅ 01-auth |
| A5 | Session persistence | Token in `localStorage`; visiting `/login` while signed in redirects home. | ✅ 01-auth |
| A6 | Auto sign-out on 401 | Home page clears a rejected token. | ✅ 01-auth |
| A7 | Logout | Confirmation dialog (cancel keeps session). Guests see "Exit Guest". | ✅ 01-auth |
| A8 | Profile | `GET /users/me` → `{id,email,name,avatarUrl,createdAt}` (no hash). | ✅ smoke-api |
| A9 | Token expiry | JWT lifetime `JWT_EXPIRES_IN` (1d). Behaviour when a token expires mid-meeting is untested. | ❌ |

## B. Home page
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| B1 | Wake-on-open | Every page load pings `/health`; banner after 2 s of failure; retries every 3 s; disappears when `db: "up"`. Works on `/`, `/login`, `/meeting/<id>`. | ✅ 02-home |
| B2 | Server status chip | "Connecting… / System Online / System Offline" from a single `GET /` on the home page (never refreshes). | 🟡 02-home |
| B3 | Create meeting form | Title, duration (default 60), max participants (2–10 in UI). >10 or <2 → inline error, no request. Min 2 s loading animation then navigates to `/meeting/<uuid>`. | ✅ 02-home |
| B4 | Join by code | Calls `/meetings/code/<code>`; on success navigates to the UUID, otherwise navigates to `/meeting/<typed text>`. Button disabled when empty; Enter submits. | ✅ 02-home (valid code) |
| B5 | Guest join panel | Needs name ≥ 2 and a code; upper-cases the code; creates a guest token and goes to `/meeting/<CODE>`. | ✅ 02-home |
| B6 | Guests cannot create meetings in the UI | Button looks disabled; click does nothing. | ✅ 02-home |
| B7 | "Active Meeting" shortcut | If the user hosts a `LIVE` meeting, "New meeting" becomes "Active Meeting" and re-enters it. | ❌ |
| B8 | Unauthenticated deep link | `/meeting/<id>` without a token → `/login?redirect=/meeting/<id>`. | ✅ 02-home |

## C. Meeting room — presence & layout
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| C1 | Join via UUID or room code | Code is resolved through `/meetings/code/<code>` then the URL is replaced with the UUID. | ✅ 02/03 |
| C2 | Joining screen | Full-screen loader until meeting info is loaded (+0.8 s). | ✅ helper waits for it |
| C3 | Participant tiles | One tile per participant; own tile "You"; avatar initial when video off; speaking highlight (blue border) from audio level; hand icon when raised. | ✅ 03 |
| C4 | Participant count badge | Number of tiles (incl. you) on the people button. | ✅ 03 |
| C5 | People panel | Sorted: host first, then raised hands in queue order; labels `You`, `(Host)`, `(Co-Host)`; `#n` queue badge; search filter by name. | ✅ 03 |
| C6 | Info modal | Meeting title + room code. | ✅ 03 |
| C7 | Connection chip | "Connected / Connecting…" from socket state. | ✅ helper |
| C8 | Local connection stats | RTT, ↓/↑ rates, 4 signal bars, refreshed every 2 s. | ❌ |
| C9 | Screen share layout | Large share area + sidebar of participants; local share uses `screen-video`. | ❌ (needs `getDisplayMedia`) |
| C10 | Capacity | Distinct-user cap on WS join → `meeting:full` + "This meeting is full" screen. | ✅ smoke-ws, 03 |
| C11 | Duplicate tab | Same user in a second tab → older tab gets `error` and is disconnected (UI shows nothing special). | 🟡 smoke-ws |
| C12 | Mobile layout | Top bar (info, leave), kebab menu, inline chat/people/agenda/polls buttons. | ❌ |

## D. Media
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| D1 | Mic toggle | `getUserMedia` on first enable; button state `data-enabled`; others see the muted badge appear/disappear. Server state persisted for registered users. | ✅ 03 |
| D2 | Camera toggle | Same; remote peers receive real video frames (`videoWidth > 0`). | ✅ 03 |
| D3 | Peer connections | Perfect-negotiation per peer (polite = lexicographically smaller socket id); ICE candidates queued until the remote description exists; renegotiation when tracks change. | 🟡 via D2 |
| D4 | ICE servers | Fetched from `GET /webrtc/ice-servers` right after the socket connects; STUN fallback if the call fails; TURN credentials (24 h) when configured. | ✅ smoke-api (shape) |
| D5 | Bitrate caps | Video 1200/600/300 kbps by mesh size; 24 fps; audio 32 kbps + DTX. | ❌ (inspect `RTCRtpSender.getParameters`) |
| D6 | Data saver | Stops receiving remote video; avatars shown instead; button `data-active`. | 🟡 03 (toggle only) |
| D7 | Device settings | Lists microphones/cameras; Apply re-acquires tracks and replaces senders. | 🟡 03 (list + cancel) |
| D8 | Screen sharing | Starts a second video stream; remote renders it in the large area; stop restores layout. Only one sharer at a time (a second attempt shows a browser `alert()`: "Someone else is presenting…"). | ❌ |
| D9 | Autoplay overlay | "Ready to Join?" appears if the browser blocks autoplay. | ❌ |
| D10 | Voice-activity | Local audio analyser (threshold 15) emits `media:speaking`; others highlight the tile. | ❌ |
| D11 | Join sounds | Web Audio beeps on self-join / join / leave. | ❌ |

## E. Collaboration
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| E1 | Chat | Broadcast to the room. Registered users' messages are persisted and delivered as `chat:history` to later joiners; **guest messages are broadcast only** (not stored). Blank messages not sent. | ✅ 03, smoke-ws |
| E2 | Hand raise / speaking queue | `hand:toggle`; queue sorted by raise time; shown on the tile, in the people list (`#n`), and via `queue:updated`. Host/co-host can `queue:reorder` (no UI for this). | ✅ 03, smoke-ws |
| E3 | Reactions | One button (❤️). Server stores each reaction and broadcasts aggregated counts; shown in a small popover. Counts accumulate for the meeting's life. | ✅ 03, smoke-ws |
| E4 | Agenda | Host/co-host create items (title, seconds) once; everyone sees the list; host/co-host start an item → `agenda:active`, highlighted item + "Current Item" card. | ✅ 04, smoke-ws |
| E5 | Polls | Host/co-host create (question + options); any **registered** participant can vote; one vote per user per poll; results as percentages. | ✅ 04, smoke-ws |

## F. Host & co-host controls
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| F1 | Kick | Host/co-host kick non-hosts; target gets `meeting:kicked` ("removed" screen, no countdown); room gets `participant:left`. Host cannot be kicked. | ✅ 03, smoke-ws (registered users) |
| F2 | Force-mute | Target's mic is switched off and the room sees `media:updated`. | ✅ 03, smoke-ws (registered users) |
| F3 | Ask to unmute | Target gets a browser `confirm()`; accepting enables the mic. | ✅ 03 |
| F4 | Co-host promote/demote | Host only; `participant:role-updated`; co-host gains agenda/poll/kick/mute rights (not over the host). | ✅ 03, smoke-ws |
| F5 | End meeting | Host only; everyone gets `meeting:ended`; meeting deleted. | ✅ 03, smoke-ws |
| F6 | Leave | "Leave Meeting" navigates home (socket closes). | ✅ 03 |
| F7 | Expiry | After `startedAt + duration` the sweep ends the meeting; clients see "The meeting time has ended". | ❌ (use `duration: 1` and wait ≤ 90 s) |
| F8 | Auto-end when empty | Last disconnect deletes the meeting. | 🟡 observed during smoke-ws design |

## G. Platform / non-functional
| ID | Feature | Expected behaviour | Auto |
|---|---|---|---|
| G1 | Health & build id | `/health` always 200 once up; `db` up/down; `commit`, `uptimeSeconds`. DB outage → `db:"down"` quickly, recovers by itself. | ✅ smoke-api |
| G2 | CORS | Only origins in `FRONTEND_ORIGIN` get `Access-Control-Allow-Origin` (REST and Socket.io). Live allows only `https://beecollab.vercel.app`. | 🟡 manual curl |
| G3 | Response envelope | Every REST response `{success,data,message,timestamp,path}`; errors `{success:false,error,statusCode,timestamp,path}`. | ✅ smoke-api |
| G4 | Validation | Global whitelist + forbid unknown properties + type transform. | ✅ smoke-api |
| G5 | Swagger | `/api/docs`, `/api/docs-json`. QA endpoints are hidden. | ✅ smoke-api |
| G6 | QA cleanup | Disabled by default (404); 401 on bad token; deletes only `@qa.beecollab.test` data. | ✅ Jest + manual (backend) |
| G7 | Resilience | DB paused/restarted, backend restart mid-meeting, Render cold start, network loss. | ❌ |
