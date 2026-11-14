import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import session_upload

class SessionArchiveTests(unittest.TestCase):
    def test_archive_keeps_history_code_assets_final_video_but_not_caches_or_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'session'; root.mkdir()
            (root/'session.json').write_text(json.dumps({'id':'test-session','messages':[{'content':'hello'}]}))
            project=root/'project'; project.mkdir()
            for name in ['scene.py','video.mp4','.env']:(project/name).write_text('test')
            (project/'assets').mkdir();(project/'assets'/'image.png').write_bytes(b'image')
            (project/'media').mkdir();(project/'media'/'partial.mp4').write_bytes(b'partial')
            (project/'outside').symlink_to('/etc/hosts')
            (root/'transcripts').mkdir();(root/'transcripts'/'agent.jsonl').write_text('redundant diagnostic log')
            (project/'transcripts').mkdir();(project/'transcripts'/'narration.txt').write_text('user project asset')
            output=Path(folder)/'backup.tar.gz'
            self.assertEqual(session_upload.archive_session(root,output),'test-session')
            with tarfile.open(output) as archive:
                self.assertEqual(set(archive.getnames()),{'session.json','project/scene.py','project/video.mp4','project/assets/image.png','project/transcripts/narration.txt'})
