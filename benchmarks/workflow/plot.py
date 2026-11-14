"""Render a wall-clock timeline. Overlapping bars intentionally share x positions."""
import json,sys,datetime
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(sys.argv[1]);d=json.loads((root/'profile.json').read_text());start=datetime.datetime.fromisoformat(d['started_at'].replace('Z','+00:00')).timestamp()
lanes=[('Claude response / decisions','#bd8b21',[(x['start'],x['end']) for x in d['model_gaps']]),('Research tools','#4285c5',[(x['start'],x['end']) for x in d['tools'] if x['category']=='Research']),('Remote speech','#2c9b70',[(x['start'],x['end']) for x in d['commands'] if x['kind']=='tts']),('Remote render CLI','#8154b8',[(x['start'],x['end']) for x in d['commands'] if x['kind']=='render']),('Download / encode / probe','#d87543',[(x['start'],x['end']) for x in d['commands'] if x['kind'] in ('download','assembly','validation')]),('Other tool execution','#82909c',[(x['start'],x['end']) for x in d['tools'] if x['category']!='Research'])]
fig,ax=plt.subplots(figsize=(13,4.2))
for i,(label,color,spans) in enumerate(lanes):
 for a,b in spans:ax.broken_barh([(a-start,max(b-a,.3))],(i-.3,.6),facecolors=color,alpha=.85)
ax.set_yticks(range(len(lanes)),[x[0] for x in lanes]);ax.invert_yaxis();ax.set_xlim(0,d['total_seconds']);ax.set_xlabel('Seconds since generation started');ax.set_title('GPT-2 in CSS — one complete Manimate workflow',loc='left',weight='bold');ax.grid(axis='x',alpha=.2);ax.set_axisbelow(True)
for side in ['top','right','left']:ax.spines[side].set_visible(False)
fig.text(.02,.015,'Overlapping bars run concurrently. Claude gaps include model/API/orchestration time; tool execution may include waiting.',fontsize=9,color='#555555')
fig.tight_layout(rect=(0,.06,1,1));fig.savefig(root/'timeline.png',dpi=160);fig.savefig(root/'timeline.svg');plt.close(fig)
