// Local, append-only KB transcript. No model calls, network, or history replay.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const states = new WeakMap();
const sensitive = /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:password|passwd|secret|token|api[ _-]?key|authorization|bearer|cookie|credential|private[ _-]?key)\b|[a-z][a-z0-9+.-]*:\/\/[^\s/]+:[^\s/]+@/i;

export function safeText(value) {
    const text = String(value ?? '');
    if (sensitive.test(text)) return '[omitted: potentially sensitive message]';
    // Commands can contain arbitrary source, notes, credentials or tool output.
    if (/![A-Za-z]+/.test(text)) return '[omitted: command payload]';
    return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 8000)
        + (text.length > 8000 ? ' [truncated]' : '');
}

export function logConversation(agent, settings, direction, speaker, content, recipient = '') {
    if (settings.kb_conversation_logging === false || !String(content ?? '').trim()) return false;
    let state = states.get(agent);
    if (!state) { state = { recent: new Map(), warned: false }; states.set(agent, state); }
    try {
        const now = Date.now();
        const entry = {
            direction, speaker: safeText(speaker).slice(0, 100),
            recipient: safeText(recipient).slice(0, 100), text: safeText(content),
        };
        // Hash raw input only in memory: distinct omitted messages still get entries.
        const key = createHash('sha256').update(JSON.stringify([direction, speaker, recipient, content])).digest('hex');
        for (const [k, time] of state.recent) if (now - time >= 2000) state.recent.delete(k);
        if (state.recent.has(key)) return false;
        const root = settings.kb_dir || path.resolve(`./bots/${agent.name}/kb`);
        const dir = path.join(root, 'notes');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const timestamp = new Date(now).toISOString();
        const name = String(agent.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'bot';
        const file = path.join(dir, `conversation-${name}-${timestamp.slice(0, 10)}.md`);
        appendFileSync(file, '- ' + JSON.stringify({ timestamp, ...entry }) + '\n', { encoding: 'utf8', mode: 0o600 });
        if (state.recent.size >= 256) state.recent.delete(state.recent.keys().next().value);
        state.recent.set(key, now);
        return true;
    } catch {
        // Never include the exception or message: either could contain secrets.
        if (!state.warned) { console.warn('KB conversation logging failed; conversation will continue.'); state.warned = true; }
        return false;
    }
}
