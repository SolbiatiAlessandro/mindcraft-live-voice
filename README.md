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

## Warnings

- `allow_insecure_coding` is on: the bot writes and runs JavaScript on your machine, inside Mindcraft's sandbox.
- The live voice session is billed per minute while the page is connected.
- `say-badcock.py` writes to the server console over RCON.

Mindcraft is MIT licensed; the patch is a derivative of it.
