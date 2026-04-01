# Manimate (Local-First)

Local single-user version of Manimate with:

- local Claude Code runtime,
- local filesystem storage,
- local SQLite persistence,
- SSE chat streaming with session/run persistence,
- optional autosync to `manimate.ai`.

## Prerequisites

- Node.js 22+
- Claude Code CLI (`claude`) authenticated with your local subscription
- Manim CE (`manim`) and `ffmpeg`
- ElevenLabs API key — set `ELEVENLABS_API_KEY` in `.env.local` for voiceover features

## Setup

```bash
cp .env.example .env.local
npm install
```

Run the local app with one command:

```bash
manimate
```

In the repo, the equivalent command is:

```bash
npm run manimate
```

That starts the local app, opens the browser, and on first run opens `manimate.ai` for browser approval so completed renders autosync.

If a packaged standalone build exists, the launcher uses it. Otherwise it falls back to the local Next server automatically.

For direct local development, this still works:

```bash
npm run dev
```

Then open `http://localhost:3000`.

## URL Launch Params

Welcome-screen deep links support prefill and optional auto-send:

- `prompt` (or alias `q`) pre-fills the welcome composer
- `send=1` auto-sends immediately into a new session
- optional: `model`, `voice_id` (or `voice`), `aspect_ratio`

Examples:

- `http://localhost:3000/?prompt=Animate%20Taylor%20series`
- `http://localhost:3000/?prompt=Animate%20Bayes%20rule&send=1`
- `http://localhost:3000/?prompt=Animate%20FFT&send=1&model=sonnet&aspect_ratio=16:9`

## Tool API (Agents/CLI)

Use one-step generation endpoint:

- `POST /api/tool/generate`

Request JSON:

```json
{
  "prompt": "Animate eigenvectors in 2D",
  "model": "opus",
  "aspect_ratio": "16:9",
  "voice_id": "Lci8YeL6PAFHJjNKvwXq"
}
```

Behavior:

- materializes (or reuses) a session,
- runs the same local generation pipeline as the UI,
- streams SSE events (same event types as `/api/chat`) with `session_id` included.

## CLI Tool

Open the local app:

```bash
manimate
manimate --no-open
```

Stop the local app:

```bash
manimate stop
```

Run generation from shell/agents:

```bash
manimate "Animate Laplace transform"
manimate "Animate Laplace transform" -m opus -a 16:9
manimate "Animate Laplace transform" -v Lci8YeL6PAFHJjNKvwXq
manimate "Animate eigenvectors" --no-voice
manimate -p "--animate a prompt that starts with a dash"
```

Generation returns one JSON object on stdout. `--show-events` prints readable progress to stderr. Voiceover is off by default, so only pass `-v` when voiceover is wanted. Do not pass `--json`.

Legacy `manimate open`, `manimate generate`, and `manimate connect` were removed. Use plain `manimate` to open the app and `manimate "<prompt>"` to generate.

Repo entrypoints:

```bash
npm run manimate
npm run tool:open
npm run tool:generate -- "Animate Laplace transform"
node scripts/manimate-tool.mjs "Animate Laplace transform"
```

Useful open flags:

- `--cloud-base-url <url>`
- `--no-open`
- `--restart`
- `--mode <auto|standalone|dev|start>`
- `--port <number>`
- `--host <hostname>`

Useful generate flags:

- `-p`, `--prompt <text>` use this when the prompt starts with `-`
- `-s`, `--session <id>` reuse session
- `-m`, `--model <opus|sonnet|haiku>`
- `-a`, `--aspect <16:9|9:16|1:1>`
- `-v`, `--voice <voice_id>`
- `--no-voice`
- `--base-url <http://localhost:3000>`
- `--show-events`
- `--quiet`

Example output:

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

Troubleshooting:

- If Manimate cannot be reached, start it with `manimate` or pass `--base-url`.
- If `status=failed`, inspect `/api/sessions/<session_id>/messages`.
- If cloud auth expired, run plain `manimate` to reconnect.

## Local Data Layout

Default root: `~/.manimate/`

- `db/app.db`
- `sessions/<session_id>/project/`
- `sessions/<session_id>/project/inputs/` (chat attachments, including images and PDFs)
- `sessions/<session_id>/artifacts/`

Override root with `MANIMATE_LOCAL_ROOT`.

## Notes

- Local execution remains the source of truth; `manimate.ai` is for autosync and sharing.
- Voiceover works when `ELEVENLABS_API_KEY` is set.
- Advanced actions are chat-driven (for example, ask for `render in hq`) rather than dedicated API routes.
