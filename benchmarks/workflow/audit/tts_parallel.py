"""Experiment only: compare one narration request with four balanced requests.
No production API or agent behavior changes. Assembly is local in this probe.
"""
import sys,json,time,base64,concurrent.futures,subprocess,wave,io
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'scripts'))
import speech_client
root=Path(__file__).parent
project=Path.home()/'.manimate/sessions/profile-gpt2-css-e7e5b728/project'
lines=[x['text'] for x in json.loads((project/'timestamps.json').read_text())['subtitles']]
# Choose contiguous cuts that minimize imbalance in character counts.
from itertools import combinations
cuts=min(combinations(range(1,len(lines)),3),key=lambda cuts:max(sum(map(len,lines[a:b])) for a,b in zip((0,*cuts),(*cuts,len(lines)))))
groups=[lines[a:b] for a,b in zip((0,*cuts),(*cuts,len(lines)))]
rows=[]
def call(part):
 start=time.perf_counter();r=speech_client.post_json(speech_client.DEFAULT_URL,'/v1/audio/narrations',{'input':part,'voice':'af_heart','response_format':'mp3'})
 return r,time.perf_counter()-start
for repeat in range(3):
 for workers in ([1,4] if repeat%2==0 else [4,1]):
  start=time.perf_counter();parts=[lines] if workers==1 else groups
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:results=list(pool.map(call,parts))
   api=time.perf_counter()-start
   pcm=[];duration=0
   for i,(r,elapsed) in enumerate(results):
    raw=base64.b64decode(r['audio']['base64']);audio=root/f'trial-{repeat}-{workers}-{i}.mp3';audio.write_bytes(raw)
    decoded=subprocess.check_output(['ffmpeg','-v','error','-i',str(audio),'-f','s16le','-ac','1','-ar','24000','pipe:1'])
    expected=r['timestamps']['total_duration_s'];assert abs(len(decoded)/48000-expected)<.01
    pcm.append(decoded);duration+=expected
   joined=b''.join(pcm);assert abs(len(joined)/48000-163.69066666666666)<.01
   row={'repeat':repeat,'workers':workers,'api_wall_seconds':api,'decoded_and_joined_seconds':time.perf_counter()-start,'audio_seconds':duration,'parts':[{'request_seconds':e,'metrics':r['metrics']} for r,e in results]}
  except Exception as e:row={'repeat':repeat,'workers':workers,'error':str(e),'elapsed':time.perf_counter()-start}
  rows.append(row);(root/'tts-parallel-results.json').write_text(json.dumps({'groups_characters':[sum(map(len,g)) for g in groups],'rows':rows},indent=2));print(json.dumps(row),flush=True)
