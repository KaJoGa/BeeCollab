// REST smoke test: auth, validation, meetings, ICE servers. Self-contained and
// non-destructive: it creates its own @qa.beecollab.test user and meeting and
// deletes the meeting at the end. Exit code 1 if any check fails.
//   API_URL=https://beecollab-rwbj.onrender.com node tools/smoke-api.mjs
import { PASSWORD, api, createMeeting, guestToken, makeReporter, uniqueEmail } from './config.mjs';

const t = makeReporter('REST smoke');
const { check } = t;

// --- health & root
const health = await api('GET', '/health');
check('GET /health -> 200 with db up', health.status === 200 && health.data?.db === 'up', JSON.stringify(health.body));
check('GET /health reports commit and uptimeSeconds', typeof health.data?.commit === 'string' && typeof health.data?.uptimeSeconds === 'number');
check('GET / -> 200', (await api('GET', '/')).status === 200);

// --- register validation
const email = uniqueEmail('smoke');
check('register: invalid email -> 400', (await api('POST', '/auth/register', { body: { email: 'nope', name: 'Smoke', password: 'secret1' } })).status === 400);
check('register: short password -> 400', (await api('POST', '/auth/register', { body: { email, name: 'Smoke', password: '123' } })).status === 400);
check('register: short name -> 400', (await api('POST', '/auth/register', { body: { email, name: 'S', password: 'secret1' } })).status === 400);
check('register: unknown field rejected -> 400', (await api('POST', '/auth/register', { body: { email, name: 'Smoke', password: 'secret1', role: 'admin' } })).status === 400);

// --- register / login
const reg = await api('POST', '/auth/register', { body: { email, name: 'Smoke User', password: PASSWORD } });
check('register ok -> 201 with access_token', reg.status === 201 && typeof reg.data?.access_token === 'string', JSON.stringify(reg.body));
check('register duplicate email -> 409', (await api('POST', '/auth/register', { body: { email, name: 'Smoke User', password: PASSWORD } })).status === 409);
check('login wrong password -> 401', (await api('POST', '/auth/login', { body: { email, password: 'wrong-pass' } })).status === 401);
check('login unknown email -> 401', (await api('POST', '/auth/login', { body: { email: uniqueEmail('ghost'), password: PASSWORD } })).status === 401);
const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
check('login ok -> 201 with access_token', login.status === 201 && typeof login.data?.access_token === 'string');
const token = login.data?.access_token;

// --- profile
check('GET /users/me without token -> 401', (await api('GET', '/users/me')).status === 401);
check('GET /users/me with tampered token -> 401', (await api('GET', '/users/me', { token: `${token}x` })).status === 401);
const me = await api('GET', '/users/me', { token });
check('GET /users/me -> 200, correct email, no passwordHash', me.status === 200 && me.data?.email === email && !('passwordHash' in (me.data ?? {})), JSON.stringify(me.body));

// --- guest
check('guest: short name -> 400', (await api('POST', '/auth/guest', { body: { name: 'G' } })).status === 400);
const guest = await api('POST', '/auth/guest', { body: { name: 'Smoke Guest' } });
check('guest ok -> 201 with access_token', guest.status === 201 && typeof guest.data?.access_token === 'string');
const gToken = guest.data?.access_token;

// --- meeting validation
check('create meeting without token -> 401', (await api('POST', '/meetings', { body: { title: 'Hello there' } })).status === 401);
check('create meeting: short title -> 400', (await api('POST', '/meetings', { token, body: { title: 'Hi' } })).status === 400);
check('create meeting: maxParticipants 1 -> 400', (await api('POST', '/meetings', { token, body: { title: 'Hello', maxParticipants: 1 } })).status === 400);
check('create meeting: maxParticipants 501 -> 400', (await api('POST', '/meetings', { token, body: { title: 'Hello', maxParticipants: 501 } })).status === 400);
check('create meeting: duration 0 -> 400', (await api('POST', '/meetings', { token, body: { title: 'Hello', duration: 0 } })).status === 400);
check('create meeting: duration 1441 -> 400', (await api('POST', '/meetings', { token, body: { title: 'Hello', duration: 1441 } })).status === 400);
check('create meeting: non-integer duration -> 400', (await api('POST', '/meetings', { token, body: { title: 'Hello', duration: 1.5 } })).status === 400);

// --- meeting lifecycle
const meeting = await createMeeting(token, { title: 'Smoke meeting', duration: 30, maxParticipants: 5 });
check('create meeting ok: SCHEDULED, 8-char uppercase hex room code', meeting.status === 'SCHEDULED' && /^[0-9A-F]{8}$/.test(meeting.roomCode), meeting.roomCode);
check('create meeting: host is first participant with role HOST', meeting.participants?.[0]?.role === 'HOST' && meeting.hostId === meeting.participants?.[0]?.userId);
check('create meeting keeps the requested duration/maxParticipants', meeting.duration === 30 && meeting.maxParticipants === 5);

const mine = await api('GET', '/meetings', { token });
check('GET /meetings lists my meeting', mine.status === 200 && mine.data?.some?.((m) => m.id === meeting.id));
const byCode = await api('GET', `/meetings/code/${meeting.roomCode}`, { token: gToken });
check('GET /meetings/code/:code -> 200 (guest token allowed)', byCode.status === 200 && byCode.data?.id === meeting.id);
check('GET /meetings/code/UNKNOWN -> 404', (await api('GET', '/meetings/code/ZZZZZZZZ', { token })).status === 404);
const byId = await api('GET', `/meetings/${meeting.id}`, { token });
check('GET /meetings/:id -> 200', byId.status === 200 && byId.data?.title === 'Smoke meeting');
check('GET /meetings/:unknown -> 404', (await api('GET', '/meetings/00000000-0000-4000-8000-000000000000', { token })).status === 404);
check('join with wrong room code -> 403', (await api('POST', `/meetings/${meeting.id}/join`, { token, body: { roomCode: 'WRONG123' } })).status === 403);
check('join without roomCode -> 400', (await api('POST', `/meetings/${meeting.id}/join`, { token, body: {} })).status === 400);
check('join with correct code -> 201', (await api('POST', `/meetings/${meeting.id}/join`, { token, body: { roomCode: meeting.roomCode } })).status === 201);
check('GET participants -> 200 array', Array.isArray((await api('GET', `/meetings/${meeting.id}/participants`, { token })).data));
const chat = await api('GET', `/meetings/${meeting.id}/chat`, { token });
check('GET chat history -> 200 empty array', chat.status === 200 && Array.isArray(chat.data) && chat.data.length === 0);

// --- ICE servers
const ice = await api('GET', '/webrtc/ice-servers', { token: gToken });
check('GET /webrtc/ice-servers (guest) -> 200 with at least one STUN entry', ice.status === 200 && ice.data?.iceServers?.some?.((s) => [].concat(s.urls).some((u) => u.startsWith('stun:'))));
check('GET /webrtc/ice-servers without token -> 401', (await api('GET', '/webrtc/ice-servers')).status === 401);
const hasTurn = ice.data?.iceServers?.some?.((s) => [].concat(s.urls).some((u) => u.startsWith('turn')));
console.log(`INFO  TURN ${hasTurn ? 'configured (credentials returned)' : 'NOT configured (STUN only)'}`);

// --- authorization on delete, then delete
const other = await api('POST', '/auth/register', { body: { email: uniqueEmail('smoke-other'), name: 'Other User', password: PASSWORD } });
check('DELETE meeting as non-host -> 403', (await api('DELETE', `/meetings/${meeting.id}`, { token: other.data?.access_token })).status === 403);
check('DELETE meeting as host -> 200', (await api('DELETE', `/meetings/${meeting.id}`, { token })).status === 200);
check('GET deleted meeting -> 404', (await api('GET', `/meetings/${meeting.id}`, { token })).status === 404);
check('DELETE deleted meeting -> 404', (await api('DELETE', `/meetings/${meeting.id}`, { token })).status === 404);

// --- docs & error envelope
const docs = await api('GET', '/api/docs-json');
check('Swagger JSON available at /api/docs-json', docs.status === 200 && docs.body?.openapi);
const nf = await api('GET', '/definitely-not-a-route');
check('unknown route -> 404 error envelope', nf.status === 404 && nf.body?.success === false && typeof nf.body?.error === 'string');

console.log('\nNote: this run leaves two @qa.beecollab.test users behind; use `npm run cleanup` if test support is enabled.');
t.finish();
