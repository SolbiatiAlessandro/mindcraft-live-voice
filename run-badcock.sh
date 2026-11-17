#!/bin/bash
# Launch Mindcraft as Badcock. Requires the bot entrance reachable at $HOST:$PORT
# (SSM port-forward to the Minecraft host's 127.0.0.1:25564). One instance only.
set -euo pipefail
W="$(cd "$(dirname "$0")" && pwd)"
HOST="${HOST:-127.0.0.1}"; PORT="${PORT:-25564}"
M="$( { pgrep -fl "^node main.js --mindcraft-badcock-main"; pgrep -fl "^$W/node20/bin/node $W/mindcraft/src/process/init_agent.js"; } 2>/dev/null | grep -v pgrep || true)"
if [ -n "$M" ]; then echo "refusing: a Mindcraft Badcock process is already running:" >&2; echo "$M" >&2; exit 2; fi
export PATH="$W/node20/bin:$PATH"
export SETTINGS_JSON="$(python3 -c "import json,sys;d=json.load(open('$W/config/settings.first-contact.json'));d['host']='$HOST';d['port']=int('$PORT');print(json.dumps(d))")"
# OpenAI key: read from the Hermes env file and given to this process only; never printed or logged
OPENAI_API_KEY="$(python3 - <<'PY'
import os,re
k=''
for line in open(os.path.expanduser('~/.hermes/.env')):
    m=re.match(r'\s*(?:export\s+)?VOICE_TOOLS_OPENAI_KEY\s*=\s*(.*)',line)
    if m: k=m.group(1).strip().strip('"').strip("'")
print(k,end='')
PY
)"
[ -n "$OPENAI_API_KEY" ] || { echo "VOICE_TOOLS_OPENAI_KEY not found in ~/.hermes/.env" >&2; exit 3; }
export OPENAI_API_KEY
cd "$W/mindcraft"
LOG="$W/logs/run-$(date +%Y%m%dT%H%M%S).log"
echo "log: $LOG"
# the trailing marker arg only labels the process for stop-badcock.sh
exec node main.js --mindcraft-badcock-main >"$LOG" 2>&1
