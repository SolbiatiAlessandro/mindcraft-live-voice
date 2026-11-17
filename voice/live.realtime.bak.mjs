// Loopback-only live voice for Badcock: browser <-WebRTC-> OpenAI Realtime; tool calls -> Mindcraft's local socket.
// The API key stays in this process; the browser only ever gets an SDP answer.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(here + '../mindcraft/package.json');
const { io } = require('socket.io-client');
const PORT = 8793, OWNER = 'a16i', AGENT = 'Badcock', KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.LIVE_MODEL || 'gpt-realtime-2.1', VOICE = process.env.LIVE_VOICE || 'cedar';
if (!KEY) { console.error('no OPENAI_API_KEY'); process.exit(3); }
const log = (...a) => console.log(new Date().toISOString(), ...a);
export const SESSION = {
  type: 'realtime', model: MODEL,
  instructions: `You are Badcock, a Minecraft companion playing on a server with your owner ${OWNER}, who is talking to you by voice. Speak English. Be brief, warm and natural: one or two short sentences.
Your body in the game is controlled by a backend. You reach it only through the tell_badcock tool.
Answer small talk, jokes, opinions and general Minecraft know-how yourself, straight away, without the tool.
Use tell_badcock whenever the player wants you to DO something in the game (come, follow, stop, collect, mine, craft, smelt, place, give, fight, sleep) or asks about the live game (your inventory, position, health, what is nearby). Pass the request in plain words.
Never claim you did or saw anything in the game unless a tool result or a body update told you so. Tool results are what your body said or did: relay them briefly in first person, and never read out command syntax such as !collectBlocks(...).
Call the tool once per request. Messages that start with "Body update:" are results from your body, not requests from the player: say them briefly and do not call the tool for them.`,
  audio: { input: { turn_detection: { type: 'semantic_vad' }, transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' } }, output: { voice: VOICE } },
  tools: [{ type: 'function', name: 'tell_badcock', description: 'Send a request to your Minecraft body and get back what it said or did. Use for any in-game action or live game question.',
    parameters: { type: 'object', properties: { request: { type: 'string', description: 'What the player wants, in plain words' } }, required: ['request'] } }],
  tool_choice: 'auto',
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
    const cmd = fastPath(request), parts = []; let quiet = null;
    const done = (fallback) => { clearTimeout(quiet); clearTimeout(hard); waiter = null; resolve(parts.join(' ') || fallback); };
    const hard = setTimeout(() => done('Body has started on it and is still working. A body update will follow.'), 25000);
    waiter = { add: (t) => { parts.push(t); clearTimeout(quiet); quiet = setTimeout(() => done(''), cmd ? 1500 : 3000); } };
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
      const fd = new FormData(); fd.set('sdp', await body(req)); fd.set('session', JSON.stringify(SESSION));
      const r = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: fd });
      const t = await r.text(); log('offer ->', r.status); if (!r.ok) return json(502, { error: 'realtime ' + r.status + ' ' + t.slice(0, 300) });
      res.writeHead(200, { 'content-type': 'application/sdp' }); return res.end(t);
    }
    if (req.method === 'POST' && url.pathname === '/tell') { const { request } = JSON.parse(await body(req)); const result = await tell(String(request || '').slice(0, 500)); log('result:', JSON.stringify(result.slice(0, 200))); return json(200, { result }); }
    json(404, { error: 'not found' });
  } catch (e) { log('fail', e.message); json(500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => log('live voice on http://127.0.0.1:' + PORT, MODEL, VOICE));
