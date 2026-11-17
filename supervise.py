#!/usr/bin/env python3
"""Keeps the SSM tunnel and the Mindcraft Badcock process up. Detached from Hermes on purpose.
Before every bot launch it checks on the host that zero Badcock bodies are online and the Orb is off.
Stop with stop-badcock.sh (kills this first)."""
import json, os, subprocess, time
W = os.path.dirname(os.path.abspath(__file__)); H = W + '-handoff'
C = json.load(open(W + '/local.json'))  # server details, kept out of git
B = ['--profile', C['aws_profile'], '--region', C['aws_region']]; I = C['instance_id']
def log(m):
    with open(W + '/logs/supervise.log', 'a') as f: f.write(time.strftime('%Y-%m-%dT%H:%M:%S%z ') + m + '\n')
def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()
def tunnel_up(): return bool(sh('lsof -nP -iTCP:25564 -sTCP:LISTEN | tail -n +2'))
def bot_up(): return bool(sh("pgrep -f '^node main.js --mindcraft-badcock-main'"))
def start_tunnel():
    env = dict(os.environ, PATH=W + '/ssm-plugin/sessionmanager-bundle/bin:' + os.environ['PATH'])
    subprocess.Popen(['aws', 'ssm', 'start-session', *B, '--target', I, '--document-name', 'AWS-StartPortForwardingSession',
                      '--parameters', '{"portNumber":["25564"],"localPortNumber":["25564"]}'],
                     env=env, stdin=subprocess.DEVNULL, stdout=open(W + '/logs/tunnel.log', 'a'), stderr=subprocess.STDOUT, start_new_session=True)
def host_clear():
    r = subprocess.run(['aws', 'ssm', 'send-command', *B, '--instance-ids', I, '--document-name', 'AWS-RunShellScript', '--comment', 'read-only check own Orb absent before relaunch',
                        '--parameters', 'file://' + H + '/precheck-params.json', '--query', 'Command.CommandId', '--output', 'text'], capture_output=True, text=True)
    cid = r.stdout.strip()
    if not cid: log('host check failed to send: ' + r.stderr.strip()[:200]); return False
    for _ in range(15):
        time.sleep(3)
        g = subprocess.run(['aws', 'ssm', 'get-command-invocation', *B, '--command-id', cid, '--instance-id', I, '--output', 'json'], capture_output=True, text=True)
        try: d = json.loads(g.stdout)
        except Exception: continue
        if d['Status'] in ('Pending', 'InProgress'): continue
        try:
            host, _, adm = d['StandardOutputContent'].partition('===ADM===')
            pres = [l['presence'] for l in json.loads(host)['candidate_links']]; a = json.loads(adm.strip())
            ok = a['ownBodyOnlineCount'] == 0 and all(p == 'off' for p in pres)
            log('host check %s: bodies=%s presence=%s -> %s' % (cid, a['ownBodyOnlineCount'], pres, 'clear' if ok else 'NOT clear'))
            return ok
        except Exception as e: log('host check parse error: %r' % e); return False
    return False
log('supervisor start pid %d' % os.getpid()); last = 0
while True:
    try:
        if not tunnel_up():
            log('tunnel down, starting'); start_tunnel(); time.sleep(8)
        elif not bot_up() and time.time() - last > 45:
            last = time.time(); log('bot down, checking host')
            if host_clear() and not bot_up() and tunnel_up():
                subprocess.Popen([W + '/run-badcock.sh'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True); log('bot launched')
    except Exception as e: log('error %r' % e)
    time.sleep(5)
