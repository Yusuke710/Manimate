"""Profile workflow elapsed time from native tool spans and passive command markers.
Model gaps include API latency and orchestration; they are not CPU measurements.
"""
import argparse,collections,datetime,json,re,csv
from pathlib import Path

def epoch(s):return datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
def union(spans):
 merged=[]
 for a,b in sorted(spans):
  if b<a:continue
  if merged and a<=merged[-1][1]:merged[-1][1]=max(b,merged[-1][1])
  else:merged.append([a,b])
 return merged
def duration(spans):return sum(b-a for a,b in union(spans))
def readjsonl(path):
 result=[]
 if path.exists():
  for line in path.read_text().splitlines():
   try:result.append(json.loads(line))
   except json.JSONDecodeError:pass
 return result

def category(name,inp):
 text=str(inp.get('command',''));file=inp.get('file_path','')
 if name in ('WebFetch','WebSearch','ToolSearch'):return 'Research'
 if name in ('Write','Edit'):
  if 'narration' in file:return 'Narration writing'
  if file.endswith('.py'):return 'Code revision' if name=='Edit' else 'Code writing'
  return 'Other file writing'
 if ('sed -i' in text and 'script.py' in text) or "p='script.py'" in text or 'Apply layout fixes' in inp.get('description',''):return 'Code revision'
 if 'cat > narration.txt' in text or 'cat >narration.txt' in text:return 'Narration writing'
 if re.search(r'cat\s*>\s*script\.py',text):return 'Code writing'
 if text.startswith(('head ', 'grep ', 'sed ', 'ls ')):return 'Inspection'
 if 'tts-generate.py' in text and not any(x in text for x in ['head ','cat tts','sed ']):return 'Speech invocation'
 if 'manim-cloud' in text:return 'Render invocation'
 if any(x in text for x in ['ffmpeg','ffprobe','lint-subtitles']):return 'Assembly / verification'
 if name in ('TaskOutput','TaskStop'):return 'Waiting / task management'
 if name=='Read':return 'Inspection'
 return 'Setup / other tools'

p=argparse.ArgumentParser();p.add_argument('root',type=Path);args=p.parse_args();root=args.root
cfg=json.loads((root/'run-config.json').read_text());session=Path.home()/'.manimate/sessions'/cfg['session'];meta=json.loads((session/'session.json').read_text());run=meta['messages'][0]['run']
archived=session/'transcripts'/(run['id']+'.jsonl')
transcript=archived if archived.exists() else Path.home()/'.claude/projects'/re.sub('[^a-zA-Z0-9]','-',str(session/'project'))/(run['agent_session_id']+'.jsonl')
rows=readjsonl(transcript);start=epoch(run['started_at']);finish=epoch(run['finished_at']) if run.get('finished_at') else max(epoch(r['timestamp']) for r in rows if r.get('timestamp'))
tools={};assistant=[]
for r in rows:
 if not r.get('timestamp'):continue
 t=epoch(r['timestamp']);content=r.get('message',{}).get('content',[])
 if not isinstance(content,list):continue
 if r.get('type')=='assistant':assistant.append(t)
 for b in content:
  if b.get('type')=='tool_use':
   inp=b.get('input',{});tools[b['id']]={'id':b['id'],'name':b['name'],'start':t,'category':category(b['name'],inp),'description':inp.get('description') or inp.get('file_path') or inp.get('url') or b['name']}
  elif b.get('type')=='tool_result' and b.get('tool_use_id') in tools:
   tool=tools[b['tool_use_id']];tool.update(end=t,error=b.get('is_error',False))
   # Preserve only useful operational output, never internal model reasoning.
   text=b.get('content','');text=text if isinstance(text,str) else json.dumps(text)
   tool['background']=bool('background' in text.lower() and ('task' in text.lower() or 'id:' in text.lower()))
spans=[x for x in tools.values() if 'end' in x]
commands={}
for r in readjsonl(root/'commands.jsonl'):
 if not Path(r['cwd']).is_relative_to(session/'project'):continue
 if r['event']=='start':commands[r['id']]={'kind':r['kind'],'start':r['timestamp'],'command':r['command']}
 elif r['id'] in commands:commands[r['id']].update(end=r['timestamp'],exit_code=r.get('exit_code'))
commands=[x for x in commands.values() if 'end' in x]
# Native tool spans are blocking only until a background task is handed off.
blocking=union([(x['start'],x['end']) for x in spans])
last_assistant=max(assistant,default=finish)
points=sorted(set([start,last_assistant]+[max(start,min(last_assistant,t)) for s in blocking for t in s]))
gaps=[]
for a,b in zip(points,points[1:]):
 if b<=a or any(x<=a and y>=b for x,y in blocking):continue
 nexttools=[x for x in spans if x['start']>=b-.001]
 nexttool=min(nexttools,key=lambda x:x['start']) if nexttools else None
 gaps.append({'start':a,'end':b,'category':nexttool['category'] if nexttool else 'Final response','next_tool':nexttool['name'] if nexttool else None})
bycat=collections.defaultdict(list)
for g in gaps:bycat[g['category']].append((g['start'],g['end']))
bycmd=collections.defaultdict(list)
for c in commands:bycmd[c['kind']].append((c['start'],c['end']))
overlap=[]
for g in gaps:
 for c in commands:
  if c['kind'] in ('tts','render'):
   a=max(g['start'],c['start']);b=min(g['end'],c['end'])
   if a<b:overlap.append((a,b))
summary={'session':cfg['session'],'run':run['id'],'status':run['status'],'started_at':run['started_at'],'finished_at':run.get('finished_at'),'total_seconds':finish-start,'tool_wait_union_seconds':duration([(x['start'],x['end']) for x in spans]),'claude_response_gap_seconds':sum(g['end']-g['start'] for g in gaps),'post_assistant_seconds':finish-last_assistant,'claude_gap_by_next_action_seconds':{k:duration(v) for k,v in bycat.items()},'command_union_seconds':{k:duration(v) for k,v in bycmd.items()},'claude_overlap_speech_render_seconds':duration(overlap),'tools':spans,'commands':commands,'model_gaps':gaps}
(root/'profile.json').write_text(json.dumps(summary,indent=2)+'\n')
with (root/'tools.csv').open('w') as f:
 writer=csv.writer(f);writer.writerow(['start_seconds','end_seconds','elapsed_seconds','category','tool','description','error','background'])
 for x in spans:writer.writerow([round(x['start']-start,3),round(x['end']-start,3),round(x['end']-x['start'],3),x['category'],x['name'],x['description'],x.get('error'),x.get('background')])
print(json.dumps({k:v for k,v in summary.items() if k not in ['tools','commands','model_gaps']},indent=2))
