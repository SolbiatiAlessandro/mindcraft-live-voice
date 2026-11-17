#!/bin/bash
# Voice input for Badcock. Key is read from the Hermes env file and given to this process only.
W="$HOME/.hermes/research/minecraft-mindcraft"
pgrep -f "^$W/node20/bin/node $W/voice/live.mjs" >/dev/null && { echo "already running" >&2; exit 2; }
OPENAI_API_KEY="$(python3 - <<'PY'
import os,re
k=''
for line in open(os.path.expanduser('~/.hermes/.env')):
    m=re.match(r'\s*(?:export\s+)?VOICE_TOOLS_OPENAI_KEY\s*=\s*(.*)',line)
    if m: k=m.group(1).strip().strip('"').strip("'")
print(k,end='')
PY
)"
[ -n "$OPENAI_API_KEY" ] || { echo "key not found" >&2; exit 3; }
export OPENAI_API_KEY
exec "$W/node20/bin/node" "$W/voice/live.mjs" >> "$W/logs/voice-live.log" 2>&1
