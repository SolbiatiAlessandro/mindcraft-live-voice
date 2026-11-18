# mindcraft-live-voice

Talk to a Minecraft bot out loud. A [Mindcraft](https://github.com/mindcraft-bots/mindcraft) agent plays in the game, an OpenAI live voice model (`gpt-live-1`) holds the spoken conversation, and anything the player asks the bot to *do* is handed to the Mindcraft agent (running `gpt-6-luna`).

Checkpoint of a toy project, built in one afternoon. It runs on one Mac against one private server; expect to adapt it.

## What is here

| Path | What it does |
|---|---|
| `voice/live.mjs`, `voice/live.html` | Loopback web page for the live voice call. The server posts the WebRTC offer to OpenAI so the key never reaches the browser, and forwards delegated requests to Mindcraft's MindServer socket. |
| `voice/live.realtime.bak.*` | The earlier version of the same bridge on the Realtime API. |
| `mindcraft-patches/changes.patch` | Changes to Mindcraft at commit `e1c1fc3`: pin Mineflayer 4.33.0, re-read the version pin at bot start, reply in public chat, speak through an external command, play TTS with `afplay`, keep the last working script. |
| `mindcraft-patches/kb.js` | New bot commands: `!writeNote`, `!searchNotes`, `!listNotes`, `!saveScript`, `!runScript`, `!listScripts`. Notes and scripts are files under `kb/`. |
| `config/` | Bot profile and settings. The profile prompt tells the bot to retry failed commands, write scripts with `!newAction`, and keep notes. |
| `run-badcock.sh`, `stop-badcock.sh`, `run-voice.sh` | Launchers. The OpenAI key is read from an env file at launch and passed only to the process. |
| `supervise.py` | Keeps the tunnel and the bot up. |
| `say-badcock.py` | Posts the bot's chat with `tellraw` over RCON, for servers that drop unsigned chat from offline-mode bots. |
| `adapter/` | Unused experiment: a shim to run the bot on a Claude subscription. |

## Setup, roughly

1. Install Node 20 into `node20/` and clone Mindcraft into `mindcraft/` at `e1c1fc3`.
2. `git -C mindcraft apply ../mindcraft-patches/changes.patch`, copy `mindcraft-patches/kb.js` to `mindcraft/src/agent/commands/`, then `npm install` in `mindcraft/`.
3. Copy `local.example.json` to `local.json` and fill in your server details. `supervise.py` and `say-badcock.py` assume the server is reached through an AWS SSM port-forward; replace that part if yours is not.
4. Fix the absolute paths and the player name in `config/settings.first-contact.json` and `voice/live.mjs`.
5. Run `supervise.py`, then `run-voice.sh`, and open `http://127.0.0.1:8793`.

## What the bot can do beyond game commands

All of this lives in `mindcraft-patches/kb.js` (copied to `mindcraft/src/agent/commands/kb.js`).

- Notes: `!writeNote`, `!searchNotes`, `!listNotes` (files in `kb/notes/`).
- Scripts: `!newAction` writes and runs one, `!saveScript`, `!runScript`, `!listScripts`, `!readScript` (files in `kb/scripts/`).
- Full access to the machine it runs on: `!shell`, `!readFile`, `!writeFile`, `!readSkill`. API keys are left out of the shell environment, nothing else is restricted.
- Separate agent sessions: `!startAgent(model, task)` starts a background Hermes session (`luna`, `sol` or `astra`) with its own shell, file and web tools; the bot is told when it finishes. `!listAgents`, `!checkAgent`. Task, status and report of each one are kept in `kb/agents/`. This needs the `hermes` command line and a Codex login.

`kb/` in this repo is a snapshot of what the bot wrote itself on the first afternoon.

## Vision and scripted chat

Apply `mindcraft-patches/vision-and-chat.patch` after the other two patches.

- Vision: `allow_vision` is on. `!lookAtPlayer` and `!lookAtPosition` render a screenshot of the bot's view and send it to the chat model. The stock OpenAI image request turned the image into the text "[object Object]"; the patch sends it properly.
- Chat from scripts: the server drops chat from offline bots, so `bot.chat()` is rerouted through `say_command`. Before this, scripts the bot wrote to "say" something ran without error and nobody saw the text.

## Automatic conversation archive

The local `agent.js` and `conversation.js` hooks append handled player messages,
outgoing chat attempts, and direct bot-to-bot messages to
`kb/notes/conversation-Badcock-YYYY-MM-DD.md` (UTC). These are ordinary searchable
notes for `!listNotes` and `!searchNotes`; no additional KB service is needed.
The logger is `mindcraft-patches/conversation-log.mjs`. On a fresh checkout,
apply `git -C mindcraft apply ../mindcraft-patches/conversation-logging.patch`
after the existing setup patch, keeping this parent-directory layout.
A running bot must restart to load these hooks; this change does not restart it.
Set `kb_conversation_logging` to `false` in bot settings to opt out.

Safety and scope:

- Sensitive-looking messages and command payloads are replaced with omission
  markers, not stored verbatim. Filtering is conservative and best-effort, not a
  guarantee against arbitrary unlabelled secrets; do not send credentials in chat.
- Entries are append-only, bounded to 8,000 characters, and new files have mode
  `0600`. Runtime notes are already git-ignored. There is no automatic deletion.
- Identical direction/speaker/recipient/content within two seconds is suppressed;
  intentional repetitions in that window are also suppressed. Public mirrors of
  bot-to-bot sends are not archived twice. No history backfill or replay occurs.
- Internal system prompts, tool results and model reasoning are not archived.
  Messages may already have been translated by Mindcraft. Output records are
  attempts to speak/send, not confirmation that Minecraft delivered them.
- This covers Mindcraft's handled conversations, not all server chat or live-voice
  small talk handled entirely in the browser. No audio or browser transcripts are
  exposed to these hooks, so a complete voice archive is not supported here.
- Logging errors warn once per agent without exposing message/error contents or
  interrupting play. Synchronous appends are intended for low-volume local chat.

Verification: `node20/bin/node --test mindcraft-patches/conversation-log.test.mjs`.
Tests use temporary files under `TMPDIR`, not the real knowledge base, and exercise
redaction, duplicate suppression, opt-out, file permissions, write failures, and
real Agent/ConversationManager method bodies with game/network dependencies stubbed.

## Warnings

- The bot has an unrestricted shell and file access as your user, and can start agents that do too. Run it only where you would run a coding agent with full permissions.
- `allow_insecure_coding` is on: the bot writes and runs JavaScript on your machine, inside Mindcraft's sandbox.
- The live voice session is billed per minute while the page is connected.
- `say-badcock.py` writes to the server console over RCON.

Mindcraft is MIT licensed; the patch is a derivative of it.
