import os,sys,time,subprocess,json
from pathlib import Path
allowed=os.sched_getaffinity(0)
rows=[]
for repeat in range(2):
 for scene in ['CssMath','Attention']:
  for cores in ([1,2] if repeat==0 else [2,1]):
   os.sched_setaffinity(0,{min(allowed)} if cores==1 else allowed)
   media=f'eval-media-{repeat}-{scene}-{cores}'
   begin=time.perf_counter()
   result=subprocess.run([sys.executable,'-m','manim','--disable_caching','--media_dir',media,'-ql','script.py',scene],capture_output=True,text=True,timeout=65)
   row={'repeat':repeat,'scene':scene,'cpu_mode':'one-logical-CPU-affinity' if cores==1 else 'normal-2-vCPU-container','elapsed_seconds':time.perf_counter()-begin,'exit_code':result.returncode}
   if result.returncode:row['error_tail']=result.stderr[-1000:]
   rows.append(row);Path('cpu-results.json').write_text(json.dumps({'host_visible_cpus':len(allowed),'rows':rows},indent=2));print(json.dumps(row),flush=True)
os.sched_setaffinity(0,allowed)
