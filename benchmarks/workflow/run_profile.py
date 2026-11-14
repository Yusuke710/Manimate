"""Run the standard Manimate CLI while timestamping its progress output."""
import json,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent/'gpt2-css'
cfg=json.loads((root/'run-config.json').read_text())
cmd=['node','/Users/ymiy/github/2026/Manimate/scripts/cli.mjs',cfg['prompt'],'--model',cfg['model'],'--aspect',cfg['aspect'],'--voice',cfg['voice'],'--session',cfg['session'],'--base-url','http://127.0.0.1:3022','--show-events']
started=time.time()
(root/'invocation.json').write_text(json.dumps({'command':cmd,'started_at_epoch':started},indent=2))
with (root/'cli-events.jsonl').open('w') as out:
 p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
 for line in p.stdout:
  out.write(json.dumps({'timestamp':time.time(),'line':line.rstrip()})+'\n');out.flush()
  print(line,end='',flush=True)
 code=p.wait()
(root/'completion.json').write_text(json.dumps({'exit_code':code,'finished_at_epoch':time.time(),'elapsed_seconds':time.time()-started},indent=2))
raise SystemExit(code)
