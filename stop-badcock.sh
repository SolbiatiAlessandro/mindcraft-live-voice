#!/bin/bash
pkill -f 'minecraft-mindcraft/supervise.py' 2>/dev/null || true  # stop the keep-alive first so nothing relaunches
# Stop Mindcraft Badcock for good: parent first (it auto-restarts the agent on
# non-SIGINT exits), then the agent child with SIGINT, then verify nothing is left.
W="$(cd "$(dirname "$0")" && pwd)"
pkill -TERM -f "^node main.js --mindcraft-badcock-main" 2>/dev/null
sleep 0.5
pkill -INT -f "^$W/node20/bin/node $W/mindcraft/src/process/init_agent.js" 2>/dev/null
for i in 1 2 3 4 5 6; do
  sleep 0.5
  if ! pgrep -f "^node main.js --mindcraft-badcock-main" >/dev/null && ! pgrep -f "^$W/node20/bin/node $W/mindcraft/src/process/init_agent.js" >/dev/null; then echo "stopped: no Mindcraft Badcock processes"; exit 0; fi
done
pkill -KILL -f "^node main.js --mindcraft-badcock-main" 2>/dev/null; pkill -KILL -f "^$W/node20/bin/node $W/mindcraft/src/process/init_agent.js" 2>/dev/null
sleep 0.5
if pgrep -f "^node main.js --mindcraft-badcock-main" >/dev/null || pgrep -f "^$W/node20/bin/node $W/mindcraft/src/process/init_agent.js" >/dev/null; then echo "FAILED: processes still running" >&2; exit 1; fi
echo "stopped (forced)"
