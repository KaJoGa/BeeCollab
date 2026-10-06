// Wakes the backend (free hosting sleeps) and waits until it and the database answer.
import { API, sleep, timedFetch } from '../tools/config.mjs';

export default async function globalSetup() {
  const deadline = Date.now() + 180_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await timedFetch(`${API}/health`, {}, 15_000);
      const json: any = res.ok ? await res.json() : null;
      const d = json?.data ?? json;
      if (res.ok && d?.db === 'up') {
        console.log(`[setup] backend ready: ${API} commit=${d.commit} uptime=${d.uptimeSeconds}s`);
        return;
      }
      last = `HTTP ${res.status} db=${d?.db}`;
    } catch (e: any) {
      last = e.message;
    }
    await sleep(3000);
  }
  throw new Error(`Backend ${API} did not become ready within 180s (${last})`);
}
