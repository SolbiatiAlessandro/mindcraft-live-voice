// Loopback-only OpenAI-compatible shim: forwards each chat completion to the local `claude` CLI
// (Claude subscription login). No API key is read or stored here.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PORT = Number(process.env.ADAPTER_PORT || 8792);
const CWD = fileURLToPath(new URL('./cwd/', import.meta.url));
const text = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text || '').join('') : '';
function ask(system, prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_|ANTHROPIC_)/.test(k)) delete env[k];
    const args = ['-p', '--output-format', 'text', '--max-turns', '1'];
    if (system) args.push('--system-prompt', system);
    const p = spawn('claude', args, { cwd: CWD, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const t = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.on('error', reject);
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`)); });
    p.stdin.end(prompt);
  });
}
http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', async () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return send(404, { error: { message: 'only POST /v1/chat/completions' } });
    try {
      const { messages = [], model = 'claude-sub' } = JSON.parse(body);
      const system = messages.filter(m => m.role === 'system').map(m => text(m.content)).join('\n\n');
      const prompt = messages.filter(m => m.role !== 'system').map(m => `${m.role.toUpperCase()}: ${text(m.content)}`).join('\n\n') || 'Hello';
      const t0 = Date.now(); const content = await ask(system, prompt);
      console.log(new Date().toISOString(), 'ok', Date.now() - t0, 'ms', content.length, 'chars');
      send(200, { id: 'sub-' + t0, object: 'chat.completion', created: Math.floor(t0 / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    } catch (e) { console.log(new Date().toISOString(), 'fail', e.message); send(500, { error: { message: e.message } }); }
  });
}).listen(PORT, '127.0.0.1', () => console.log('claude-sub adapter on 127.0.0.1:' + PORT));
