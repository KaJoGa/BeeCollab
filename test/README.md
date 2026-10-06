# BeeCollab — QA workspace

You are testing **BeeCollab**, a Google-Meet-style video meeting web app (college project). This folder is written by the developer to give a QA team everything needed to start: how the system works, what can be tested, what is already automated, and where the developer already suspects weak spots.

> The app is a **system under test for a testing portfolio**. Known weaknesses were deliberately **not fixed** — they are the raw material for your findings (see [07-observed-behaviors-and-risks.md](07-observed-behaviors-and-risks.md)). Please do not "fix" application code; report instead.

## Read in this order
| # | File | What it gives you |
|---|---|---|
| 1 | [01-system-overview.md](01-system-overview.md) | Architecture, data model, meeting lifecycle, roles, timing, limits |
| 2 | [02-environments-and-access.md](02-environments-and-access.md) | Live URLs, local setup, accounts, env vars, free-tier caveats, data hygiene |
| 3 | [03-feature-inventory.md](03-feature-inventory.md) | Every feature with expected behaviour and automation status |
| 4 | [04-api-reference.md](04-api-reference.md) | REST endpoints: validation rules and *verified* status codes |
| 5 | [05-websocket-reference.md](05-websocket-reference.md) | Socket.io events, payloads, permissions |
| 6 | [06-test-ideas.md](06-test-ideas.md) | What to test, by level and priority; what is not covered yet |
| 7 | [07-observed-behaviors-and-risks.md](07-observed-behaviors-and-risks.md) | Reproduced oddities and suspected defects, each with evidence |
| 8 | [08-selectors-and-test-data.md](08-selectors-and-test-data.md) | `data-testid` catalogue, accounts, fake-media flags, automation gotchas |
| 9 | [09-reporting.md](09-reporting.md) | Bug report template, severity scale, how to avoid duplicates |

## Quick start
```bash
cd test
npm install
npx playwright install chromium

# local (needs backend on :3000 and frontend on :3001 — see 02-environments-and-access.md)
npm run smoke        # REST + WebSocket smoke (≈90 checks)
npm run e2e          # 64 Playwright tests

# live deployment
export API_URL=https://beecollab-rwbj.onrender.com
export WEB_URL=https://beecollab.vercel.app
npm run wait         # wakes the free-tier backend, waits for DB + (optionally) a commit
npm run smoke
npm run e2e
```
On Windows PowerShell use `$env:API_URL = '...'` instead of `export`.

## What is in this folder
```
test/
├── *.md                      the documents above
├── package.json              scripts + deps (@playwright/test, socket.io-client)
├── playwright.config.ts      chromium + fake camera/mic, env-driven base URL
├── tools/                    zero-dependency Node scripts (ESM)
│   ├── config.mjs            API/WEB URLs, account helpers, REST helper, reporter
│   ├── wait-for-deploy.mjs   wake server; wait for DB up and/or a git commit
│   ├── seed-accounts.mjs     alice/bob/carol@qa.beecollab.test (idempotent)
│   ├── cleanup.mjs           delete all test data (only if the backend enables it)
│   ├── smoke-api.mjs         45 REST checks
│   └── smoke-ws.mjs          41 Socket.io checks
└── e2e/                      Playwright specs (64 tests)
    ├── 00-happy-path         the whole product through the UI, no API shortcuts
    ├── 01-auth               sign-up / sign-in / guest / logout
    ├── 02-home               home page, wake-on-open, create/join flows
    ├── 03-meeting-room       presence, chat, hand, reactions, fake-camera WebRTC, host controls
    ├── 04-agenda-polls       agenda and polls
    ├── helpers.ts            sign-in shortcuts, tile/people helpers
    └── global-setup.ts       wakes the backend before the run
```

## State of the starter suite (when this was written)
| Suite | Local | Live (Vercel + Render + Neon + Cloudflare TURN) |
|---|---|---|
| `smoke-api` | 45/45 | 45/45 |
| `smoke-ws` | 41/41 | 41/41 |
| Playwright E2E | 64/64 | 64/64 |
| Backend Jest (`bee-collab-backend`, `npm test`) | 15 pass (14 new); **6 legacy suites fail** (generated Nest scaffolds with no providers) — pre-existing, unrelated to your work | n/a |

"All green" is the *baseline*, not the goal. These tests assert behaviour that works today; your value is in everything they do **not** cover — see [06-test-ideas.md](06-test-ideas.md) and [07-observed-behaviors-and-risks.md](07-observed-behaviors-and-risks.md).

## Ground rules
1. **Use the `@qa.beecollab.test` email suffix** for every account you create. It is what the cleanup endpoint keys on.
2. **Never commit or paste secrets** (JWT secrets, DB URLs, TURN tokens). You should never need any: everything here works with public URLs.
3. **The live backend is a free-tier host and sleeps** after ~15 min idle (cold start ≈ 1 min). The tools wake it automatically; if you test manually, open `/health` first.
4. **Be gentle with live data**: the database is 1 GB on a free plan. Prefer local runs for load/volume experiments; use live for end-to-end confirmation.
5. Report with the template in [09-reporting.md](09-reporting.md) and check the known-issues list first.
