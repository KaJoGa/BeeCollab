# 06 — Test ideas

How to use this: the starter suite proves the *happy paths* work. Spend your time on the **un-automated** rows (❌) and on the risk list in [07](07-observed-behaviors-and-risks.md). Priorities: **P1** likely to expose real defects or high user impact · **P2** valuable · **P3** nice to have.

## 1. Already automated (do not redo; extend)
| Area | Where | Notes |
|---|---|---|
| REST contract + validation + authz basics | `tools/smoke-api.mjs` (45) | extend with the boundary and authz matrices below |
| Socket.io rooms, chat, hand, media, relay, host controls, agenda, poll, reactions, capacity, duplicate tab, kick, end | `tools/smoke-ws.mjs` (41) | all with registered users + one guest |
| UI auth, home, wake-on-open, meeting presence/chat/hand/reactions/media/host controls, agenda, polls | `e2e/*.spec.ts` (64) | real WebRTC with fake devices |

## 2. API level (P1)
1. **Authorization matrix** — {anonymous, guest, registered non-member, member, host} × every endpoint of [04](04-api-reference.md). Known weak points: R-01…R-04.
2. **Boundary & type fuzzing** — numbers as strings, `null`, arrays/objects where scalars are expected, 10 KB titles, emoji, `<script>`, SQL metacharacters, NUL bytes, leading/trailing spaces in email.
3. **Concurrency** — 20 parallel registers of the same email (expect exactly one 201, rest 409, no 500); parallel joins at capacity; delete while others are joining.
4. **Token handling** — expired, wrong-secret, `alg:none`, token for a deleted user (`/users/me` → 401?), very long header, two `Authorization` headers.
5. **Error envelope consistency** — force every error class and assert the envelope shape and no stack traces/Prisma messages leak (R-10).
6. **Idempotency & state** — create→join→join, delete→delete, end meeting then fetch chat/participants.
7. **Expiry** — create with `duration: 1`, join over WebSocket, wait ≤ 90 s: expect `meeting:ended` with a "durasi" reason and a 404 afterwards. (P1: it is a core, time-based feature.)
8. **Rate limiting / abuse** — there is none today: measure how many registrations/guest tokens/meetings per second the API accepts (local only).

## 3. WebSocket level (P1)
1. **Permission matrix** for every event in [05](05-websocket-reference.md), including the "silently ignored" ones.
2. **Cross-room** — a socket joined to room A emits kick/mute/end/poll/agenda/chat for room B's id (R-08, R-09).
3. **Invalid-token socket** — what can it still do? (R-08)
4. **Malformed payloads** — missing `meetingId`, non-string `message`, huge `message` (MBs), `options` with 1000 entries, negative durations.
5. **Reconnect** — drop the transport, reconnect: does the participant list/queue recover? Are there duplicate participants? Does the host keep the host role?
6. **Capacity races** — N users `meeting:join` simultaneously at capacity−1 (distinct-user count is read-then-act).
7. **Auto-end race** — last user leaves while another joins within milliseconds.
8. **Event ordering** — `meeting:join` and `chat:message` back-to-back.
9. **Guest limits** — which features break for guests (R-05…R-07)?

## 4. UI / E2E (P1–P2)
| Idea | Priority | Hint |
|---|---|---|
| Screen sharing start/stop, two sharers conflict, layout switch | P1 | Chromium flag `--use-fake-ui-for-media-stream` plus `--auto-select-desktop-capture-source="Entire screen"` or a tab-capture flag; otherwise stub `getDisplayMedia` with a canvas stream via `page.addInitScript` |
| Reconnect / flaky network UI | P1 | CDP `Network.emulateNetworkConditions` / `context.setOffline(true)` |
| Meeting expiry screen + 30 s countdown → home | P2 | `duration:1`; `page.clock` can fast-forward the countdown |
| Kicked user can/can't rejoin ("Rejoin" reloads the page) | P2 | |
| Back/forward/refresh inside a meeting; refresh as host | P1 | refresh creates a new socket: the old one is closed as "another tab" |
| Two tabs, same user | P2 | `error` is only logged; UI gives no explanation |
| Mobile viewport (≤ 768 px): mobile top bar, kebab menu, mobile chat/people/agenda/polls buttons | P1 | Playwright `devices['Pixel 7']`; ids are prefixed `mobile-`/`ctrl-mobile-` |
| Device switching (microphone/camera) via Device Settings → Apply | P2 | fake devices expose several entries |
| Autoplay-blocked overlay | P3 | launch without `--autoplay-policy` flag |
| Accessibility: keyboard-only flow, focus order, labels (many icon buttons lack accessible names), colour contrast, `aria-live` on the wake banner | P2 | `@axe-core/playwright` |
| Visual regression of home/login/meeting grid at 1, 2, 3, 4, 6, 9 participants | P2 | grid is computed in JS (`getGridDimensions`) |
| Large chat history, very long unbroken words, emoji, RTL text | P2 | message bubbles use `wordBreak` + `overflowWrap` |
| i18n: mixed English/Indonesian strings (e.g. "durasi habis", "tab lain") | P3 | |
| Browser matrix (Firefox, WebKit) | P2 | add projects to `playwright.config.ts`; WebRTC/fake-device flags differ |
| Create-meeting form: negative/zero/NaN/huge values, empty title (API 400 shows only a generic "Failed to create meeting") | P2 | |

## 5. WebRTC / media (P1)
* **Connectivity matrix**: same machine · same LAN · different networks · behind symmetric NAT (forces TURN). Verify `RTCPeerConnection.getStats()` selected candidate pair type (`host`/`srflx`/`relay`).
* **TURN actually used**: block UDP and non-443 ports (or use `iceTransportPolicy:'relay'` via an init script) and confirm media still flows; check the relay entries in `/webrtc/ice-servers`.
* **Mesh scaling**: 2, 3, 4, 6, 10 participants — CPU, upload (`↑ kbps` badge), bitrate caps (1200/600/300) via `RTCRtpSender.getParameters().encodings[0].maxBitrate`.
* **Renegotiation**: toggle camera/mic/screen rapidly from both sides ("glare"); join/leave storms; the perfect-negotiation code has retry paths.
* **Late joiners** see already-sent streams; **leavers** release their peer connections (leak check: `chrome://webrtc-internals`).
* **Data saver** really stops incoming video (inbound-rtp bytes flatline) while audio continues.
* **Audio**: voice-activity highlight follows the fake microphone's beeps; mute actually silences the outbound track.
* Permissions: camera/mic denied → what does the UI do? (`context.grantPermissions([])`)

## 6. Non-functional
| Topic | Idea |
|---|---|
| **Cold start** | Measure time-to-interactive after ≥ 16 min idle on live; banner timing (appears at 2 s); failure after 3 min? |
| **Always-on during a call** | Keep a 20-min call on live: does Render stay awake (WebSocket traffic keeps it alive) and do sockets survive? |
| **Deploy impact** | Push during an active meeting: what do users see? Recovery after the restart? |
| **Neon pause** | After 5+ min idle the first query is slow: `/health` waits ≤ 8 s; does registration during that window fail? |
| **Load (local only)** | 100 concurrent sockets in 20 rooms; chat flood; join/leave churn; memory growth; the 30 s expiry sweep with many meetings |
| **Security** | Headers (`X-Powered-By`, CSP, HSTS on Vercel/Render), CORS (live allows exactly one origin; verify REST *and* Socket.io), JWT in `localStorage` (XSS impact), brute-force on `/auth/login`, user enumeration (login messages are identical — registration reveals existence via 409), password policy (min 6), no rate limiting, IDOR on meetings/chat (R-03/R-04) |
| **Data** | PII in logs, password hashing (bcrypt, cost 10), what remains in the DB after a meeting ends (users persist; meeting data is deleted) |
| **Compatibility** | Chrome/Edge/Firefox/Safari, iOS Safari quirks (autoplay, getUserMedia), low-end laptops |
| **Observability** | Do failures leave a useful log line? (`/health` logs `DB check failed: …`; many WS errors are only `console.error` in the browser) |

## 7. Backend unit/integration (white-box)
* `bee-collab-backend` Jest (`npm test`): 15 pass (14 new: QA guard/service, TURN service, plus the original `app.controller` spec). **6 generated suites fail on a clean checkout** (`auth.*.spec`, `users.*.spec`, `meetings.*.spec`: "Nest can't resolve dependencies") — decide whether to repair or replace them; they are a fair target for a testing portfolio.
* `bee-collab-backend/test/app.e2e-spec.ts` (supertest, `npm run test:e2e`) passes, but it builds the app from `AppModule` **without** `main.ts`'s global pipes/interceptor/filter, so it sees a bare `Hello World!` while the real server returns the response envelope. It needs a running Postgres. Treat it as a scaffold, not coverage.
* Good unit-test candidates: `MeetingsService` (capacity/room-code rules), `SignalingService` (role checks), `MeetingsCleanupService` (expiry maths), `MeetingEventsListener` (auto-end), `getAllowedOrigins`, `WebrtcService` (already covered).

## 8. Suggested first sprint (≈ 2–3 days)
1. Run both smoke tools and the E2E suite locally and live; confirm green.
2. Build the REST authz matrix and the WebSocket permission matrix (they will surface R-01…R-09 with evidence).
3. Add a mobile-viewport project and port the meeting-room tests; add reconnect and expiry tests.
4. Add screen-share (stubbed `getDisplayMedia`) and a TURN-forced test.
5. Write up findings with [09-reporting.md](09-reporting.md).
