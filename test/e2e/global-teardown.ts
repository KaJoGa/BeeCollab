// Optional: delete the @qa.beecollab.test data this run created.
// Runs ONLY when both QA_CLEANUP=1 and TEST_ADMIN_TOKEN are set, and the backend must have
// TEST_SUPPORT_ENABLED=true (otherwise the endpoint is 404 and we just say so).
import { API, TEST_TOKEN, sleep, timedFetch } from '../tools/config.mjs';

export default async function globalTeardown() {
  if (process.env.QA_CLEANUP !== '1') return;
  if (!TEST_TOKEN) {
    console.log('[teardown] QA_CLEANUP=1 but TEST_ADMIN_TOKEN is not set; skipping cleanup');
    return;
  }
  try {
    const res = await timedFetch(
      `${API}/test-support/cleanup`,
      { method: 'POST', headers: { 'x-test-token': TEST_TOKEN, Connection: 'close' } },
      60_000,
    );
    if (res.status === 404) {
      console.log('[teardown] test support is disabled on this backend (404); nothing cleaned');
      return;
    }
    const json: any = await res.json().catch(() => ({}));
    console.log(`[teardown] cleanup ${res.status}: ${JSON.stringify(json?.data?.deleted ?? json)}`);
    // Let the HTTP connection finish closing before Playwright exits the process
    // (an open keep-alive socket at exit trips a libuv assertion on Windows -> exit code 127).
    await sleep(300);
  } catch (e: any) {
    console.log(`[teardown] cleanup failed: ${e.message}`);
  }
}
