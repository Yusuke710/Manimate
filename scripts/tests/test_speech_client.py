import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('speech_client', Path(__file__).resolve().parents[1] / 'speech_client.py')
client = importlib.util.module_from_spec(spec); spec.loader.exec_module(client)

class ClientTests(unittest.TestCase):
    def test_cloud_cache_and_bust(self):
        data = {'audio': {'base64':base64.b64encode(b'mp3').decode(), 'format':'mp3'},
                'timestamps':{'total_duration_s':1, 'subtitles':[{'text':'hello'}]}, 'metrics':{}}
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp, patch.object(client, 'post_json', return_value=data) as post:
            try:
                os.chdir(tmp)
                client.generate_narration(['hello'], 'af_heart', 'audio.mp3', 'times.json')
                client.generate_narration(['hello'], 'af_heart', 'audio.mp3', 'times.json')
                self.assertEqual(post.call_count, 1)
                self.assertEqual(Path('audio.mp3').read_bytes(), b'mp3')
                client.generate_narration(['hello'], 'af_heart', 'audio.mp3', 'times.json', bust='0')
                client.generate_narration(['hello'], 'af_heart', 'audio.mp3', 'times.json')
                self.assertEqual(post.call_count, 2)
            finally: os.chdir(previous)

    def test_cloud_cli_needs_only_standard_library(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                body = json.dumps({'audio': {'base64':base64.b64encode(b'mp3').decode(), 'format':'mp3'},
                    'timestamps':{'total_duration_s':1, 'subtitles':[{'text':text} for text in data['input']]}}).encode()
                self.send_response(200); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        with HTTPServer(('127.0.0.1',0), Handler) as server, tempfile.TemporaryDirectory() as tmp:
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                Path(tmp,'narration.txt').write_text('subtitles:\n- Hello.\n')
                helper = Path(__file__).resolve().parents[1] / 'tts-generate.py'
                result = subprocess.run([sys.executable, '-S', str(helper), '--transport', 'cloud'], cwd=tmp,
                    env={**os.environ, 'TTS_BASE_URL':f'http://127.0.0.1:{server.server_port}', 'TTS_API_KEY':'test'},
                    capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(Path(tmp,'voiceover.mp3').read_bytes(), b'mp3')
                self.assertTrue(Path(tmp,'timestamps.json').exists())
            finally: server.shutdown(); thread.join()

    def test_custom_endpoint_never_receives_manimate_token(self):
        with patch.dict(os.environ, {'TTS_API_KEY':''}):
            with self.assertRaisesRegex(RuntimeError, 'TTS_API_KEY'):
                client.credentials('https://other.example')

    def test_reject_insecure_remote(self):
        with self.assertRaises(ValueError): client.post_json('http://other.example', '/v1/audio/narrations', {})

if __name__ == '__main__': unittest.main()
