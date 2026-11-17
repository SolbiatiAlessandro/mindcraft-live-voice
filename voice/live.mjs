// Loopback-only live voice for Badcock: browser <-WebRTC-> OpenAI GPT-Live; delegations -> Mindcraft's local socket.
// The API key stays in this process; the browser only ever gets an SDP answer.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(here + '../mindcraft/package.json');
const { io } = require('socket.io-client');
const PORT = 8793, OWNER = 'a16i', AGENT = 'Badcock', KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LIVE_MODEL || 'gpt-live-1', VOICE = process.env.LIVE_VOICE || 'ash';
if (!KEY) { console.error('no OPENAI_API_KEY'); process.exit(3); }
const log = (...a) => console.log(new Date().toISOString(), ...a);
// GPT-Live, client delegation: the voice model talks; when it delegates, the page sends the player's words to /tell (Mindcraft + Luna).
export const SESSION = {
  model: MODEL,
  instructions: `You are Badcock, a Minecraft companion playing on a server with your owner ${OWNER}, who is talking to you by voice. Speak English. Be brief, warm and natural: one or two short sentences.
Your body in the game is run by a backend. Delegate to the backend whenever the player wants you to DO something in the game (come, follow, stop, collect, mine, craft, smelt, place, build, give, fight, sleep, write or run a script, save or look up a note) or asks about the live game (your inventory, position, health, what is nearby).
Answer small talk, jokes, opinions and general Minecraft know-how yourself, straight away, without delegating.
Never claim you did or saw anything in the game unless a backend result told you so. Backend results are what your body said or did: relay them briefly in first person, and never read out command syntax such as !collectBlocks(...).`,
  audio: { output: { voice: VOICE } },
  delegation: { type: 'client' },
};
// ── Mindcraft side ──
const sock = io('http://localhost:8791'); let inGame = false, waiter = null, late = [], lateTimer = null; const clients = new Set();
const push = (type, data) => { for (const r of clients) r.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
sock.on('connect', () => { log('mindserver connected'); sock.emit('listen-to-agents'); });
sock.on('disconnect', () => { inGame = false; log('mindserver disconnected'); });
sock.on('agents-status', (agents) => { const a = (agents || []).find(x => x.name === AGENT); inGame = !!(a && a.in_game); push('status', { inGame }); });
sock.on('bot-output', (name, message) => {
  if (name !== AGENT) return; const text = String(message).trim(); if (!text || /^Hello world! I am/.test(text)) return;
  log('body:', JSON.stringify(text.slice(0, 200)));
  if (waiter) return waiter.add(text);
  late.push(text); clearTimeout(lateTimer); lateTimer = setTimeout(() => { push('update', { text: late.join(' ') }); late = []; }, 2000);
});
const FAST = [[/^(please )?(stop|halt|cancel)\b.{0,25}$/i, '!stop'], [/^(please )?follow( me)?\b.{0,15}$/i, `!followPlayer("${OWNER}", 3)`], [/^(please )?come( here| to me| over here)?\b.{0,15}$/i, `!goToPlayer("${OWNER}", 3)`]];
export function fastPath(text) { for (const [re, cmd] of FAST) if (re.test(text.trim())) return cmd; return null; }
function tell(request) {
  return new Promise((resolve) => {
    if (!sock.connected || !inGame) return resolve('Body is offline right now (reconnecting to the server). Tell the player to try again in a minute.');
    if (waiter) waiter.finish('A newer request took over; the earlier one may still be running.');
    const cmd = fastPath(request), parts = []; let quiet = null;
    const done = (fallback) => { clearTimeout(quiet); clearTimeout(hard); waiter = null; resolve(parts.join(' ') || fallback); };
    const hard = setTimeout(() => done('Body has started on it and is still working. A body update will follow.'), 25000);
    waiter = { finish: done, add: (t) => { parts.push(t); clearTimeout(quiet); quiet = setTimeout(() => done(''), cmd ? 1500 : 3000); } };
    log('tell:', JSON.stringify(request), cmd ? '(fast ' + cmd + ')' : '');
    sock.emit('send-message', AGENT, { from: OWNER, message: cmd || request });
  });
}
// ── HTTP ──
const body = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c).toString('utf8'); };
http.createServer(async (req, res) => {
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(readFileSync(here + 'live.html')); }
    if (req.method === 'GET' && url.pathname === '/health') return json(200, { mindserver: sock.connected, inGame, model: MODEL });
    if (req.method === 'GET' && url.pathname === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(`event: status\ndata: ${JSON.stringify({ inGame })}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return; }
    if (req.method === 'POST' && url.pathname === '/offer') {
      const r = await fetch('https://api.openai.com/v1/live/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' }, body: JSON.stringify({ session: SESSION, transport: { type: 'webrtc', sdp: await body(req) } }) });
      const t = await r.text(); log('offer ->', r.status); if (!r.ok) return json(502, { error: 'live ' + r.status + ' ' + t.slice(0, 300) });
      const j = JSON.parse(t); log('session', j.session && j.session.id);
      res.writeHead(200, { 'content-type': 'application/sdp' }); return res.end(j.transport.sdp);
    }
    if (req.method === 'POST' && url.pathname === '/tell') { const { request } = JSON.parse(await body(req)); const result = await tell(String(request || '').slice(0, 500)); log('result:', JSON.stringify(result.slice(0, 200))); return json(200, { result }); }
    json(404, { error: 'not found' });
  } catch (e) { log('fail', e.message); json(500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => log('live voice on http://127.0.0.1:' + PORT, MODEL, VOICE));
