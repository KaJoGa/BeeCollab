// Deletes all data owned by @qa.beecollab.test accounts via the guarded backend endpoint.
// The backend must run with TEST_SUPPORT_ENABLED=true and TEST_ADMIN_TOKEN=<16+ chars>;
// pass the same value here as TEST_ADMIN_TOKEN. Run it while no test is executing.
//
// Exit codes: 0 ok · 1 cleanup failed · 2 no token given · 3 disabled on the backend (404) · 4 token rejected (401)
// (process.exitCode is used instead of process.exit() on purpose: exiting right after fetch() can trip a
//  libuv assertion on Windows and turn the exit code into 127.)
import { API, TEST_TOKEN, api } from './config.mjs';

async function main() {
  if (!TEST_TOKEN) {
    console.error('TEST_ADMIN_TOKEN is not set. Export it first (same value as on the backend).');
    return 2;
  }
  const headers = { 'x-test-token': TEST_TOKEN };
  const before = await api('GET', '/test-support/status', { headers });
  if (before.status === 404) {
    console.error(`Test support is DISABLED on ${API} (404). The backend owner must set TEST_SUPPORT_ENABLED=true and TEST_ADMIN_TOKEN.`);
    return 3;
  }
  if (before.status === 401) {
    console.error('Token rejected (401). TEST_ADMIN_TOKEN does not match the backend.');
    return 4;
  }
  console.log('before:', JSON.stringify(before.data));
  const res = await api('POST', '/test-support/cleanup', { headers });
  console.log('cleanup:', res.status, JSON.stringify(res.data));
  const after = await api('GET', '/test-support/status', { headers });
  console.log('after: ', JSON.stringify(after.data));
  return res.status === 200 ? 0 : 1;
}

process.exitCode = await main();
