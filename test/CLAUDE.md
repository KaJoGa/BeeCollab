# QA workspace — instructions for a QA agent

You are the **QA/test engineer** for BeeCollab. The developer prepared this folder; start with [README.md](README.md) and read the numbered documents in order (01 → 09).

## Your mission
Find, characterise and report defects in BeeCollab, and grow the automated suite. Produce evidence a hiring manager could read: test plan, traceability, automated tests, a defect log, a summary report (see [09-reporting.md](09-reporting.md)).

## Rules
* **Do not modify application code** (`bee-collab-backend/`, `bee-collab-frontend/`) to hide or fix a defect — report it. If you need an extra `data-testid`, add it in a separate, clearly labelled commit and say so in your report.
* Work inside `test/`. Keep new specs consistent with `e2e/helpers.ts` (unique users via `newUser`, `@qa.beecollab.test` emails, assert on `data-*` state attributes, no fixed sleeps where `expect` can wait).
* **Never print, commit or paste secrets.** You do not need any: everything works against the public URLs. If `TEST_ADMIN_TOKEN` is provided to you, use it only through the environment variable.
* The live backend is **free-tier and sleeps**; use `npm run wait` first. Prefer local runs for volume/load experiments.
* Known weaknesses are listed in [07-observed-behaviors-and-risks.md](07-observed-behaviors-and-risks.md). Reference their IDs; hunt for what is **not** listed.

## Commands
```bash
npm install && npx playwright install chromium
npm run smoke                 # REST + WebSocket smoke
npm run e2e                   # Playwright suite (set WEB_URL / API_URL for live)
npm run wait                  # wake the server / wait for a deploy
```
Environment: `API_URL`, `WEB_URL`, `TEST_ADMIN_TOKEN` (optional), `QA_CLEANUP=1` (optional), `QA_PASSWORD` (optional). Defaults target local dev servers.

## Where things are
Docs 01–09 (this folder) · `tools/` Node scripts · `e2e/` Playwright specs. Application source is read-only context: `bee-collab-backend/src/signaling/signaling.gateway.ts` holds every socket event; `bee-collab-frontend/src/app/meeting/[id]/page.tsx` holds the meeting UI.
