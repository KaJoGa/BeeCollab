// Socket.io smoke test on the /meetings namespace: auth, join, capacity, chat, hand queue,
// media, WebRTC relay, host controls, agenda, polls, reactions, duplicate tab.
// Creates its own @qa.beecollab.test users + meetings and ends them at the end.
//   API_URL=https://beecollab-rwbj.onrender.com node tools/smoke-ws.mjs
import { io } from 'socket.io-client';
import { API, createMeeting, guestToken, makeReporter, register, sleep, uniqueEmail } from './config.mjs';

const t = makeReporter('WebSocket smoke');
const { check } = t;
const sockets = [];

/** Connects and records every event so assertions can look back (no race with emit order). */
function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(`${API}/meetings`, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.label = label;
    s.events = [];
    s.onAny((name, payload) => s.events.push({ name, payload, at: Date.now() }));
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`${label}: ${e.message}`)));
    sockets.push(s);
  });
}

/** Resolves with the first (past or future) event matching name/predicate, or null on timeout. */
async function seen(s, name, pred = () => true, timeout = 4000) {
  const end = Date.now() + timeout;
  for (;;) {
    const hit = s.events.find((e) => e.name === name && pred(e.payload));
    if (hit) return hit.payload;
    if (Date.now() > end) return null;
    await sleep(50);
  }
}
const countOf = (s, name) => s.events.filter((e) => e.name === name).length;
const join = async (s, meetingId, extra = {}) => {
  s.emit('meeting:join', { meetingId, ...extra });
  return seen(s, 'meeting:state');
};

try {
  // ---- connection auth
  const anon = io(`${API}/meetings`, { transports: ['websocket'], reconnection: false });
  const anonEvents = [];
  anon.onAny((n, p) => anonEvents.push({ n, p }));
  await sleep(1500);
  check('connection without token is rejected (error event + disconnect)', anonEvents.some((e) => e.n === 'error') && !anon.connected);
  anon.close();

  // ---- actors
  const hostToken = await register(uniqueEmail('ws-host'), 'WS Host');
  const bobToken = await register(uniqueEmail('ws-bob'), 'WS Bob');
  const gToken = await guestToken('WS Guest');
  const meeting = await createMeeting(hostToken, { title: 'WS smoke meeting', maxParticipants: 4, duration: 30 });
  const host = await connect(hostToken, 'host');
  const bob = await connect(bobToken, 'bob');
  const guest = await connect(gToken, 'guest');

  // ---- join
  const hostState = await join(host, meeting.id);
  check('host joins: receives meeting:state with itself, role HOST', hostState?.participants?.some((p) => p.socketId === host.id && p.role === 'HOST'), JSON.stringify(hostState));
  check('host joins: receives chat:history, agenda:list, poll:list', (await seen(host, 'chat:history')) && (await seen(host, 'agenda:list')) && (await seen(host, 'poll:list')));
  const bobState = await join(bob, meeting.id);
  check('member joins: meeting:state lists both participants', bobState?.participants?.length === 2);
  check('host is notified with participant:joined (role PARTICIPANT)', !!(await seen(host, 'participant:joined', (p) => p.socketId === bob.id && p.role === 'PARTICIPANT')));
  const guestState = await join(guest, meeting.id);
  check('guest joins: meeting:state lists three participants', guestState?.participants?.length === 3);
  check('guest profile uses the guest display name', guestState?.participants?.find((p) => p.socketId === guest.id)?.user?.name === 'WS Guest');

  // ---- chat
  host.emit('chat:message', { meetingId: meeting.id, message: 'hello from host' });
  guest.emit('chat:message', { meetingId: meeting.id, message: 'hello from guest' });
  check('registered chat is broadcast to everyone', !!(await seen(bob, 'chat:message', (m) => m.message === 'hello from host' && m.sender?.name === 'WS Host')));
  check('guest chat is broadcast to everyone', !!(await seen(bob, 'chat:message', (m) => m.message === 'hello from guest' && m.sender?.name === 'WS Guest')));
  await sleep(300);
  const history = await (await fetch(`${API}/meetings/${meeting.id}/chat`, { headers: { Authorization: `Bearer ${hostToken}` } })).json();
  const stored = (history.data ?? []).map((m) => m.message);
  check('registered chat is persisted; guest chat is not', stored.includes('hello from host') && !stored.includes('hello from guest'), JSON.stringify(stored));

  // ---- media + speaking
  bob.emit('media:toggle', { meetingId: meeting.id, type: 'audio', enabled: true });
  check('media:toggle is broadcast as media:updated', !!(await seen(host, 'media:updated', (m) => m.socketId === bob.id && m.type === 'audio' && m.enabled === true)));
  bob.emit('media:speaking', { meetingId: meeting.id, speaking: true });
  check('media:speaking reaches other participants', !!(await seen(host, 'media:speaking', (m) => m.socketId === bob.id && m.speaking === true)));

  // ---- WebRTC relay
  bob.emit('webrtc:offer', { to: host.id, from: bob.id, sdp: { type: 'offer', sdp: 'v=0' } });
  host.emit('webrtc:answer', { to: bob.id, from: host.id, sdp: { type: 'answer', sdp: 'v=0' } });
  bob.emit('webrtc:ice-candidate', { to: host.id, from: bob.id, candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 9 typ host' } });
  check('webrtc:offer is relayed to the target only', !!(await seen(host, 'webrtc:offer', (m) => m.from === bob.id)) && countOf(guest, 'webrtc:offer') === 0);
  check('webrtc:answer is relayed', !!(await seen(bob, 'webrtc:answer', (m) => m.from === host.id)));
  check('webrtc:ice-candidate is relayed', !!(await seen(host, 'webrtc:ice-candidate', (m) => m.from === bob.id)));

  // ---- hand raise queue
  bob.emit('hand:toggle', { meetingId: meeting.id, raised: true });
  await sleep(200);
  guest.emit('hand:toggle', { meetingId: meeting.id, raised: true });
  const q2 = await seen(host, 'queue:updated', (q) => q.length === 2);
  check('hand queue holds registered user and guest in raise order', q2 && q2[0].user?.name === 'WS Bob' && q2[1].user?.name === 'WS Guest', JSON.stringify(q2?.map((e) => e.user?.name)));
  guest.emit('hand:toggle', { meetingId: meeting.id, raised: false });
  check('lowering a hand updates the queue', !!(await seen(host, 'queue:updated', (q) => q.length === 1 && q[0].user?.name === 'WS Bob')));

  // ---- host controls: permissions
  bob.emit('media:force-mute', { meetingId: meeting.id, targetSocketId: host.id });
  check('member cannot force-mute (error event)', !!(await seen(bob, 'error', (e) => /host\/co-host/i.test(e.message ?? ''))));
  bob.emit('meeting:kick', { meetingId: meeting.id, targetSocketId: guest.id });
  check('member cannot kick (error event)', !!(await seen(bob, 'error', (e) => /kick/i.test(e.message ?? ''))));
  bob.emit('meeting:make-cohost', { meetingId: meeting.id, targetUserId: 'x' });
  check('member cannot assign co-host (error event)', !!(await seen(bob, 'error', (e) => /co-host/i.test(e.message ?? '') && /host can/i.test(e.message ?? ''))));
  host.emit('meeting:kick', { meetingId: meeting.id, targetSocketId: host.id });
  check('host cannot be kicked (error event)', !!(await seen(host, 'error', (e) => /host cannot be kicked/i.test(e.message ?? ''))));

  // ---- host controls: force-mute, ask-unmute, co-host
  host.emit('media:force-mute', { meetingId: meeting.id, targetSocketId: bob.id });
  check('host force-mute: target gets media:force-mute', !!(await seen(bob, 'media:force-mute')));
  check('host force-mute: room sees audio disabled', !!(await seen(guest, 'media:updated', (m) => m.socketId === bob.id && m.type === 'audio' && m.enabled === false)));
  host.emit('media:ask-unmute', { meetingId: meeting.id, targetSocketId: bob.id });
  check('host ask-unmute: target gets media:ask-unmute', !!(await seen(bob, 'media:ask-unmute')));
  const bobUserId = bobState.participants.find((p) => p.socketId === bob.id).userId;
  host.emit('meeting:make-cohost', { meetingId: meeting.id, targetUserId: bobUserId });
  check('host can promote a member to CO_HOST (participant:role-updated)', !!(await seen(guest, 'participant:role-updated', (m) => m.userId === bobUserId && m.role === 'CO_HOST')));

  // ---- agenda (host/co-host only)
  guest.emit('agenda:create', { meetingId: meeting.id, items: [{ title: 'Ignored', duration: 60 }] });
  await sleep(500);
  check('guest cannot create an agenda (no agenda:list with items)', !host.events.some((e) => e.name === 'agenda:list' && e.payload?.length > 0));
  host.emit('agenda:create', { meetingId: meeting.id, items: [{ title: 'Intro', duration: 60 }, { title: 'Demo', duration: 120 }] });
  const agendas = await seen(guest, 'agenda:list', (a) => a.length === 2);
  check('host creates an agenda; everyone receives it in order', agendas?.map((a) => a.title).join() === 'Intro,Demo', JSON.stringify(agendas?.map((a) => a.title)));
  host.emit('agenda:start', { meetingId: meeting.id, agendaId: agendas?.[0]?.id });
  check('host starts an item: agenda:active is broadcast', !!(await seen(guest, 'agenda:active', (a) => a.title === 'Intro' && a.isActive === true)));

  // ---- polls
  host.emit('poll:create', { meetingId: meeting.id, question: 'Best colour?', options: ['Red', 'Blue'] });
  const poll = await seen(bob, 'poll:created');
  check('host creates a poll with two options', poll?.question === 'Best colour?' && poll.options?.length === 2);
  bob.emit('poll:vote', { meetingId: meeting.id, pollId: poll?.id, optionId: poll?.options?.[1]?.id });
  const updated = await seen(host, 'poll:updated', (polls) => polls.some((p) => p.id === poll?.id && p.options.some((o) => o.responses?.length === 1)));
  check('registered member can vote; poll:updated shows one response', !!updated);

  // ---- reactions
  bob.emit('reaction:send', { meetingId: meeting.id, type: '👍', anonymous: false });
  const agg = await seen(host, 'reaction:aggregated', (a) => a.some?.((r) => r.type === '👍'));
  check('reaction is aggregated and broadcast', !!agg, JSON.stringify(agg));

  // ---- capacity (meeting max 4: host, bob, guest + one more fits, the 5th is refused)
  const extra1Token = await register(uniqueEmail('ws-x1'), 'WS Extra One');
  const extra1 = await connect(extra1Token, 'extra1');
  const extra1Id = extra1.id; // a socket's id is undefined once it disconnects, so keep a copy
  const extra1State = await join(extra1, meeting.id);
  check('4th distinct user fits (capacity 4)', extra1State?.participants?.length === 4);
  const extra2 = await connect(await register(uniqueEmail('ws-x2'), 'WS Extra Two'), 'extra2');
  extra2.emit('meeting:join', { meetingId: meeting.id });
  const full = await seen(extra2, 'meeting:full');
  await sleep(300);
  check('5th user is refused: meeting:full then disconnect', !!full && !extra2.connected, JSON.stringify(full));

  // ---- duplicate tab for the same user
  const hostDup = await connect(hostToken, 'host-second-tab');
  hostDup.emit('meeting:join', { meetingId: meeting.id });
  check('same user in a second tab: the older socket gets an error and is closed', !!(await seen(host, 'error', (e) => /tab lain/i.test(e.message ?? ''))));
  await sleep(300);
  check('the older socket is disconnected', !host.connected);

  // ---- kick (use the new host socket)
  hostDup.emit('meeting:kick', { meetingId: meeting.id, targetSocketId: extra1Id });
  check('host kicks a participant: target gets meeting:kicked', !!(await seen(extra1, 'meeting:kicked')));
  check('host kick: others get participant:left', !!(await seen(bob, 'participant:left', (p) => p.socketId === extra1Id)));

  // ---- leaving
  const guestId = guest.id;
  guest.disconnect();
  check('disconnect broadcasts participant:left', !!(await seen(bob, 'participant:left', (p) => p.socketId === guestId)));

  // ---- end meeting: only the host
  bob.emit('meeting:end', { meetingId: meeting.id });
  check('non-host cannot end the meeting (error event)', !!(await seen(bob, 'error', (e) => /Unauthorized or meeting not found/i.test(e.message ?? ''))));
  hostDup.emit('meeting:end', { meetingId: meeting.id });
  check('host ends the meeting: everyone gets meeting:ended', !!(await seen(bob, 'meeting:ended', (m) => m.meetingId === meeting.id)));
  await sleep(300);
  const gone = await fetch(`${API}/meetings/${meeting.id}`, { headers: { Authorization: `Bearer ${bobToken}` } });
  check('ended meeting is deleted (REST 404)', gone.status === 404);
} catch (e) {
  check(`script ran to completion (${e.message})`, false);
} finally {
  if (process.env.DEBUG_WS) {
    for (const s of sockets) console.log(`DEBUG ${s.label} (connected=${s.connected}):`, s.events.map((e) => e.name).join(' '));
    for (const s of sockets) for (const e of s.events) if (e.name === 'participant:left') console.log(`DEBUG ${s.label} (id=${s.id}) participant:left`, JSON.stringify(e.payload));
  }
  sockets.forEach((s) => s.close());
}
t.finish();
