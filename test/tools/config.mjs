// Shared settings for the QA tools. Override with environment variables.
//   API_URL           backend base URL     (default http://localhost:3000)
//   WEB_URL           frontend base URL    (default http://localhost:3001)
//   TEST_ADMIN_TOKEN  token for /test-support/* (only if the backend enables it)
//   QA_PASSWORD       password for the seeded accounts

const trim = (u) => u.replace(/\/+$/, '');

export const API = trim(process.env.API_URL ?? 'http://localhost:3000');
export const WEB = trim(process.env.WEB_URL ?? 'http://localhost:3001');
export const TEST_TOKEN = process.env.TEST_ADMIN_TOKEN ?? '';

/** Every automated-test account must use this suffix so the cleanup endpoint can find it. */
export const TEST_SUFFIX = '@qa.beecollab.test';
export const PASSWORD = process.env.QA_PASSWORD ?? 'QaPassw0rd!';

/** Fixed, re-creatable accounts (seed-accounts.mjs). */
export const ACCOUNTS = [
  { key: 'alice', name: 'Alice Host' },
  { key: 'bob', name: 'Bob Member' },
  { key: 'carol', name: 'Carol Member' },
];
export const emailOf = (key) => `${key}${TEST_SUFFIX}`;
export const uniqueEmail = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}${TEST_SUFFIX}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal REST helper. Returns { status, body } where body is the parsed JSON
 * envelope ({success,data,message,...} or {success:false,error,statusCode,...}).
 */
export async function api(method, path, { body, token, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000), // a sleeping Render instance can take ~1 min
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, data: json?.data };
}

export async function register(email, name, password = PASSWORD) {
  const r = await api('POST', '/auth/register', { body: { email, name, password } });
  if (r.status === 201) return r.data.access_token;
  if (r.status === 409) return login(email, password);
  throw new Error(`register ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
}

export async function login(email, password = PASSWORD) {
  const r = await api('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 201) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.data.access_token;
}

export async function guestToken(name = 'Guest QA') {
  const r = await api('POST', '/auth/guest', { body: { name } });
  if (r.status !== 201) throw new Error(`guest token failed: ${r.status}`);
  return r.data.access_token;
}

export async function createMeeting(token, overrides = {}) {
  const r = await api('POST', '/meetings', {
    token,
    body: { title: 'QA meeting', duration: 30, maxParticipants: 10, ...overrides },
  });
  if (r.status !== 201) throw new Error(`create meeting failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.data;
}

/** Tiny assertion collector so the smoke scripts print a readable PASS/FAIL list. */
export function makeReporter(title) {
  const results = [];
  console.log(`\n== ${title} ==  (api=${API})`);
  return {
    check(name, ok, detail = '') {
      results.push({ name, ok: Boolean(ok) });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${detail}` : ''}`);
    },
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
      process.exitCode = failed ? 1 : 0;
      return failed === 0;
    },
  };
}
