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
