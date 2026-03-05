# Manimate Generate Tool (OpenClaw Style)

## Tool Card

- `name`: `manimate_generate`
- `description`: Generate a Manimate animation from a prompt and return IDs/URLs for review and artifacts.

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "prompt": { "type": "string", "description": "Natural-language animation request." },
    "base_url": { "type": "string", "description": "Manimate server URL. Example: http://localhost:3000" },
    "session_id": { "type": "string", "description": "Optional existing session ID to continue." },
    "model": { "type": "string", "enum": ["opus", "sonnet", "haiku"] },
    "aspect_ratio": { "type": "string", "enum": ["16:9", "9:16", "1:1"] },
    "voice_id": { "type": "string", "description": "Optional ElevenLabs voice ID." },
    "show_events": { "type": "boolean", "description": "When true, print readable live events." }
  },
  "required": ["prompt"],
  "additionalProperties": false
}
```

## Execution Mapping

Map the tool input to CLI:

```bash
node scripts/manimate-tool.mjs generate \
  --prompt "<prompt>" \
  --json \
  --base-url "<base_url>" \
  [--session "<session_id>"] \
  [--model "<model>"] \
  [--aspect-ratio "<aspect_ratio>"] \
  [--voice "<voice_id>"] \
  [--show-events]
```

Notes:

- JSON result is printed to `stdout`.
- Live event lines (`--show-events`) are printed to `stderr`.
- `--session` is usually **not** required. Omit it for a fresh run; use it only to continue an existing session.

## Example Commands

Single command pattern (recommended; remove flags you do not need):

```bash
node scripts/manimate-tool.mjs generate \
  --prompt "Animate Laplace transform" \
  --json \
  --base-url "http://localhost:3000" \
  --show-events \
  --model "sonnet" \
  --aspect-ratio "16:9" \
  --voice "Lci8YeL6PAFHJjNKvwXq"
```

Continue an existing session (only when needed):

```bash
node scripts/manimate-tool.mjs generate \
  --prompt "Now add a real-world signal example" \
  --json \
  --base-url "http://localhost:3000" \
  --session "b92794d1-2279-477b-b818-064d78d272b1"
```

## Output Contract

Final JSON object (`stdout`):

```json
{
  "ok": true,
  "status": "completed",
  "session_id": "b92794d1-2279-477b-b818-064d78d272b1",
  "run_id": "6fea0020-7f6a-4d97-bcb9-44327b3fdee9",
  "video_url": "/api/files?session_id=...&path=.../video.mp4&_v=...",
  "review_url": "http://localhost:3000/?session=b92794d1-2279-477b-b818-064d78d272b1",
  "message": "Complete"
}
```

Field semantics:

- `ok`: `true` for `completed`/`canceled`, `false` for `failed`.
- `status`: `completed` | `canceled` | `failed`.
- `session_id`: canonical session identifier for later queries.
- `run_id`: run identifier for tracing.
- `video_url`: relative API URL to rendered video (can be `null` for non-video runs).
- `review_url`: full browser URL to inspect the session UI.
- `message`: terminal status message.

## Live Event Examples (`--show-events`)

```text
[manimate] system_init session=... model=opus
[manimate] progress planning Running Manimate...
[manimate] tool_use Bash manim script.py Scene1
[manimate] tool_result ok Rendered Scene1 to media/videos/...
[manimate] complete run=...
Review in browser: http://localhost:3000/?session=...
```

## Artifact Retrieval

1. Open the session in UI:

```text
<base_url>/?session=<session_id>
```

2. Download rendered video:

```text
<base_url><video_url>
```

3. Fetch full session state (messages, activity, plan/script/subtitles, last video URL):

```text
<base_url>/api/sessions/<session_id>/messages
```

## Failure Handling

- If response is `404`, check `base_url`/port (common when another app owns `localhost:3000`).
- If `status=failed`, use `session_id` and `/api/sessions/<session_id>/messages` to inspect activity/error trail.
- If `video_url=null`, generation may have produced only checks/text and no render artifact.
