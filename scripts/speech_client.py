"""Standard-library client for the Manimate narration API.

The remote adapter returns the same audio/timestamps artifacts as local Kokoro. No inference packages are imported in cloud mode.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import time
import tempfile
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = 'https://manimate-speech.youfu1202mo.workers.dev'


def credentials(base):
    key = os.environ.get('TTS_API_KEY', '').strip()
    if key:
        return {'Authorization': 'Bearer ' + key}
    if base != DEFAULT_URL:
        raise RuntimeError('Set TTS_API_KEY for a custom TTS_BASE_URL')
    try:
        import manimate_cloud_auth as auth
    except ImportError:
        import sys
        sys.path.insert(0, str(Path(__file__).parent / 'manim-cloud'))
        import cloud_auth as auth
    path = auth.credential_path()
    data = json.loads(path.read_text()) if path.exists() else {}
    origin = data.get('base_url', 'https://manimate.ai')
    if origin not in ('https://manimate.ai', 'https://cloud.manimate.ai'):
        raise RuntimeError('Sign in to Manim Cloud before using hosted speech')
    return {'Authorization': 'Bearer ' + auth.token(origin), 'X-Manimate-Auth-Origin': origin}


def post_json(base, path, payload):
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')):
        raise ValueError('TTS_BASE_URL must use HTTPS (or localhost for development)')
    headers = {**credentials(base), 'Content-Type': 'application/json', 'User-Agent': 'manimate-render/1.0'}
    for attempt in range(6):
        req = urllib.request.Request(base + path, json.dumps(payload).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=300) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            message = exc.read().decode(errors='replace')[:500]
            if exc.code == 429 and 'busy' in message.lower() and attempt < 5:
                time.sleep(min(2 ** attempt, 8))
                continue
            raise RuntimeError(f'Speech API HTTP {exc.code}: {message}') from None
    raise RuntimeError('Speech service busy')


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(content)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def generate_narration(lines, voice, audio_path, timestamps_path, bust=None):
    base = os.environ.get('TTS_BASE_URL', DEFAULT_URL).rstrip('/')
    payload = {'model': 'kokoro', 'input': lines, 'voice': voice,
               'speed': float(os.environ.get('KOKORO_SPEED', '1')), 'response_format': 'mp3'}
    canonical = json.dumps({'api': base, 'version': 1, **payload}, sort_keys=True)
    cache = Path('.tts-cache') / ('cloud-' + hashlib.sha256(canonical.encode()).hexdigest())
    cached_audio = cache.with_suffix('.mp3'); cached_json = cache.with_suffix('.json')
    if bust is not None:
        cached_audio.unlink(missing_ok=True); cached_json.unlink(missing_ok=True)
        print('Cleared cached cloud narration')
        return
    started = time.perf_counter()
    cached = False
    if cached_audio.exists() and cached_json.exists():
        try:
            result = json.loads(cached_json.read_text())
            audio = cached_audio.read_bytes()
            cached = result.get('audio_sha256') == hashlib.sha256(audio).hexdigest()
        except (ValueError, OSError):
            pass
    if not cached:
        result = post_json(base, '/v1/audio/narrations', payload)
        audio = base64.b64decode(result['audio']['base64'], validate=True)
        timestamps = result['timestamps']
        if result['audio']['format'] != 'mp3' or not audio or len(timestamps['subtitles']) != len(lines):
            raise RuntimeError('Invalid speech API response')
        if [entry['text'] for entry in timestamps['subtitles']] != lines:
            raise RuntimeError('Speech API returned mismatched narration')
        cache.parent.mkdir(parents=True, exist_ok=True)
        # Cache metadata excludes base64; outputs are finalized only after success.
        result = {'timestamps': timestamps, 'metrics': result.get('metrics', {}), 'audio_sha256': hashlib.sha256(audio).hexdigest()}
        atomic_write(cached_audio, audio); atomic_write(cached_json, json.dumps(result).encode())
        cached = False
    atomic_write(audio_path, audio)
    atomic_write(timestamps_path, json.dumps(result['timestamps'], indent=2).encode())
    print(json.dumps({'provider': 'kokoro-cloud', 'cached': cached,
                      'elapsed_seconds': round(time.perf_counter() - started, 3),
                      'audio_seconds': result['timestamps']['total_duration_s'], 'metrics': result.get('metrics', {})}))
