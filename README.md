# Manimate

Run manimate.ai with your own claude code locally.

- Claude Code, Manim, and rendering run locally
- sessions are stored locally in SQLite and the filesystem
- finished work can autosync to `manimate.ai` to view and share easily

## Requirements

- Node.js 22+
- Claude Code CLI (`claude`) authenticated locally
- Manim CE (`manim`) and `ffmpeg`
- optional: `ELEVENLABS_API_KEY` for voiceover, or paste it in the Studio voice menu

## Install

```bash
curl -fsSL https://manimate.ai/install.sh | bash
```

Then run:

```bash
manimate
```

## From Source

```bash
npm install
```

Optional voiceover:

```bash
cp .env.example .env.local
# then set ELEVENLABS_API_KEY in .env.local
```

You can also open the voice menu in Studio and paste your ElevenLabs API key there. Manimate saves it locally in `~/.manimate/config.json`, so users do not need to edit `.env.local` by hand.

## Run

```bash
manimate
```

In this repo, the equivalent command is:

```bash
npm run manimate
```

This starts the local app, opens the browser, and reconnects `manimate.ai` if needed.

For direct local development:

```bash
npm run dev
```

Then open `http://localhost:3000`.

## CLI

Open the app:

```bash
manimate
manimate --no-open
```

Stop the local app:

```bash
manimate stop
```

Generate from the shell:

```bash
manimate "Animate Laplace transform"
manimate "Animate Laplace transform" -m opus -a 16:9
manimate "Animate Laplace transform" -v Lci8YeL6PAFHJjNKvwXq
manimate "Animate eigenvectors" --no-voice
manimate -p "--animate a prompt that starts with a dash"
```

Generation returns one JSON object on `stdout`. `--show-events` prints readable progress to `stderr`. Voice is off by default, so only pass `-v` when voiceover is wanted. Do not pass `--json`.

Generate flags:

- `-p`, `--prompt <text>` use this when the prompt starts with `-`
- `-s`, `--session <id>` continue an existing session
- `-m`, `--model <opus|sonnet|haiku>`
- `-a`, `--aspect <16:9|9:16|1:1>`
- `-v`, `--voice <voice_id>`
- `--no-voice`
- `--base-url <url>`
- `--show-events`
- `--quiet`

Open flags:

- `--cloud-base-url <url>`
- `--no-open`
- `--restart`
- `--mode <auto|standalone|dev|start>`
- `--port <number>`
- `--host <hostname>`

Legacy `manimate open`, `manimate generate`, and `manimate connect` were removed. Use plain `manimate` to open the app and `manimate "<prompt>"` to generate.

Repo entrypoints:

```bash
npm run tool:open
npm run tool:generate -- "Animate Laplace transform"
node scripts/manimate-tool.mjs "Animate Laplace transform"
```

Example generation output:

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

Useful output fields:

- `status`: `completed` | `canceled` | `failed`
- `session_id`: session to inspect later
- `review_url`: browser review link
- `video_url`: rendered video URL, if present

Troubleshooting:

- If Manimate cannot be reached, start it with `manimate` or pass `--base-url`.
- If `status=failed`, inspect `/api/sessions/<session_id>/messages`.
- If cloud auth expired, run plain `manimate` to reconnect.

## HTTP API

Generate with:

- `POST /api/tool/generate`

Example request:

```json
{
  "prompt": "Animate eigenvectors in 2D",
  "model": "opus",
  "aspect_ratio": "16:9"
}
```

The endpoint materializes or reuses a session and streams SSE events from the same local generation pipeline used by the UI.

## Deep Links

The welcome screen supports:

- `prompt` or `q`
- `send=1`
- `model`
- `voice_id` or `voice`
- `aspect_ratio`

Examples:

- `http://localhost:3000/?prompt=Animate%20Taylor%20series`
- `http://localhost:3000/?prompt=Animate%20Bayes%20rule&send=1`

## Local Data

Default root: `~/.manimate/`

- `db/app.db`
- `sessions/<session_id>/project/`
- `sessions/<session_id>/project/inputs/`
- `sessions/<session_id>/artifacts/`

Override with `MANIMATE_LOCAL_ROOT`.
