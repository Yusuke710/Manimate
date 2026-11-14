import sys,json,time,urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts/manim-cloud'))
import cloud_auth,render
root=Path(__file__).parent;project=Path.home()/'.manimate/sessions/profile-gpt2-css-e7e5b728/project'
base=json.loads(cloud_auth.credential_path().read_text())['base_url'];token=cloud_auth.token(base)
files={n:(project/n).read_text() for n in ['script.py','timestamps.json']};files['cpu_eval.py']=(root/'render_cpu_job.py').read_text()
body=json.dumps({'files':files,'command':['python','cpu_eval.py'],'outputs':['cpu-results.json'],'timeout_seconds':480,'title':'Temporary render CPU audit'}).encode()
import uuid
job=render.request(base+'/renders',token,body,str(uuid.uuid4()));(root/'cpu-job.json').write_text(json.dumps({'id':job['id']},indent=2));print('CPU evaluation job:',job['id'],flush=True)
while True:
 result=render.request(job['status_url'],token)
 if result['status'] in ('succeeded','failed'):break
 time.sleep(3)
(root/'cpu-job-status.json').write_text(json.dumps({k:v for k,v in result.items() if k not in ['files','stdout','stderr']},indent=2))
if result['status']!='succeeded':print(result.get('stderr','')[-2000:]);raise RuntimeError(result.get('error','CPU evaluation failed'))
for f in result['files']:
 if f['path']=='cpu-results.json':
  req=urllib.request.Request(f['url'],headers={'User-Agent':'manimate-render/1.0'})
  with urllib.request.urlopen(req) as r:(root/'render-cpu-results.json').write_bytes(r.read())
print((root/'render-cpu-results.json').read_text(),flush=True)
req=urllib.request.Request(base+'/videos/'+job['id'],method='DELETE',headers={'Authorization':'Bearer '+token,'User-Agent':'manimate-render/1.0'})
with urllib.request.urlopen(req) as r:print('Temporary render job cleaned:',r.status)
