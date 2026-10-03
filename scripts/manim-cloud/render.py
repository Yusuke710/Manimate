#!/usr/bin/env python3
"""Submit local files, wait, and print the result JSON. Python standard library only."""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import uuid
import cloud_auth

MAX_BODY = 12 * 1024 * 1024

def config():
    values = {}
    path = Path(__file__).with_name('.env')
    if path.exists():
        for line in path.read_text().splitlines():
            if line and not line.startswith('#'):
                key, value = line.split('=', 1)
                values[key] = value
    return {**values, **os.environ}


def request(url, token, body=None, key=None):
    headers = {'User-Agent': 'manimate-render/1.0', 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    if key: headers['Idempotency-Key'] = key
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, body, headers), timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            error = exc.read().decode(errors='replace'); exc.close()
            if exc.code < 500:
                raise RuntimeError(f'HTTP {exc.code}: {error}') from None
            if attempt == 3: raise RuntimeError(f'HTTP {exc.code}: {error}') from None
        except (OSError, TimeoutError):
            if attempt == 3: raise
        time.sleep(2 ** attempt)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', action='append', default=[], help='File relative to --dir; repeat for assets')
    parser.add_argument('--dir', default='.', help='Working directory for input files (default: current directory)')
    parser.add_argument('--output', action='append', help='Exact remote output path; defaults to final MP4s')
    parser.add_argument('--timeout', type=int, default=1800, help='Command timeout, 1–1800 seconds')
    parser.add_argument('--submit-only', action='store_true')
    parser.add_argument('--retry-interrupted', action='store_true', help='Allow up to two fresh attempts after confirmed SIGTERM/SIGKILL (only for safe-to-repeat commands)')
    parser.add_argument('--job', help='Resume polling an existing job ID')
    parser.add_argument('command', nargs=argparse.REMAINDER, help='-- manim -ql scene.py Scene1')
    args = parser.parse_args(argv); settings = config()
    base = settings.get('RENDER_URL', 'https://cloud.manimate.ai').rstrip('/')
    token = cloud_auth.token(base) if cloud_auth.load(base) else settings.get('RENDER_TOKEN', '')
    if not base or not token: parser.error('Run manim-cloud login, or configure RENDER_URL and RENDER_TOKEN')
    if args.job:
        status_url = base + '/renders/' + args.job
    else:
        command = args.command[1:] if args.command[:1] == ['--'] else args.command
        if not command: parser.error('Provide a command after --')
        root = Path(args.dir).resolve(); files = {}
        for name in args.file:
            path = Path(os.path.abspath(root / name))
            if not path.resolve().is_relative_to(root): parser.error('Input files must be inside --dir')
            files[str(path.relative_to(root))] = {'base64': base64.b64encode(path.read_bytes()).decode()}
        payload = {'files': files, 'command': command, 'timeout_seconds': args.timeout}
        # A Manimate project's parent contains session.json; retain grouping on rerenders.
        for candidate in [root / 'session.json', root.parent / 'session.json']:
            if candidate.is_file():
                try:
                    session = json.loads(candidate.read_text())
                    payload.update(project_id=session['id'], title=str(session.get('title') or 'Untitled animation')[:200])
                except (ValueError, KeyError, OSError):
                    pass
                break
        if args.retry_interrupted: payload['retry_interrupted'] = True
        if args.output: payload['outputs'] = args.output
        body = json.dumps(payload).encode()
        if len(body) > MAX_BODY: parser.error('Request exceeds 12 MiB')
        submitted = request(base + '/renders', token, body, str(uuid.uuid4()))
        if args.submit_only:
            print(json.dumps(submitted)); return 0
        print('Render job: ' + submitted['id'], file=sys.stderr)
        status_url = submitted['status_url']
    while True:
        result = request(status_url, token)
        if result['status'] in ('succeeded', 'failed'):
            print(json.dumps(result, indent=2)); return 0 if result['status'] == 'succeeded' else 1
        time.sleep(2)


if __name__ == '__main__':
    try: sys.exit(main())
    except (OSError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr); sys.exit(1)
