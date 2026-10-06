# 08 — Selectors, test data and automation gotchas

## `data-testid` conventions
* kebab-case, prefixed by area (`auth-`, `home-`, `new-meeting-`, `guest-`, `ctrl-`, `tile-`, `chat-`, `agenda-`, `poll-`, `participant-`, `device-`, `meeting-ended-`).
* **State is exposed as attributes** so tests need no CSS/colour inspection: `data-enabled`, `data-active`, `data-connected`, `data-status`, `data-end-type`, `data-tab`, `data-name`, `data-local`, `data-me`, `data-sender`.
* The desktop and mobile layouts both exist in the DOM; mobile-only duplicates are prefixed `mobile-` or `ctrl-mobile-` so each id is unique per layout. (Tile/video ids repeat across **mutually exclusive** layouts — grid vs screen-share — never in the same DOM at once.)

Playwright: `page.getByTestId('ctrl-mic')`. Helpers live in `e2e/helpers.ts`.

## Catalogue

### Global
| Id | Element |
|---|---|
| `wake-server-banner` | "Waking up the server…" banner (only while waking) |

### Login (`/login`)
`auth-title` (h1: "Sign In"/"Create Account") · `auth-error` · `auth-name-input` (register mode only) · `auth-email-input` · `auth-password-input` · `auth-toggle-password` · `auth-password-hint` (register mode) · `auth-submit` · `auth-switch-to-register` · `auth-switch-to-login` · `auth-back-home` · `auth-guest-name-input` · `auth-guest-submit` · `auth-guest-error`

### Home (`/`)
`home-signin-btn` · `home-user-name` · `home-logout-btn` ("Logout" / "Exit Guest") · `logout-confirm-dialog` · `logout-cancel` · `logout-confirm` · `server-status` (`data-status` = checking/online/offline) · `new-meeting-btn` · `new-meeting-title` · `new-meeting-duration` · `new-meeting-max-participants` · `new-meeting-error` · `new-meeting-cancel` · `new-meeting-submit` · `join-code-input` · `join-btn` · `guest-join-open` · `guest-name-input` · `guest-code-input` · `guest-join-error` · `guest-join-cancel` · `guest-join-submit`

### Meeting room (`/meeting/<id|code>`)
| Group | Ids |
|---|---|
| Loading / overlays | `joining-screen` · `autoplay-overlay` · `autoplay-enable-btn` · `enable-media-btn` |
| End screens | `meeting-ended-overlay` (`data-end-type` = `ended`/`kicked`/`expired`/`full`) · `meeting-ended-title` · `meeting-ended-home` · `meeting-ended-rejoin` (kicked only) |
| Tiles | `video-tile` (`data-name`, `data-local`) · `tile-video` · `tile-name` · `tile-hand` · `tile-muted` · `conn-stats` (local tile) · `screen-share-tile` (`data-name`) · `screen-video` |
| Bottom bar controls | `connection-status` (`data-connected`) · `ctrl-mic` / `ctrl-camera` (`data-enabled`) · `ctrl-data-saver` / `ctrl-hand` / `ctrl-screen-share` (`data-active`) · `ctrl-reaction` · `reaction-summary` · `ctrl-more` → `more-settings`, `more-screen-share` (mobile) · `ctrl-info` · `ctrl-tab-agenda` / `-polls` / `-people` / `-chat` · `participant-count` · `ctrl-leave` → `leave-end-meeting` (host), `leave-leave-meeting` |
| Mobile-only | `mobile-info-btn` · `mobile-leave-btn` → `mobile-end-meeting`, `mobile-leave-meeting` · `ctrl-mobile-agenda` / `-polls` / `-chat` / `-people` · `mobile-participant-count` |
| Sidebar | `sidebar` (`data-tab`) · `sidebar-title` · `sidebar-close` |
| Chat | `chat-messages` · `chat-message` (`data-sender`) · `chat-message-text` · `chat-input` · `chat-send` |
| People | `people-search` · `participant-row` (`data-name`, `data-me`) · `participant-actions-btn` → `participant-kick`, `participant-mute`, `participant-ask-unmute`, `participant-make-cohost`, `participant-remove-cohost` |
| Agenda | `agenda-title-input` · `agenda-duration-input` · `agenda-add-item` · `agenda-save` · `agenda-item` (`data-active`) · `agenda-start` · `agenda-current` |
| Polls | `poll-question-input` · `poll-option-input` · `poll-add-option` · `poll-launch` · `poll-card` · `poll-option` · `poll-total-votes` |
| Info / device modals | `info-modal` · `info-meeting-title` · `info-room-code` · `info-close` · `device-settings-modal` · `device-audio-select` · `device-video-select` · `device-cancel` · `device-apply` · `device-close` |

Not yet instrumented (use roles/text): mobile connection dot, countdown number on the end screen, reaction counts inside `reaction-summary` (read its text), the agenda duration text.

## Helpers (`e2e/helpers.ts`)
| Helper | Purpose |
|---|---|
| `newUser(label)` | register a unique `@qa.beecollab.test` user through the API → `{ email, name, token }` (name = `QA <label>`) |
| `newMeeting(user, overrides)` | create a meeting through the API |
| `signIn(page, token, guestName?)` / `signInAsGuest(page, name)` | put a session into `localStorage` (what the app does after login) |
| `openMeeting(page, idOrCode)` | goto, wait for the socket and for the joining screen to go away |
| `localTile(page)` / `tile(page, name)` | own tile (labelled "You") / a remote tile by display name |
| `openTab(page, 'chat'|'people'|'agenda'|'polls')` | open a sidebar tab |
| `participantCount(page)` | the badge on the people button |
| `tools/config.mjs` | `api()`, `register()`, `login()`, `guestToken()`, `createMeeting()`, `uniqueEmail()`, reporters |

## Accounts and data
| Account | Created by | Password |
|---|---|---|
| `alice@`, `bob@`, `carol@qa.beecollab.test` | `npm run seed` | `QaPassw0rd!` (`QA_PASSWORD` overrides) |
| `<label>-<ts>-<rand>@qa.beecollab.test` | `uniqueEmail()` in helpers | same |
| guests | `POST /auth/guest` | none |

Meeting data created by tests is disposable; users persist until cleanup (see [02](02-environments-and-access.md)).

## Fake media (Chromium)
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required` + context permissions `camera`, `microphone`. The fake camera draws a moving test pattern with a beep; `videoWidth > 0` on a `<video>` proves frames are arriving. `browser.newContext()` does **not** inherit `use` options in Playwright Test — the specs pass `baseURL`, permissions and viewport explicitly.

## Automation gotchas (all met while writing the suite)
1. **Own tile is "You"** — `tile(page, ownName)` finds nothing; use `localTile`.
2. **`socket.id` is `undefined` after disconnect** (socket.io-client) — copy it before the socket closes if you need it later.
3. **A meeting dies with its last socket.** Keep one socket (or page) open for the whole test, or you will chase 404s.
4. **Joining screen** covers the page for ~1 s after the socket connects; wait for it to disappear (`openMeeting` does) before clicking.
5. **Native dialogs**: "Ask to unmute" uses `window.confirm`; register `page.on('dialog', d => d.accept())` *before* triggering it. Screen-share conflicts use `alert`.
6. **Strict-mode violations**: asserting a testid that exists in both desktop and mobile layouts would match two elements — that is why mobile ids are prefixed.
7. **Cold start**: on live, the first call can take ~1 min; `global-setup` waits for `/health` (up to 3 min).
8. **Participant order/labels** in the people list depend on the host id and raised hands; assert by `data-name`, not by index.
9. **Guests and host tools**: kick, force-mute, co-host and poll voting do not work for guests (R-05…R-07). Use a registered second user in positive tests.
10. **End-screen countdown** (30 s) navigates home by itself; tests that wait on the overlay should assert quickly or click "Return to home screen".
11. **CRLF**: several frontend files use CRLF line endings on Windows checkouts; irrelevant to tests but visible in diffs.
