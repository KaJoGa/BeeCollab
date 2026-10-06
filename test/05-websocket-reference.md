# 05 — WebSocket (Socket.io) reference

* URL: `wss://beecollab-rwbj.onrender.com/meetings` (namespace **`/meetings`**; local `ws://localhost:3000/meetings`). The frontend uses `transports: ['websocket']` only.
* Handshake auth: `io(url, { auth: { token: "<JWT>" } })` (an `Authorization: Bearer` header also works).
* Library: `socket.io-client` 4.x (already in `test/package.json`). A reference client is `tools/smoke-ws.mjs`.
* A socket's `id` (`socket.id`) is the address other clients use for WebRTC signaling and for kick/mute targets. **Client-side `socket.id` becomes `undefined` after disconnect — copy it first.**
* All room events go to the Socket.io room named by the **meeting UUID**.

## Connection rules (verified)
* No token in the handshake → server emits `error {message:"No token provided"}` and disconnects.
* A token that is present but **invalid** is *not* rejected at connect time: the socket stays connected; every guarded event then fails with an `exception` event. Unguarded events still work (see R-08).
* `meeting:join` is guarded and puts the verified payload on `socket.data.user`.
* The `error` event (`{message}`) is used for business-rule rejections; `exception` (`{status:"error", message}`) for thrown errors (e.g. Prisma failures).

## Client → server
Guarded = requires a valid JWT. "Host" = the meeting's `hostId`; "H/CH" = host **or** a participant with role `CO_HOST`/`HOST`.

| Event | Payload | Guard / permission | Effect |
|---|---|---|---|
| `meeting:join` | `{ meetingId, audioEnabled?, videoEnabled? }` | guarded; any authenticated user (**no room-code or membership check**) | Closes older sockets of the same user in that meeting; enforces capacity; registered users upsert a `Participant`; meeting → `LIVE`; replies `meeting:state`, `chat:history`, `agenda:list`, `poll:list` to the sender and `participant:joined` to the others |
| `webrtc:offer` / `webrtc:answer` | `{ to, from, sdp }` | guarded | Relayed to socket id `to` only (sender room membership not checked) |
| `webrtc:ice-candidate` | `{ to, from, candidate }` | guarded | Relayed to `to` |
| `media:toggle` | `{ meetingId, type:"audio"\|"video", enabled }` | guarded | Persists for registered users; broadcasts `media:updated`; emits internal event `participant.media_changed` |
| `media:speaking` | `{ meetingId, speaking }` | **not guarded** | Broadcast to the room as `media:speaking {socketId, speaking}` (excluding sender) |
| `chat:message` | `{ meetingId, message }` | guarded | Registered: stored + broadcast `chat:message`. Guest: broadcast only (synthetic message, random id). No length limit/sanitisation server-side |
| `hand:toggle` | `{ meetingId, raised }` | guarded | Registered: `Participant.handRaisedAt`; guest: kept on the socket. Broadcasts `queue:updated` |
| `queue:reorder` | `{ meetingId, orderedUserIds[] }` | H/CH | Rewrites raise times, broadcasts `queue:updated` (no UI) |
| `agenda:create` | `{ meetingId, items:[{title,duration}] }` | H/CH (silently ignored otherwise) | Appends items, broadcasts `agenda:list` |
| `agenda:start` | `{ meetingId, agendaId }` | H/CH (silent) | Activates one item, broadcasts `agenda:active` |
| `poll:create` | `{ meetingId, question, options[] }` | H/CH (silent) | Broadcasts `poll:created` |
| `poll:vote` | `{ meetingId, pollId, optionId }` | guarded; **any** authenticated user | Upserts the caller's vote, broadcasts `poll:updated` (all polls). Guest ids violate a foreign key (R-05); unknown ids raise `exception` |
| `reaction:send` | `{ meetingId, type, anonymous }` | guarded | Stores, broadcasts `reaction:aggregated` |
| `meeting:kick` | `{ meetingId, targetSocketId }` | H/CH; target must have a `Participant` row; host cannot be kicked | Target gets `meeting:kicked`, room gets `participant:left`, target socket closed. Else `error` ("Only host/co-host…", "Participant not found", "Host cannot be kicked") |
| `media:force-mute` | `{ meetingId, targetSocketId }` | H/CH | Target gets `media:force-mute`; room gets `media:updated` |
| `media:ask-unmute` | `{ meetingId, targetSocketId }` | H/CH | Target gets `media:ask-unmute` |
| `meeting:make-cohost` / `meeting:remove-cohost` | `{ meetingId, targetUserId }` | **Host only** | Role change; broadcasts `participant:role-updated` |
| `meeting:end` | `{ meetingId }` | host only (else `error "Unauthorized or meeting not found"`) | Deletes the meeting (participants, chat, row), broadcasts `meeting:ended` |

## Server → client
| Event | Payload |
|---|---|
| `meeting:state` | `{ meetingId, participants:[{ socketId, userId, user:{id,name,avatarUrl}, role, audioEnabled, videoEnabled }] }` (all sockets currently in the room) |
| `participant:joined` | `{ socketId, userId, user, role, audioEnabled, videoEnabled }` |
| `participant:left` | `{ socketId, userId, user }` (also after a kick or a disconnect) |
| `participant:role-updated` | `{ userId, role }` |
| `chat:history` | array of messages |
| `chat:message` | `{ id, meetingId, senderId, message, type:"TEXT", createdAt, sender:{id,name,avatarUrl} }` |
| `queue:updated` | `[{ userId, user, handRaisedAt }]` sorted by `handRaisedAt` |
| `media:updated` | `{ socketId, userId, user, type, enabled }` |
| `media:speaking` | `{ socketId, speaking }` |
| `media:force-mute` / `media:ask-unmute` | `{ meetingId }` (to the target only) |
| `webrtc:offer` / `answer` / `ice-candidate` | the same payload the sender emitted |
| `agenda:list` | `[{ id, meetingId, title, duration[s], order, startTime, endTime, isActive }]` |
| `agenda:active` | the activated item |
| `poll:list` / `poll:updated` | `[{ id, meetingId, question, isActive, createdAt, options:[{id,pollId,text,responses:[{…}]}] }]` |
| `poll:created` | one poll |
| `reaction:aggregated` | `[{ type, count }]` |
| `meeting:ended` | `{ meetingId, reason? }` — `reason` set by the expiry sweep ("Pertemuan berakhir karena durasi habis.") and by auto-end ("All participants have left") |
| `meeting:kicked` | `{ reason:"Removed by host" }` |
| `meeting:full` | `{ message }` (then the server disconnects the socket) |
| `error` | `{ message }` |
| `exception` | `{ status:"error", message }` |

## Disconnect behaviour
* Registered user: `Participant.socketId` is nulled and `leftAt` set; guests leave no DB trace. Both trigger `participant:left` and a `queue:updated` refresh.
* An internal event then checks whether anyone is left (DB participants **and** live sockets); if nobody is, the meeting is deleted and `meeting:ended` ("All participants have left") is emitted to the (empty) room.

## Test ideas specific to the socket layer
* Reconnect: drop the transport mid-meeting (`socket.io.engine.close()`), reconnect, `meeting:join` again — does state recover? The frontend's `connect` handler emits `meeting:join` on **every** (re)connect, but it does not reset its peer connections or participant list first — check for stale tiles, duplicated participants and dead peer connections after a reconnect.
* Ordering/races: `meeting:join` immediately followed by `chat:message`; two users joining simultaneously at capacity−1.
* Payload fuzzing: missing fields, wrong types, huge messages, unknown `meetingId`, `targetSocketId` of a different room.
* Authorization matrix for every row above (guest, registered non-host, co-host, host, outsider with a valid token, socket with an invalid token).
* Cross-room: can a socket in room A act on room B by passing B's id? (See R-08/R-09.)
