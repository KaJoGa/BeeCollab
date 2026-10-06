// Creates (or verifies) the standard QA accounts: alice/bob/carol@qa.beecollab.test.
// Idempotent: an existing account is simply logged into. Needs no database access, only the API.
import { ACCOUNTS, PASSWORD, emailOf, register } from './config.mjs';

let failed = 0;
for (const { key, name } of ACCOUNTS) {
  const email = emailOf(key);
  try {
    await register(email, name);
    console.log(`OK    ${email}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${email}: ${e.message}`);
  }
}
console.log(`\nPassword for all accounts: ${PASSWORD === 'QaPassw0rd!' ? 'QaPassw0rd! (default; override with QA_PASSWORD)' : '(from QA_PASSWORD)'}`);
// exitCode (not process.exit) so open keep-alive sockets can close first — see cleanup.mjs
process.exitCode = failed ? 1 : 0;
