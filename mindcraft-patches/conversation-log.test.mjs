import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { logConversation, safeText } from './conversation-log.mjs';

const project = new URL('../', import.meta.url);
const scratch = process.env.TMPDIR;
assert.ok(scratch, 'TMPDIR must point to the local scratch directory');
const root = mkdtempSync(path.join(scratch, 'conversation-log-test-'));
const settings = { kb_dir: root };
const agent = { name: 'Badcock' };
const entries = () => readdirSync(path.join(root, 'notes')).flatMap(name =>
    readFileSync(path.join(root, 'notes', name), 'utf8').trim().split('\n').map(line => JSON.parse(line.slice(2))));

test('append, short-window dedupe, different sender/direction, private file', () => {
    assert.equal(logConversation(agent, settings, 'in', 'owner', 'hello'), true);
    assert.equal(logConversation(agent, settings, 'in', 'owner', 'hello'), false);
    assert.equal(logConversation(agent, settings, 'out', 'owner', 'hello'), true);
    assert.equal(logConversation(agent, settings, 'in', 'other', 'hello'), true);
    assert.equal(entries().length, 3);
    for (const name of readdirSync(path.join(root, 'notes')))
        assert.equal(statSync(path.join(root, 'notes', name)).mode & 0o777, 0o600);
});

test('omit sensitive content, command payloads and bound text', () => {
    for (const text of ['password: hunter2', 'sk-' + 'a'.repeat(30), 'Authorization: Bearer abc',
        'https://user:pass@example.test', '-----BEGIN RSA PRIVATE KEY-----', 'api_key=abc']) {
        assert.match(safeText(text), /potentially sensitive/);
        logConversation(agent, settings, 'in', 'owner', text);
    }
    assert.match(safeText('please !writeNote("note", "hidden value")'), /command payload/);
    assert.match(safeText('x'.repeat(9000)), /\[truncated\]$/);
    assert.ok(!JSON.stringify(entries()).includes('hunter2'));
});

test('opt-out, blank input, and failure never escape into conversation', () => {
    assert.equal(logConversation(agent, { ...settings, kb_conversation_logging: false }, 'in', 'owner', 'disabled'), false);
    assert.equal(logConversation(agent, settings, 'in', 'owner', '  '), false);
    const blocked = path.join(root, 'not-a-directory');
    writeFileSync(blocked, 'test');
    assert.equal(logConversation(agent, { kb_dir: blocked }, 'in', 'owner', 'failed'), false);
});

test('real Agent methods archive inputs before commands, output once, no system prompts', async () => {
    let source = readFileSync(new URL('mindcraft/src/agent/agent.js', project), 'utf8');
    source = source.replace(/^import .*;\r?\n/gm, '').replace('export class Agent', 'class Agent');
    const calls = [];
    const Agent = vm.runInNewContext(source + '\nAgent;', {
        logConversation: (...args) => calls.push(args), settings: { only_chat_with: [], chat_ingame: false },
        convoManager: { isOtherAgent: name => name === 'OtherBot' },
        handleTranslation: async text => text, containsCommand: () => null,
        sendOutputToServer: () => {}, console,
    });
    const a = new Agent(); a.name = 'Badcock'; a.checkTaskDone = async () => { throw new Error('test stop'); };
    for (const sender of ['owner', 'system', 'Badcock', 'OtherBot'])
        await assert.rejects(a.handleMessage(sender, '!stop'), /test stop/);
    assert.equal(calls.length, 1); assert.equal(calls[0][4], '!stop');
    await a.openChat('hi'); assert.equal(calls.length, 2);
    await a.openChat('bot public mirror', false); assert.equal(calls.length, 2);
});

test('real bot conversation methods archive direct send and receive without echo duplication', async () => {
    let source = readFileSync(new URL('mindcraft/src/agent/conversation.js', project), 'utf8');
    source = source.replace(/^import .*;\r?\n/gm, '').replace('export default convoManager;', '');
    const calls = []; const echoes = [];
    const manager = vm.runInNewContext(source + '\nconvoManager;', {
        logConversation: (...args) => calls.push(args), settings: { chat_bot_messages: true },
        sendBotChatToServer: () => {}, console,
    });
    manager.initAgent({ name: 'Badcock', openChat: (...args) => echoes.push(args) });
    manager.updateAgents([{ name: 'OtherBot', in_game: true }]);
    manager.sendToBot('OtherBot', 'hello');
    assert.equal(calls.length, 1); assert.equal(calls[0][2], 'out'); assert.equal(echoes[0][1], false);
    manager._getConvo('OtherBot').ignore_until_start = true;
    await manager.receiveFromBot('OtherBot', { message: 'reply' });
    assert.equal(calls.length, 2); assert.equal(calls[1][2], 'in');
});

test.after(() => rmSync(root, { recursive: true, force: true }));
