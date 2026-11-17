// Text-only check of the live session config and the tool round trip (no audio).
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url)); const require = createRequire(here + '../mindcraft/package.json'); const WebSocket = require('ws');
const src = (await import('node:fs')).readFileSync(here + 'live.mjs', 'utf8');
const m = src.match(/export const SESSION = (\{[\s\S]*?\n\});/); const OWNER = 'a16i', MODEL = 'gpt-realtime-2.1', VOICE = 'cedar';
const SESSION = eval('(' + m[1] + ')'); SESSION.output_modalities = ['text'];
const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=' + MODEL, { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY } });
const send = (o) => ws.send(JSON.stringify(o)); const ask = process.argv[2] || 'What is in your inventory right now?';
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 70000);
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(1); });
ws.on('open', () => send({ type: 'session.update', session: SESSION }));
ws.on('message', async (raw) => {
  const ev = JSON.parse(raw);
  if (ev.type === 'error') console.log('ERROR', JSON.stringify(ev.error).slice(0, 400));
  else if (ev.type === 'session.updated') { console.log('session ok; tools:', ev.session.tools.map(t => t.name)); send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: ask }] } }); send({ type: 'response.create' }); }
  else if (ev.type === 'response.function_call_arguments.done') {
    console.log('tool call:', ev.name, ev.arguments); ws._busy = true; ws._called = true;
    const r = await (await fetch('http://127.0.0.1:8793/tell', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(JSON.parse(ev.arguments)) })).json();
    console.log('tool result:', r.result.slice(0, 400)); ws._busy = false;
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: r.result } }); send({ type: 'response.create' });
  }
  else if (ev.type === 'response.output_text.done') { console.log('voice model says:', ev.text); }
  else if (ev.type === 'response.done') {
    const calls = (ev.response.output || []).some(o => o.type === 'function_call');
    if (!calls && !ws._busy) { console.log('done'); process.exit(0); }
  }
});
