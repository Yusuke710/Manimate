Use normal Manim arguments with `manim-remote` from the project directory:

```sh
manim-remote script.py Scene1_Introduction > render-result.json
# When the scene reads attached files:
manim-remote --remote-include inputs/ script.py Scene1_Introduction > render-result.json
```

Python files, `manim.cfg`, and `assets/` upload automatically. Include other runtime inputs explicitly with `--remote-include`, including `timestamps.json` if code reads it. Check `command -v manim-remote`; if unavailable, report the setup blocker.

The command waits and returns JSON, not local videos. Check `status`; on success download each `files[].url` with `curl -fL` to its relative `files[].path`, creating parent directories. Save results under distinct names for parallel jobs. Use the returned paths rather than guessing resolution directories.

If using the configured Manim Remote MCP instead of the CLI, call `render_manim` with the same Manim `args` and the contents of all required `files`. Use a unique `idempotency_key` per render; reuse it only when retrying the identical submission. Poll `get_render` with the returned `job_id` until completion, then download `files[].url` as above. The MCP cannot read local paths; supply file contents, including assets.
