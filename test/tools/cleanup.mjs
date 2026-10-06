// Deletes all data owned by @qa.beecollab.test accounts via the guarded backend endpoint.
// The backend must run with TEST_SUPPORT_ENABLED=true and TEST_ADMIN_TOKEN=<16+ chars>;
// pass the same value here as TEST_ADMIN_TOKEN. Run it while no test is executing.
import { API, TEST_TOKEN, api } from './config.mjs';

if (!TEST_TOKEN) {
  console.error('TEST_ADMIN_TOKEN is not set. Export it first (same value as on the backend).');
  process.exit(2);
}

const headers = { 'x-test-token': TEST_TOKEN };
const before = await api('GET', '/test-support/status', { headers });
if (before.status === 404) {
  console.error(`Test support is DISABLED on ${API} (404). The backend owner must set TEST_SUPPORT_ENABLED=true and TEST_ADMIN_TOKEN.`);
  process.exit(3);
}
if (before.status === 401) {
  console.error('Token rejected (401). TEST_ADMIN_TOKEN does not match the backend.');
  process.exit(4);
}
console.log('before:', JSON.stringify(before.data));
const res = await api('POST', '/test-support/cleanup', { headers });
console.log('cleanup:', res.status, JSON.stringify(res.data));
const after = await api('GET', '/test-support/status', { headers });
console.log('after: ', JSON.stringify(after.data));
process.exit(res.status === 200 ? 0 : 1);
