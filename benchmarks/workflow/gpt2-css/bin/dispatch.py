#!/Users/ymiy/.pyenv/versions/3.10.13/bin/python
import os,sys,json,time,subprocess,uuid
from pathlib import Path
root=Path(__file__).resolve().parent.parent
config=json.loads((root/'run-config.json').read_text())
name=Path(sys.argv[0]).name
args=sys.argv[1:]
kind=('tts' if any('tts-generate.py' in x for x in args) else 'render' if name=='manim-cloud' else 'assembly' if name=='ffmpeg' else 'validation' if name=='ffprobe' else 'download' if name=='curl' else 'python-other')
id=uuid.uuid4().hex
start=time.time()
def emit(data):
 data.update(id=id,kind=kind,command=name,cwd=os.getcwd(),timestamp=time.time(),pid=os.getpid())
 fd=os.open(root/'commands.jsonl',os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
 os.write(fd,(json.dumps(data)+'\n').encode());os.close(fd)
emit({'event':'start'})
try:
 code=subprocess.call([config['real_commands'][name],*args])
except BaseException:
 emit({'event':'interrupted','elapsed':time.time()-start});raise
emit({'event':'end','elapsed':time.time()-start,'exit_code':code})
sys.exit(code)
