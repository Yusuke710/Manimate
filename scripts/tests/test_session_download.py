import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'manim-cloud'))
import session_download


class RestoreTests(unittest.TestCase):
    def test_missing_video_is_cleared_when_cloud_has_no_replacement(self):
        session = {'id': 'test-session', 'messages': [], 'video': {'path': 'project/missing.mp4'}}
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as tar:
            content = json.dumps(session).encode()
            member = tarfile.TarInfo('session.json')
            member.size = len(content)
            tar.addfile(member, io.BytesIO(content))

        class Response(io.BytesIO):
            class headers:
                @staticmethod
                def get_content_type():
                    return 'application/gzip'

        with tempfile.TemporaryDirectory() as folder, \
             patch.object(session_download.render, 'config', return_value={'RENDER_TOKEN': 'test'}), \
             patch.object(session_download.cloud_auth, 'load', return_value={}), \
             patch.object(session_download.urllib.request, 'urlopen', return_value=Response(archive.getvalue())), \
             patch.object(session_download.render, 'request', return_value={'videos': []}):
            session_download.restore_session('test-session', folder)
            restored = json.loads((Path(folder) / 'test-session/session.json').read_text())
            self.assertIsNone(restored['video'])
