"""Browser OAuth for the CLI; credentials never enter the scene workspace."""
import base64
import hashlib
import html
import json
import os
from pathlib import Path
import secrets
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer


def credential_path():
    return Path(os.environ.get('MANIM_CLOUD_AUTH_FILE', Path.home() / '.config/manim-cloud/auth.json'))


def load(base):
    path = credential_path()
    data = json.loads(path.read_text()) if path.exists() else {}
    return data if data.get('base_url') == base else {}


def save(data):
    path = credential_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream)
    temporary.replace(path)


def exchange(base, fields):
    request = urllib.request.Request(base + '/oauth/token', urllib.parse.urlencode(fields).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'manim-cloud/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def token(base):
    # Serialize refreshes so parallel scene processes do not race rotated tokens.
    import fcntl
    path = credential_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path) + '.lock', os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = load(base)
        if not data:
            raise RuntimeError('Run manim-cloud login to connect with Google.')
        if data['expires_at'] < time.time() + 60:
            renewed = exchange(base, {'grant_type': 'refresh_token', 'client_id': data['client_id'],
                'refresh_token': data['refresh_token'], 'resource': base})
            data.update(renewed, expires_at=time.time() + renewed['expires_in'])
            save(data)
        return data['access_token']


def completion_page(message):
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manimate</title>'
        '<link href="https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest/font/Serif/cmun-serif.css" rel="stylesheet">'
        '<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500&display=swap" rel="stylesheet">'
        '<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:40px 20px;background:#f6f3ec;display:flex;align-items:center;justify-content:center;font-family:Figtree,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}'
        'main{width:min(460px,100%);background:#fbfaf7;border:1px solid rgba(15,23,42,.10);border-radius:24px;padding:34px 26px 28px;box-shadow:0 24px 60px rgba(15,23,42,.08);text-align:center}'
        '.brand{display:flex;align-items:center;justify-content:center;gap:10;margin:0 auto 18px}'
        '.symbol{font-size:44px;line-height:1;color:#2BB5A0;font-family:"Computer Modern","Latin Modern Math","STIX Two Math",serif}'
        '.name{font-size:28px;line-height:1;font-weight:400;color:#1C1E21;font-family:"Computer Modern Serif",Georgia,"Times New Roman",serif}'
        'p{margin:0;color:#525252;font-size:14px;line-height:1.6}</style>'
        '<main><div class="brand"><span class="symbol">∑</span><span class="name">Manimate</span></div><p>'
        + html.escape(message) + '</p></main></html>')


def login(base):
    if urllib.parse.urlparse(base).scheme != 'https':
        raise ValueError('Cloud sign-in requires HTTPS.')
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    received = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(url.query)
            valid = url.path == '/callback' and secrets.compare_digest(query.get('state', [''])[0], state)
            if valid:
                received.update(code=query.get('code', [''])[0], error=query.get('error', [''])[0])
            self.send_response(200 if valid else 400)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            message = 'Return to Manimate. Connecting will finish automatically.' if valid and received.get('code') else 'Sign-in failed. Start again from Manimate.'
            self.wfile.write(completion_page(message).encode())

    with HTTPServer(('127.0.0.1', 0), Callback) as server:
        server.timeout = 1
        callback = f'http://127.0.0.1:{server.server_port}/callback'
        body = json.dumps({'client_name': 'Manimate', 'redirect_uris': [callback],
            'grant_types': ['authorization_code', 'refresh_token'], 'response_types': ['code'],
            'token_endpoint_auth_method': 'none'}).encode()
        request = urllib.request.Request(base + '/oauth/register', body,
            headers={'Content-Type': 'application/json', 'User-Agent': 'manim-cloud/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            client_id = json.load(response)['client_id']
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        url = base + '/authorize?' + urllib.parse.urlencode({'client_id': client_id, 'redirect_uri': callback,
            'response_type': 'code', 'scope': 'render', 'resource': base, 'state': state,
            'code_challenge': challenge, 'code_challenge_method': 'S256'})
        print(json.dumps({'status': 'pending', 'connect_url': url}), flush=True)
        webbrowser.open(url)
        deadline = time.time() + 300
        while not received and time.time() < deadline:
            server.handle_request()
        if not received.get('code'):
            raise RuntimeError('Sign-in cancelled or expired. Run manim-cloud login again.')
        data = exchange(base, {'grant_type': 'authorization_code', 'client_id': client_id,
            'code': received['code'], 'code_verifier': verifier, 'redirect_uri': callback, 'resource': base})
        save({**data, 'base_url': base, 'client_id': client_id, 'expires_at': time.time() + data['expires_in']})
        print(json.dumps({'status': 'connected'}), flush=True)
