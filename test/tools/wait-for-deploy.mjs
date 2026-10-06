// Waits until the backend answers /health with db "up" (and, optionally, a given commit).
//   node tools/wait-for-deploy.mjs                 -> wake the server and wait for the DB
//   node tools/wait-for-deploy.mjs --commit f6490cb -> also wait until that git SHA (prefix) is live
//   node tools/wait-for-deploy.mjs --timeout 900    -> seconds (default 600)
import { API, sleep } from './config.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const wantCommit = opt('commit', '');
const timeoutMs = Number(opt('timeout', '600')) * 1000;
const started = Date.now();
let last = '';

while (Date.now() - started < timeoutMs) {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const json = await res.json();
      const d = json?.data ?? json;
      const commit = d?.commit ?? '(none: old build)';
      const line = `db=${d?.db} commit=${commit} uptime=${d?.uptimeSeconds ?? '?'}s`;
      if (line !== last) console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${line}`);
      last = line;
      const commitOk = !wantCommit || String(d?.commit ?? '').startsWith(wantCommit.slice(0, 7));
      if (d?.db === 'up' && commitOk) {
        console.log(`READY after ${Math.round((Date.now() - started) / 1000)}s: ${line}`);
        process.exit(0);
      }
    } else if (String(res.status) !== last) {
      last = String(res.status);
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] HTTP ${res.status} (server waking up or redeploying)`);
    }
  } catch (e) {
    if (e.message !== last) {
      last = e.message;
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${e.message}`);
    }
  }
  await sleep(5000);
}
console.error(`TIMEOUT after ${timeoutMs / 1000}s waiting for ${API}${wantCommit ? ` commit ${wantCommit}` : ''}`);
process.exit(1);
