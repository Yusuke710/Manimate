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

Launch the local app:

```bash
manimate
```

Packaged install flow for local verification:

```bash
npm pack
npm install -g ./manimate-0.1.0.tgz
manimate
```

Repo launcher script:

```bash
npm run manimate
```

Run generation from shell/agents:

```bash
manimate "Animate Laplace transform"
manimate -p "Animate Laplace transform"
manimate "Animate Laplace transform" -m opus -a 16:9
manimate "Animate Laplace transform" -m opus -a 16:9 -v Lci8YeL6PAFHJjNKvwXq
```

Generation returns JSON on stdout by default. `--show-events` prints progress to stderr. Voiceover is off by default; pass `-v <voice_id>` to opt in. If cloud auth expires, just reopen `manimate` and the browser reconnect flow will start again automatically.

Convenience npm script:

```bash
npm run tool:open
npm run tool:generate -- "Animate Laplace transform"
```

Useful launcher flags:

- `--cloud-base-url <https://manimate.ai>`
- `--port <3000>`
- `--host <127.0.0.1>`
- `--mode <auto|standalone|dev|start>`
- `--no-open`

Useful generate flags:

- `-s`, `--session <id>` reuse session
- `-m`, `--model <opus|sonnet|haiku>`
- `-a`, `--aspect <16:9|9:16|1:1>`
- `-v`, `--voice <voice_id>` opt into voiceover
- `--no-voice` explicit silent mode
- `--base-url <http://localhost:3000>`
- `--show-events` readable live event stream (stderr), while final JSON remains on stdout

Agent-facing tool spec (OpenClaw style):

- `docs/SKILL.md`

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
