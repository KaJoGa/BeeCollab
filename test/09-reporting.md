# 09 — Reporting

## Before you file
1. Reproduce **twice**; on the live site first note `GET /health` → `commit` and `uptimeSeconds` (a restart in between invalidates a run).
2. Check [07](07-observed-behaviors-and-risks.md): if it is listed, reference the ID (e.g. "extends R-06") and add what is new (new impact, new reproduction, a worse variant).
3. Decide the scope: **API**, **WebSocket**, **UI**, **WebRTC/media**, **ops/infra**, or **docs**.

## Report template
```markdown
### <short, specific title>
- **ID:** BC-<n>            **Related:** R-xx (if any)
- **Area / component:** e.g. WebSocket › meeting:kick
- **Environment:** local | live   **Backend commit:** <7 chars from /health>   **Frontend:** <vercel URL or local>
- **Browser/OS:** Chromium 1xx / Windows 11   **Accounts used:** registered / guest / host / co-host
- **Severity:** S1–S4 (see below)   **Likelihood:** always | often | sometimes | once

**Preconditions**
1. …

**Steps to reproduce**
1. …
2. …

**Expected result**
…

**Actual result**
…

**Evidence**
- Playwright trace / screenshot / HAR / curl transcript / socket event log (attach files; redact tokens)
- Backend log line (Render logs or local console), if relevant

**Notes / suspected cause / workaround**
…
```

## Severity scale
| Level | Meaning | Example from this project |
|---|---|---|
| **S1 Critical** | Data loss/exposure, security hole, app unusable for everyone | Any logged-in user reads another meeting's chat (R-04) |
| **S2 Major** | Core feature broken for a common scenario, no workaround | Host cannot mute/kick guests (R-06/R-07) |
| **S3 Minor** | Feature degraded, workaround exists, cosmetic-but-confusing | Own chat messages shown as someone else's (R-24) |
| **S4 Trivial** | Cosmetic, wording, polish | Hard-coded progress bar (R-26) |

Also tag **type**: Functional · Security · Usability · Accessibility · Performance · Reliability · Compatibility · Documentation.

## Good evidence for this app
* **UI:** `npx playwright test <file> --trace on` then attach `trace.zip` (it contains the DOM, network and console of every step).
* **WebSocket:** paste the ordered event list from a `socket.io-client` script (see `tools/smoke-ws.mjs`; `DEBUG_WS=1` prints each socket's events).
* **REST:** the exact `curl` (with `-i`) and the full response envelope.
* **Backend log:** local console, or Render → Logs. `HealthController` logs `DB check failed: <reason>`; Prisma errors appear as `PrismaClientKnownRequestError` with a code (P2025 = record not found, P2003 = foreign key).
* **WebRTC:** `RTCPeerConnection.getStats()` output (selected candidate pair, inbound/outbound bytes), or `chrome://webrtc-internals` dump.

## Suggested deliverables (portfolio)
1. **Test plan & strategy** (scope, risks, levels, environments) — reuse [06](06-test-ideas.md).
2. **Requirements-to-test traceability** — map [03](03-feature-inventory.md) feature IDs to automated/manual cases.
3. **Automated suite** — extend `test/` (API matrices, reconnect, expiry, mobile, screen share, TURN-forced); keep it green on local and live.
4. **Defect log** — every finding in the template above, linked to the risk IDs.
5. **Summary report** — coverage achieved, defects by severity/area, residual risk, recommendations.

## Keep this workspace tidy
* Do not edit the application code to hide a defect; report it. If a test needs an extra `data-testid`, ask the developer or add it in a separate, clearly labelled commit.
* Keep tokens/secrets out of reports and commits.
* If you add specs, follow the existing conventions: one user per `newUser`, `@qa.beecollab.test` emails, assertions on `data-*` state attributes, no fixed sleeps where an `expect` can wait.
