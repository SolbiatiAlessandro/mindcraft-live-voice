// Loopback-only voice input for Badcock: browser mic -> OpenAI transcription -> MindServer message as the owner.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(here + '../mindcraft/package.json');
const { io } = require('socket.io-client');
const PORT = 8793, OWNER = 'a16i', AGENT = 'Badcock', KEY = process.env.OPENAI_API_KEY;
const STT_MODEL = process.env.STT_MODEL || 'gpt-4o-mini-transcribe';
if (!KEY) { console.error('no OPENAI_API_KEY'); process.exit(3); }
const sock = io('http://localhost:8791');
sock.on('connect', () => console.log('mindserver connected')); sock.on('disconnect', () => console.log('mindserver disconnected'));
const busy = () => new Promise(r => execFile('pgrep', ['-x', 'afplay'], (e) => r(!e)));
async function transcribe(buf, type) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), 'speech.' + (type.includes('mp4') ? 'mp4' : type.includes('mpeg') ? 'mp3' : 'webm'));
  fd.append('model', STT_MODEL); fd.append('language', 'en');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: fd });
  const j = await r.json(); if (!r.ok) throw new Error('stt ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return (j.text || '').trim();
}
http.createServer(async (req, res) => {
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(readFileSync(here + 'index.html')); }
  if (req.method === 'GET' && url.pathname === '/busy') return json(200, { busy: await busy(), agent: sock.connected });
  if (req.method === 'POST' && url.pathname === '/say') {
    const chunks = []; for await (const c of req) chunks.push(c);
    try {
      const text = await transcribe(Buffer.concat(chunks), (req.headers['content-type'] || 'audio/webm').split(';')[0]);
      const dry = url.searchParams.has('dry'), ok = text.replace(/[^a-z0-9]/gi, '').length >= 2;
      if (ok && !dry) sock.emit('send-message', AGENT, { from: OWNER, message: text });
      console.log(new Date().toISOString(), dry ? 'dry' : ok ? 'sent' : 'skipped', JSON.stringify(text));
      return json(200, { text, sent: ok && !dry });
    } catch (e) { console.log(new Date().toISOString(), 'fail', e.message); return json(500, { error: e.message }); }
  }
  json(404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log('voice-in on http://127.0.0.1:' + PORT));
