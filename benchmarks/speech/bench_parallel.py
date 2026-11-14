"""End-to-end cold production API benchmark, including remote assembly/cleanup."""
import argparse,base64,concurrent.futures,hashlib,json,os,statistics,sys,time,urllib.request
from pathlib import Path
import subprocess
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/manim-cloud'));import cloud_auth
URL='https://manimate-speech.youfu1202mo.workers.dev'
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--repeats',type=int,default=3);p.add_argument('--concurrency',type=int,default=2);a=p.parse_args();assert a.repeats>=0 and a.concurrency>0;a.out.mkdir(parents=True,exist_ok=True)
# Freeze the narration from the already-completed realistic workflow.
fixture=Path(__file__).with_name('realistic-narration.json')
lines=json.loads(fixture.read_text())
admin=(Path.home()/'.config/manimate-speech/benchmark-token').read_text().strip()
origin=json.loads(cloud_auth.credential_path().read_text())['base_url'];user=cloud_auth.token(origin)
def request(path,body,normal=False):
 headers={'Authorization':'Bearer '+(user if normal else admin),'Content-Type':'application/json','User-Agent':'manimate-render/1.0'}
 if normal:headers['X-Manimate-Auth-Origin']=origin
 req=urllib.request.Request(URL+path,data=json.dumps(body).encode(),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=300) as f:return json.load(f),dict(f.headers)
 except urllib.error.HTTPError as e:raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:500]}') from None

def run(name,workers=None,normal=False):
 start=time.perf_counter()
 try:
  data,headers=request('/v1/audio/narrations'+(f'?workers={workers}' if workers else ''),{'input':lines,'voice':'af_heart','response_format':'mp3'},normal)
  audio=base64.b64decode(data['audio']['base64'],validate=True);elapsed=time.perf_counter()-start
  file=a.out/(name+'.mp3');file.write_bytes(audio)
  pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-f','f32le','-ar','24000','-ac','1','pipe:1']);samples=np.frombuffer(pcm,dtype='<f4')
  times=data['timestamps'];entries=times['subtitles']
  assert [x['text'] for x in entries]==lines and [x['index'] for x in entries]==list(range(len(lines)))
  assert all(abs(x['end_s']-y['start_s'])<1e-8 for x,y in zip(entries,entries[1:]))
  assert abs(len(samples)/24000-times['total_duration_s'])<.0001
  assert abs(entries[0]['start_s'])<1e-8 and abs(entries[-1]['end_s']-times['total_duration_s'])<1e-8
  assert np.isfinite(samples).all() and float(np.sqrt(np.mean(samples**2)))>.001
  lower={k.lower():v for k,v in headers.items()}
  row={'name':name,'normal_auth':normal,'end_to_end_seconds':elapsed,'workers':int(lower['x-speech-workers']),
       'queue_seconds':float(lower['x-speech-queue-seconds']),'pipeline_seconds':float(lower['x-speech-pipeline-seconds']),
       'audio_seconds':len(samples)/24000,'validation':'passed','metrics':data['metrics']}
  (a.out/(name+'.json')).write_text(json.dumps(times,indent=2))
 except Exception as e:row={'name':name,'error':str(e),'end_to_end_seconds':time.perf_counter()-start}
 print(json.dumps(row),flush=True);return row
report={'api':URL,'input_sha256':hashlib.sha256(json.dumps(lines).encode()).hexdigest(),'segments':len(lines),'characters':sum(map(len,lines)),'lifecycle':'Every request shuts down its workers; no warm pool','rows':[]}
def save(): (a.out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
for i in range(a.repeats):
 for mode in (['serial','parallel'] if i%2==0 else ['parallel','serial']):
  report['rows'].append(run(f'{mode}-{i}',1 if mode=='serial' else None));save()
  state,_=request('/admin/status',{});assert state['active']==0 and state['pending']==0,state
with concurrent.futures.ThreadPoolExecutor(max_workers=a.concurrency) as pool:
 report['rows']+=list(pool.map(lambda i:run(f'concurrent-{i}',normal=True),range(a.concurrency)))
report['final_pool_state']=request('/admin/status',{})[0];save()
assert all('error' not in row for row in report['rows']), 'Benchmark failures retained in results.json'
assert report['final_pool_state']['active']==0 and report['final_pool_state']['pending']==0
