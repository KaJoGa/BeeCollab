# 04 — REST API reference

Base URL: `https://beecollab-rwbj.onrender.com` (local: `http://localhost:3000`). Interactive docs: `/api/docs`.
Auth: `Authorization: Bearer <JWT>` where noted. **Every status code below was observed** against the running service unless marked *(code)*.

## Conventions
* Success: `{ "success": true, "data": <payload>, "message": "Success", "timestamp": "<ISO>", "path": "<url>" }` — `POST` creates return **201**, `DELETE` returns 200.
* Error: `{ "success": false, "error": "<message>", "statusCode": <n>, "timestamp": "...", "path": "..." }`. Validation errors join all messages into one comma-separated `error` string.
* Global validation: `whitelist` + `forbidNonWhitelisted` (unknown fields → **400** "property x should not exist") + `transform`.
* The JWT guard accepts **guest tokens** as well; a guest is represented as `{ id: "guest_<uuid>", name, isGuest: true }`.
* 401 for a missing, malformed or tampered token (body `error: "Unauthorized"`); an *expired* token should behave the same *(code; not exercised)*.

## Health & meta
| Method & path | Auth | Result |
|---|---|---|
| `GET /` | no | 200, `data: "Hello World!"` |
| `GET /health` | no | 200 always (once up): `{ status:"ok", db:"up"\|"down", commit, uptimeSeconds }`. Waits ≤ 8 s for `SELECT 1`; `db:"down"` + log line `DB check failed: …` when the query fails. |
| `GET /api/docs`, `/api/docs-json` | no | Swagger UI / OpenAPI JSON (not wrapped in the envelope) |

## Auth
| Method & path | Body | Results |
|---|---|---|
| `POST /auth/register` | `{ email (valid), name (≥2), password (≥6), avatarUrl? (URL) }` | **201** `{ access_token }` · 400 validation · **409** `Email already in use` |
| `POST /auth/login` | `{ email, password }` | **201** `{ access_token }` · **401** `Invalid credentials` (unknown email and wrong password are indistinguishable) |
| `POST /auth/guest` | `{ name (≥2) }` | **201** `{ access_token }` (JWT `sub: guest_<uuid>`, `isGuest:true`; no DB row) · 400 |

Note: login returns **201**, not 200.

## Users
| Method & path | Auth | Results |
|---|---|---|
| `GET /users/me` | yes | 200 `{ id, email, name, avatarUrl, createdAt }` · 401 · **404 `User not found` for a guest token** (no DB row) |

## Meetings
| Method & path | Auth | Body / params | Results |
|---|---|---|---|
| `POST /meetings` | yes | `{ title (≥3), maxParticipants? (int 2–500), duration? (int 1–1440) }` | **201** meeting incl. `participants:[{role:"HOST",user:{id,name,avatarUrl}}]`, `status:"SCHEDULED"`, `roomCode` (8 uppercase hex). Defaults **maxParticipants 10, duration 15**. 400 on any violation (incl. non-integer). **500 for a guest token** (see risks R-01). |
| `GET /meetings` | yes | – | 200 array of meetings hosted by the caller (no host/participants) |
| `GET /meetings/code/:roomCode` | yes (guest ok) | **case-sensitive** | 200 meeting + `host` + `participants` · 404 `Meeting not found` (also for lowercase) |
| `GET /meetings/:meetingId` | yes (guest ok) | any string | 200 meeting + `host{id,name,avatarUrl}` + `participants[]` · 404 for unknown **and** non-UUID ids |
| `POST /meetings/:meetingId/join` | yes | `{ roomCode (string) }` | **201** `{ meeting, participant }` · **403** `Invalid room code` · **400** missing `roomCode` · **400** `Meeting is full` / `Meeting has ended` *(code; not exercised — the cap is really enforced at the WebSocket join)* · 404 · **500 for a guest token** (R-02). It upserts a `Participant` row; the real entry point is the WebSocket join. |
| `GET /meetings/:meetingId/participants` | yes | – | 200 active participants (`leftAt = null`) with `user` · 404 |
| `GET /meetings/:meetingId/chat` | yes | – | 200 array of stored messages `{id,meetingId,senderId,message,type,createdAt,sender{id,name,avatarUrl}}` (guest messages never appear) |
| `DELETE /meetings/:meetingId` | yes | – | 200 deleted meeting · **403** `Only the host can end the meeting` · 404 (also on a second delete) |

Authorization observations (R-03/R-04): any authenticated user — including a guest — can `GET` the details, participants and **chat history** of **any** meeting by id, and the response contains the room code.

## WebRTC
| Method & path | Auth | Results |
|---|---|---|
| `GET /webrtc/ice-servers` | yes (guest ok) | 200 `{ iceServers:[…] }`. Always at least `stun:` entries. When Cloudflare is configured the list also contains `turn:`/`turns:` entries with `username` + `credential` (valid 24 h; cached ~12 h server-side). On Cloudflare failure it falls back to STUN only. |

## QA support (hidden from Swagger; disabled by default)
| Method & path | Header | Results |
|---|---|---|
| `GET /test-support/status` | `x-test-token` | 200 `{ enabled, testEmailSuffix, testUsers, testMeetings }` |
| `POST /test-support/cleanup` | `x-test-token` | 200 `{ deleted:{ users, meetings, participants, chatMessages, pollResponses } }` |
| (either) | missing/wrong token | **401** `Invalid test token` |
| (either) | feature disabled or token < 16 chars configured | **404** `Cannot GET /test-support/status` (identical to an unknown route) |

## Ideas that follow from this table
* Boundary values: `maxParticipants` 1/2/500/501/`"5"`/`null`; `duration` 0/1/1440/1441/1.5; titles of 2/3 chars and very long strings; unicode/emoji/HTML in `title`, `name`, chat.
* Authorization matrix: {anonymous, registered non-member, member, host, guest} × every endpoint.
* Idempotency: join twice, delete twice (second → 404), register twice.
* Token handling: expired token (`JWT_EXPIRES_IN=5s` locally), token signed with another secret, `alg: none`, token of a deleted user.
* Envelope consistency: every error path returns the envelope (also 404 on unknown routes, 401, 400, 500).
* Concurrency: two simultaneous joins at capacity; concurrent register with the same email.
