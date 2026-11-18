// Local addition: knowledge base notes and saved scripts for the bot (files under settings.kb_dir).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import settings from '../settings.js';

const root = (agent) => settings.kb_dir || path.resolve(`./bots/${agent.name}/kb`);
const dir = (agent, sub) => { const d = path.join(root(agent), sub); mkdirSync(d, { recursive: true }); return d; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
const list = (agent, sub, ext) => readdirSync(dir(agent, sub)).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).sort();

export const kbQueries = [
    {
        name: '!listNotes',
        description: 'List the titles of all notes in your knowledge base.',
        perform: function (agent) { const n = list(agent, 'notes', '.md'); return n.length ? 'Notes: ' + n.join(', ') : 'No notes yet.'; }
    },
    {
        name: '!searchNotes',
        description: 'Search your knowledge base notes by keywords and read the best matches. Use before a task you may have learned something about.',
        params: { 'query': { type: 'string', description: 'Keywords to look for.' } },
        perform: function (agent, query) {
            const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
            const hits = list(agent, 'notes', '.md').map(n => {
                const text = readFileSync(path.join(dir(agent, 'notes'), n + '.md'), 'utf8'), low = (n + ' ' + text).toLowerCase();
                return { n, text, score: words.reduce((a, w) => a + (low.split(w).length - 1) + (n.includes(w) ? 3 : 0), 0) };
            }).filter(h => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
            if (!hits.length) return `No notes match "${query}".`;
            return hits.map(h => `## ${h.n}\n${h.text.slice(0, 700)}`).join('\n\n');
        }
    },
    {
        name: '!listScripts',
        description: 'List the names of your saved scripts.',
        perform: function (agent) { const n = list(agent, 'scripts', '.js'); return n.length ? 'Saved scripts: ' + n.join(', ') : 'No saved scripts yet.'; }
    },
];

export const kbActions = [
    {
        name: '!writeNote',
        description: 'Write or append to a note in your knowledge base. Use it for lessons learned, what worked or failed, and facts worth keeping. Do not use double quotes inside the text.',
        params: {
            'title': { type: 'string', description: 'Short title of the note.' },
            'text': { type: 'string', description: 'The text to save.' }
        },
        perform: async function (agent, title, text) {
            const f = path.join(dir(agent, 'notes'), slug(title) + '.md'), had = existsSync(f);
            const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
            writeFileSync(f, (had ? readFileSync(f, 'utf8') + '\n' : `# ${title}\n`) + `\n- ${stamp}: ${text}\n`);
            return `${had ? 'Appended to' : 'Created'} note "${slug(title)}".`;
        }
    },
    {
        name: '!saveScript',
        description: 'Save the code from your last successful !newAction as a named script so you can run it again later.',
        params: { 'name': { type: 'string', description: 'Short name for the script.' } },
        perform: async function (agent, name) {
            const code = agent.coder.last_code;
            if (!code) return 'Nothing to save: no !newAction has succeeded since the last restart.';
            writeFileSync(path.join(dir(agent, 'scripts'), slug(name) + '.js'), code.trim() + '\n');
            return `Saved script "${slug(name)}".`;
        }
    },
    {
        name: '!runScript',
        description: 'Run one of your saved scripts by name.',
        params: { 'name': { type: 'string', description: 'Name of the saved script.' } },
        perform: async function (agent, name) {
            if (!settings.allow_insecure_coding) return 'Scripts are disabled in settings.';
            const f = path.join(dir(agent, 'scripts'), slug(name) + '.js');
            if (!existsSync(f)) return `No script named "${slug(name)}". Saved scripts: ${list(agent, 'scripts', '.js').join(', ') || 'none'}.`;
            let result = '';
            const fn = async () => {
                try { result = await agent.coder.runSaved(readFileSync(f, 'utf8')); }
                catch (e) { result = 'Script threw an error: ' + e.toString() + '\nOutput so far:\n' + agent.actions.getBotOutputSummary(); }
            };
            await agent.actions.runAction('action:runScript', fn, { timeout: settings.code_timeout_mins });
            return result;
        }
    },
];

// Local addition: full access. Shell and file commands run as the user, outside the script sandbox.
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
const home = () => path.dirname(root({ name: 'x' }));
const abs = (p) => path.isAbsolute(p) ? p : path.resolve(home(), String(p).replace(/^~(?=\/|$)/, process.env.HOME));
const clip = (s, n = 3000) => s.length > n ? s.slice(0, n / 2) + `\n... [${s.length - n} chars cut] ...\n` + s.slice(-n / 2) : s;
const libSrc = (f) => readFileSync(fileURLToPath(new URL('../library/' + f, import.meta.url)), 'utf8');

kbQueries.push(
    {
        name: '!readScript',
        description: 'Read the code of one of your saved scripts.',
        params: { 'name': { type: 'string', description: 'Name of the saved script.' } },
        perform: function (agent, name) {
            const f = path.join(dir(agent, 'scripts'), slug(name) + '.js');
            return existsSync(f) ? clip(readFileSync(f, 'utf8')) : `No script named "${slug(name)}".`;
        }
    },
    {
        name: '!readSkill',
        description: 'Read the source code of a built-in skill or world function, for example followPlayer or collectBlock, to see how it really works.',
        params: { 'name': { type: 'string', description: 'Function name without the skills. or world. prefix.' } },
        perform: function (agent, name) {
            name = String(name).replace(/^(skills|world)\./, '');
            for (const f of ['skills.js', 'world.js']) {
                const src = libSrc(f), i = src.search(new RegExp('export (async )?function ' + name.replace(/\W/g, '') + '\\('));
                if (i < 0) continue;
                const j = src.indexOf('\nexport ', i + 10);
                return `From library/${f}:\n` + clip(src.slice(i, j < 0 ? undefined : j), 4000);
            }
            return `No built-in function named "${name}".`;
        }
    },
    {
        name: '!readFile',
        description: 'Read any file on this computer. Relative paths start at the project folder; your own source code is under mindcraft/src.',
        params: { 'path': { type: 'string', description: 'File path.' } },
        perform: function (agent, p) {
            try { return clip(readFileSync(abs(p), 'utf8'), 4000); } catch (e) { return 'Could not read: ' + e.message; }
        }
    },
);

kbActions.push(
    {
        name: '!shell',
        description: 'Run a shell command on this computer (zsh, as the owner) and get its output. Starts in the project folder. Use single quotes inside the command, never double quotes. 60 second limit.',
        params: { 'command': { type: 'string', description: 'The command line to run.' } },
        perform: async function (agent, command) {
            // API keys stay with this process: the user asked that they never land in prompts or logs
            const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET/i.test(k)));
            return await new Promise((resolve) => {
                execFile('/bin/zsh', ['-lc', String(command)], { cwd: home(), env, timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, out, errout) => {
                    const code = err ? (err.killed ? 'timed out' : 'exit ' + (err.code ?? '?')) : 'exit 0';
                    resolve(`[${code}]\n` + clip(((out || '') + (errout ? '\n[stderr]\n' + errout : '')).trim() || '(no output)'));
                });
            });
        }
    },
    {
        name: '!writeFile',
        description: 'Write text to any file on this computer, replacing it. Relative paths start at the project folder. The text cannot contain double quotes; for code that needs them use !shell with a heredoc.',
        params: {
            'path': { type: 'string', description: 'File path.' },
            'text': { type: 'string', description: 'Full new content of the file.' }
        },
        perform: async function (agent, p, text) {
            try { const f = abs(p); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); return `Wrote ${text.length} chars to ${f}.`; }
            catch (e) { return 'Could not write: ' + e.message; }
        }
    },
);

// Local addition: separate Hermes agent sessions (Luna, Sol or Astra) started by the bot.
import { spawn } from 'child_process';
import { openSync, closeSync } from 'fs';
const MODELS = { luna: 'gpt-6-luna', sol: 'gpt-6.1-sol', astra: 'gpt-6-astra' };
const workers = new Map();
const wfile = (agent, id, ext) => path.join(dir(agent, 'agents'), id + ext);
const wread = (agent, id) => { try { return JSON.parse(readFileSync(wfile(agent, id, '.json'), 'utf8')); } catch { return null; } };
const wout = (agent, id) => { try { return readFileSync(wfile(agent, id, '.log'), 'utf8').replace(/^session_id:.*$/m, '').trim(); } catch { return ''; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wstatus = (agent, id) => {
    const w = wread(agent, id); if (!w) return null;
    if (w.status === 'running' && !alive(w.pid)) { w.status = 'ended (bot restarted meanwhile, see output)'; }
    return w;
};

kbQueries.push(
    {
        name: '!listAgents',
        description: 'List the separate agent sessions you started and whether each is running or finished.',
        perform: function (agent) {
            const ids = list(agent, 'agents', '.json');
            if (!ids.length) return 'No agent sessions started yet.';
            return ids.slice(-12).map(id => { const w = wstatus(agent, id); return `${id} [${w.model}] ${w.status}: ${w.task.slice(0, 80)}`; }).join('\n');
        }
    },
    {
        name: '!checkAgent',
        description: 'Check one agent session you started: its status and what it has reported so far.',
        params: { 'id': { type: 'string', description: 'The agent id returned by !startAgent.' } },
        perform: function (agent, id) {
            const w = wstatus(agent, slug(id)); if (!w) return `No agent with id "${id}". Use !listAgents.`;
            return `${w.id} [${w.model}] ${w.status}, started ${w.started}.\nTask: ${w.task}\nOutput:\n` + (clip(wout(agent, w.id), 2500) || '(nothing yet; it reports when it finishes)');
        }
    },
);

kbActions.push(
    {
        name: '!startAgent',
        description: 'Start a separate Hermes agent session that works on its own in the background on this computer, with its own tools (shell, files, web). Use it for long or heavy work: research, reading or changing code, writing files. It cannot control your body in the game. You are told when it finishes. Models: luna (fast, default choice), sol (stronger), astra (strongest, slowest). Do not use double quotes in the task.',
        params: {
            'model': { type: 'string', description: 'luna, sol or astra.' },
            'task': { type: 'string', description: 'Complete, self-contained instructions. The agent knows nothing about this conversation.' }
        },
        perform: async function (agent, model, task) {
            const key = String(model).toLowerCase().replace(/[^a-z]/g, '');
            if (!MODELS[key]) return `Unknown model "${model}". Use luna, sol or astra.`;
            const id = key + '-' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
            const brief = `You are a background worker started by ${agent.name}, a Minecraft bot built on Mindcraft, on its owner's Mac. `
                + `Project folder: ${home()} (bot source in mindcraft/src, the bot's notes and scripts in kb/). You cannot act in the game. `
                + `Do the task below, then end with a plain summary of at most four sentences: what you did, what you verified, and any file paths.\n\nTask: ${task}`;
            writeFileSync(wfile(agent, id, '.task.txt'), brief);
            const fd = openSync(wfile(agent, id, '.log'), 'w');
            const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET/i.test(k)));
            let child;
            try {
                child = spawn('/bin/zsh', ['-lc', 'exec hermes chat -Q --oneshot --provider openai-codex -m "$1" --in "$2" --query-file "$3"', 'worker', MODELS[key], home(), wfile(agent, id, '.task.txt')],
                    { cwd: home(), env, stdio: ['ignore', fd, fd], detached: true });
            } catch (e) { closeSync(fd); return 'Could not start the agent: ' + e.message; }
            closeSync(fd);
            const rec = { id, model: MODELS[key], task: String(task), pid: child.pid, started: new Date().toISOString().slice(0, 19), status: 'running' };
            const save = () => writeFileSync(wfile(agent, id, '.json'), JSON.stringify(rec, null, 2));
            save(); workers.set(id, child);
            child.on('error', (e) => { rec.status = 'failed to start: ' + e.message; save(); });
            child.on('exit', (code) => {
                rec.status = code === 0 ? 'finished' : `stopped (exit ${code})`; rec.ended = new Date().toISOString().slice(0, 19); save(); workers.delete(id);
                const out = wout(agent, id);
                agent.handleMessage('system', `Your agent ${id} (${rec.model}) has ${rec.status}. Its report:\n${clip(out, 1500) || '(empty)'}\nTell the player the result in one or two sentences.`, 2)
                    .catch(e => console.error('agent report failed', e));
            });
            child.unref();
            return `Started agent ${id} on ${MODELS[key]}. It is working in the background; you will be told when it finishes. Check it with !checkAgent("${id}").`;
        }
    },
);
