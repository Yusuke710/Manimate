#!/usr/bin/env python3
"""Probe Kokoro configurations through the existing Manim Render API.
This measures CPU execution separately from dependency setup and API startup.
"""
import base64
import json
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/manim-cloud'))
import cloud_auth

REMOTE = r'''
import os, sys, subprocess, time, json, urllib.request, statistics, gc
from pathlib import Path
setup = time.perf_counter()
if sys.version_info[:2] != (3,11):
 subprocess.run([sys.executable, '-m', 'pip', 'install', '--quiet', '--target', '/tmp/uv-bootstrap', 'uv'], check=True)
 subprocess.run(['/tmp/uv-bootstrap/bin/uv', 'run', '--python', '3.11',
                 '--with', 'kokoro-onnx==0.5.0', '--with', 'onnxruntime==1.23.2', '--with', 'numpy==2.2.6', '--with', 'imageio-ffmpeg==0.6.0',
                 'python', 'probe.py'], check=True)
 sys.exit(0)
import imageio_ffmpeg
bin_dir=Path('/tmp/speech-bin');bin_dir.mkdir(exist_ok=True)
(bin_dir/'ffmpeg').symlink_to(imageio_ffmpeg.get_ffmpeg_exe())
os.environ['PATH']=str(bin_dir)+os.pathsep+os.environ['PATH']
path=Path('/tmp/speech-models');path.mkdir(exist_ok=True)
base='https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
for name in ['kokoro-v1.0.onnx','kokoro-v1.0.int8.onnx','voices-v1.0.bin']:
 urllib.request.urlretrieve(base+name,path/name)
os.environ['MODEL_DIR']=str(path)
import speech_server as server
cases=json.loads(Path('cases.json').read_text())
report={'setup_seconds':time.perf_counter()-setup,'rows':[],'instance':'standard-3 (2 vCPU, 8 GiB)'}
for quantized,threads in [(False,1),(False,2),(False,4),(True,1),(True,2)]:
 server.MODEL=None;gc.collect()
 os.environ['MODEL_FILE']='kokoro-v1.0.int8.onnx' if quantized else 'kokoro-v1.0.onnx'
 os.environ['TTS_THREADS']=str(threads)
 for name in ['short','medium']:
  for repeat in range(3):
   start=time.perf_counter()
   audio,fmt,times,metrics=server.synthesize({'input':cases[name],'voice':'af_heart'})
   row={'configuration':f'{"int8" if quantized else "fp32"}-t{threads}','case':name,'repeat':repeat,'elapsed_seconds':time.perf_counter()-start,'metrics':metrics}
   report['rows'].append(row)
   print(json.dumps(row),flush=True)
   Path('probe-results.json').write_text(json.dumps(report,indent=2))
   if name=='medium' and repeat==2: Path(f'{"int8" if quantized else "fp32"}-t{threads}.mp3').write_bytes(audio)
'''


def main():
    base = json.loads(cloud_auth.credential_path().read_text())['base_url']
    def request(path, data=None, method=None):
        req = urllib.request.Request(base+path, json.dumps(data).encode() if data is not None else None,
            headers={'Authorization':'Bearer '+cloud_auth.token(base),'Content-Type':'application/json','User-Agent':'manimate-render/1.0'}, method=method)
        with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)
    payload={'files':{'probe.py':REMOTE,'speech_server.py':(ROOT.parent/'manimate-render/speech/server.py').read_text(),
                      'cases.json':(Path(__file__).parent/'cases.json').read_text()},
             'command':['python','-u','probe.py'], 'outputs':['probe-results.json','fp32-t1.mp3','fp32-t2.mp3','fp32-t4.mp3','int8-t1.mp3','int8-t2.mp3'],
             'timeout_seconds':1200,'title':'Kokoro CPU benchmark'}
    job=request('/renders',payload)
    print('Probe job:',job['id'],flush=True)
    out=Path(__file__).parent/'results/render-probe';out.mkdir(parents=True,exist_ok=True)
    (out/'job.json').write_text(json.dumps({'id':job['id']}))
    while True:
        result=request('/renders/'+job['id'])
        if result['status'] in ('succeeded','failed'):break
        time.sleep(5)
    if result['status']!='succeeded':
        print(json.dumps({k:v for k,v in result.items() if k not in ['files']},indent=2))
        raise SystemExit(1)
    for artifact in result['files']:
        req=urllib.request.Request(artifact['url'],headers={'User-Agent':'manimate-render/1.0'})
        with urllib.request.urlopen(req,timeout=90) as response:(out/artifact['path']).write_bytes(response.read())
    print(json.dumps({'job_id':job['id'],'command_seconds':result.get('command_seconds'),'queue_seconds':result.get('queue_seconds')},indent=2))

if __name__=='__main__':main()
