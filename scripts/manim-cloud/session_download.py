"""Restore an authenticated cloud session without overwriting local work."""
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import urllib.request
import cloud_auth
import render


def restore_session(session_id, destination):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', session_id):
        raise ValueError('Invalid session ID')
    target = Path(destination).resolve() / session_id
    if target.exists():
        raise ValueError('This session already exists locally. Open it instead.')
    settings = render.config()
    base = settings.get('RENDER_URL', 'https://manimate.ai').rstrip('/')
    token = cloud_auth.token(base) if cloud_auth.load(base) else settings.get('RENDER_TOKEN')
    if not token:
        raise RuntimeError('Run manim-cloud login first.')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='cloud-restore-', dir=target.parent) as folder:
        root = Path(folder) / 'session'
        root.mkdir()
        req = urllib.request.Request(base+'/sessions/'+session_id, headers={'Authorization':'Bearer '+token,'User-Agent':'manim-cloud/1.0'})
        with urllib.request.urlopen(req, timeout=180) as response:
            if response.headers.get_content_type() == 'application/json':
                data = json.load(response)
                source = data['session']
                project = root / 'project'; project.mkdir()
                for key, name in [('script_content','script.py'),('plan_content','plan.md'),('subtitles_content','subtitles.srt')]:
                    if source.get(key): (project/name).write_text(source[key])
                session = dict(version=2, id=session_id, session_number=0, title=source['title'], status='active', model='claude', agent_session_id=None,
                    aspect_ratio=source.get('aspect_ratio'), voice_id=source.get('voice_id'), created_at=source['created_at'], updated_at=source['updated_at'], last_user_activity_at=source['updated_at'], video=None,
                    messages=[{k:m.get(k) for k in ['id','role','content','metadata','created_at']} for m in data.get('messages',[]) if m.get('role') in ['user','assistant']])
                (root/'session.json').write_text(json.dumps(session))
                (root/'legacy-snapshot.json').write_text(json.dumps(data))
            else:
                archive = Path(folder)/'backup.tar.gz'
                total=0
                with archive.open('wb') as out:
                    while chunk := response.read(1024*1024):
                        total+=len(chunk)
                        if total>100_000_000: raise ValueError('Backup exceeds size limit')
                        out.write(chunk)
                with tarfile.open(archive,'r:gz') as tar:
                    total=0
                    members=tar.getmembers()
                    if len(members)>10000: raise ValueError('Too many backup files')
                    for member in members:
                        dest=(root/member.name).resolve()
                        total+=member.size
                        if not dest.is_relative_to(root) or member.issym() or member.islnk() or not (member.isfile() or member.isdir()) or total>500_000_000:
                            raise ValueError('Unsafe backup archive')
                        if member.isdir(): dest.mkdir(parents=True,exist_ok=True)
                        else:
                            dest.parent.mkdir(parents=True,exist_ok=True)
                            with tar.extractfile(member) as src, dest.open('wb') as out: shutil.copyfileobj(src,out)
                session=json.loads((root/'session.json').read_text())
                if session.get('id')!=session_id: raise ValueError('Backup session ID does not match')
                session['agent_session_id']=None
                for message in session.get('messages',[]):
                    if message.get('run'): message['run'].update(pid=None,agent_session_id=None)
                (root/'session.json').write_text(json.dumps(session))
        # Legacy exports were paged by UUID; restore the conversation chronologically.
        session['messages'] = sorted(session.get('messages', []), key=lambda m: str(m.get('created_at') or ''))
        (root/'session.json').write_text(json.dumps(session))
        video_path = (session.get('video') or {}).get('path')
        if video_path and not (root / video_path).resolve().is_relative_to(root):
            raise ValueError('Unsafe video path in backup')
        if not video_path or not (root / video_path).is_file():
            chapters=(session.get('video') or {}).get('chapters')
            if chapters is None and (root/'legacy-snapshot.json').is_file():
                chapters=json.loads((root/'legacy-snapshot.json').read_text()).get('session',{}).get('chapters')
                if isinstance(chapters,str):
                    try: chapters=json.loads(chapters)
                    except ValueError: chapters=None
            session['video'] = None
            library=render.request(base+'/videos?project='+session_id,token)
            videos=[v for v in library.get('videos',[]) if v['status']=='succeeded']
            if videos:
                files=[f for f in videos[0]['files'] if f['path'].endswith('.mp4')]
                if files:
                    url=files[0]['url']
                    if not url.startswith(base+'/'): raise ValueError('Unexpected video origin')
                    video=root/'project'/'video.mp4'; video.parent.mkdir(exist_ok=True)
                    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'manim-cloud/1.0'}),timeout=180) as response, video.open('wb') as out: shutil.copyfileobj(response,out)
                    session['video']={'path':'project/video.mp4','version':None,'chapters':chapters if isinstance(chapters,list) else None}
                    (root/'session.json').write_text(json.dumps(session))
        root.rename(target)
    print(json.dumps({'session_id':session_id,'status':'restored'}))
