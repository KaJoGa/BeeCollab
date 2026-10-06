-- STATUS: UNTESTED. This script mirrors the logic of the backend's /test-support/cleanup, which IS
-- tested (unit tests + an integration run against Postgres), but the SQL itself was never executed
-- against a database. It runs in one transaction, so a syntax/FK error aborts without changing data,
-- but try it first on a local database (docker compose) and review the row counts before using it
-- on Neon.
--
-- Deletes everything that belongs to QA accounts (email ending in @qa.beecollab.test).
-- Equivalent to POST /test-support/cleanup, for use in a SQL console (e.g. Neon's SQL Editor)
-- when that endpoint is disabled. Foreign-key-safe order, one transaction.
-- Run it while no test is executing. Real users/meetings are not touched.
--
--   psql "$DIRECT_URL" -f test/tools/cleanup.sql
BEGIN;

CREATE TEMP TABLE qa_users ON COMMIT DROP AS
  SELECT id FROM "User" WHERE email LIKE '%@qa.beecollab.test';

CREATE TEMP TABLE qa_meetings ON COMMIT DROP AS
  SELECT id FROM "Meeting" WHERE "hostId" IN (SELECT id FROM qa_users);

DELETE FROM "PollResponse"
 WHERE "userId" IN (SELECT id FROM qa_users)
    OR "pollId" IN (SELECT id FROM "Poll" WHERE "meetingId" IN (SELECT id FROM qa_meetings));

DELETE FROM "ChatMessage"
 WHERE "senderId" IN (SELECT id FROM qa_users)
    OR "meetingId" IN (SELECT id FROM qa_meetings);

DELETE FROM "Participant"
 WHERE "userId" IN (SELECT id FROM qa_users)
    OR "meetingId" IN (SELECT id FROM qa_meetings);

-- cascades to Agenda, Poll (+PollOption, PollResponse) and Reaction
DELETE FROM "Meeting" WHERE id IN (SELECT id FROM qa_meetings);

DELETE FROM "User" WHERE id IN (SELECT id FROM qa_users);

COMMIT;
