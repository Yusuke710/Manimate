"""Upload a private session backup using the CLI's cloud connection."""
import hashlib
import urllib.parse
import json
import os
from pathlib import Path
import re
import tarfile
import tempfile
import urllib.request
import cloud_auth
import render

EXCLUDED = {'media', 'partial_movie_files', '__pycache__', 'node_modules', 'venv', 'env', 'dist', 'build'}


def archive_session(root, output):
    root = Path(root).resolve()
    session = json.loads((root / 'session.json').read_text())
    session_id = session['id']
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', session_id):
        raise ValueError('Invalid session ID')
    with tarfile.open(output, 'w:gz') as archive:
        for current, dirs, files in os.walk(root, followlinks=False):
            current = Path(current)
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in EXCLUDED and not (current / d).is_symlink())
            for name in sorted(files):
                source = current / name
                if name.startswith('.') or source.is_symlink() or not source.is_file():
                    continue
                archive.add(source, arcname=source.relative_to(root).as_posix(), recursive=False)
    return session_id


def upload_session(root):
    root = Path(root).resolve()
    session = json.loads((root / 'session.json').read_text())
    title = urllib.parse.quote(str(session.get('title') or 'Untitled animation')[:200])
    settings = render.config()
    base = settings.get('RENDER_URL', 'https://manimate.ai').rstrip('/')
    bearer = cloud_auth.token(base) if cloud_auth.load(base) else settings.get('RENDER_TOKEN')
    if not bearer:
        raise RuntimeError('Run manim-cloud login before uploading sessions.')
    with tempfile.NamedTemporaryFile(suffix='.tar.gz') as temporary:
        session_id = archive_session(root, temporary.name)
        size = Path(temporary.name).stat().st_size
        if size > 100_000_000:
            raise ValueError('Session backup exceeds the 100 MB upload limit.')
        with open(temporary.name, 'rb') as body:
            request = urllib.request.Request(base + '/sessions/' + session_id, body, method='PUT', headers={
                'Authorization': 'Bearer ' + bearer, 'Content-Type': 'application/gzip',
                'Content-Length': str(size), 'X-Project-Title': title, 'User-Agent': 'manim-cloud/1.0'})
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.load(response)
    video_name = (session.get('video') or {}).get('path') or session.get('video_path')
    if video_name:
        video = Path(video_name)
        if not video.is_absolute():
            video = root / video
        if not video.resolve().is_relative_to(root) or video.is_symlink():
            raise ValueError('Final video must be inside the session directory')
        if video.is_file():
            size = video.stat().st_size
            if size > 100_000_000:
                raise ValueError('Final video exceeds the 100 MB upload limit')
            with video.open('rb') as stream:
                checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
            with video.open('rb') as body:
                request = urllib.request.Request(base + '/sessions/' + session_id + '/video', body, method='PUT', headers={
                    'Authorization': 'Bearer ' + bearer, 'Content-Type': 'video/mp4', 'Content-Length': str(size),
                    'X-Project-Title': title, 'X-Content-SHA256': checksum, 'User-Agent': 'manim-cloud/1.0'})
                with urllib.request.urlopen(request, timeout=180) as response:
                    result.update(json.load(response))
    print(json.dumps(result))
