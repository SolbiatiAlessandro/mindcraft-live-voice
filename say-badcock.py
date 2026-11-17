#!/usr/bin/env python3
"""Post one line of Badcock speech to public chat.

The server drops chat from offline bots (no signed chat profile), so this mirrors the Orb's own
transport: `tellraw @a` over RCON, run on the host through SSM. The RCON secret never leaves the host.
Text arrives on stdin and is only ever passed as base64-encoded JSON data, never as a command.
"""
import base64, json, os, re, subprocess, sys, time
W = os.path.dirname(os.path.abspath(__file__))
NAME = 'Badcock'
C = json.load(open(os.path.join(W, 'local.json')))  # server details, kept out of git
text = re.sub(r'[\x00-\x1f\x7f\u00a7]', ' ', sys.stdin.read()).strip()
if not text: sys.exit(0)
parts = [text[i:i + 230] for i in range(0, min(len(text), 920), 230)]
b64 = base64.b64encode(json.dumps(parts).encode()).decode()
js = ('import {rcon} from "%s"; import {readFileSync} from "node:fs"; '
      'const parts=JSON.parse(Buffer.from(process.argv[1],"base64").toString("utf8")); '
      'const commands=parts.map(t=>"tellraw @a "+JSON.stringify({text:"<%s> "+t,color:"aqua"})); '
      'await rcon({password:readFileSync("%s","utf8").trim(),commands}); '
      'console.log("sent",commands.length);') % (C['rcon_tool'], NAME, C['rcon_secret_file'])
cmd = "sudo node --input-type=module -e '%s' '%s'" % (js, b64)
base = ['aws', 'ssm', '--profile', C['aws_profile'], '--region', C['aws_region']]
env = {k: v for k, v in os.environ.items() if 'KEY' not in k and 'TOKEN' not in k}
def log(msg):
    with open(os.path.join(W, 'logs', 'say.log'), 'a') as f: f.write(time.strftime('%Y-%m-%dT%H:%M:%S%z ') + msg + '\n')
r = subprocess.run(base + ['send-command', '--instance-ids', C['instance_id'], '--document-name', 'AWS-RunShellScript',
                           '--comment', 'Badcock speech (tellraw, own Orb)', '--parameters', json.dumps({'commands': [cmd]}),
                           '--query', 'Command.CommandId', '--output', 'text'], capture_output=True, text=True, env=env)
cid = r.stdout.strip()
if not cid: log('FAILED send: ' + r.stderr.strip()[:300]); sys.exit(1)
status, out = 'Pending', ''
for _ in range(10):
    time.sleep(1)
    g = subprocess.run(base + ['get-command-invocation', '--command-id', cid, '--instance-id', C['instance_id'], '--output', 'json'],
                       capture_output=True, text=True, env=env)
    try: d = json.loads(g.stdout)
    except Exception: continue
    status, out = d['Status'], (d['StandardOutputContent'] + d['StandardErrorContent']).strip()
    if status not in ('Pending', 'InProgress'): break
log('%s %s [%s] %r' % (status, cid, out[:120], text[:300]))
sys.exit(0 if status == 'Success' else 1)
