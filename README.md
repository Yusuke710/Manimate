# Manimate (Local-Only)

Local single-user version of Manimate with:

- local Claude Code runtime,
- local filesystem storage,
- local SQLite persistence,
- SSE chat streaming with session/run persistence.

## Prerequisites

- Node.js 22+
- Claude Code CLI (`claude`) authenticated with your local subscription
- Manim CE (`manim`) and `ffmpeg`
- ElevenLabs API key — set `ELEVENLABS_API_KEY` in `.env.local` for voiceover features

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

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

Run generation from shell/agents:

```bash
node scripts/manimate-tool.mjs generate --prompt "Animate Laplace transform" --json
```

Convenience npm script:

```bash
npm run tool:generate -- --prompt "Animate Laplace transform" --json
```

Useful flags:

- `--session <id>` reuse session
- `--model <opus|sonnet|haiku>`
- `--aspect-ratio <16:9|9:16|1:1>`
- `--voice <voice_id>`
- `--base-url <http://localhost:3000>`
- `--show-events` readable live event stream (stderr), while final JSON remains on stdout

Agent-facing tool spec (OpenClaw style):

- `docs/SKILL.md`

## Local Data Layout

Default root: `~/.manimate/`

- `db/app.db`
- `sessions/<session_id>/project/`
- `sessions/<session_id>/project/inputs/` (chat image attachments)
- `sessions/<session_id>/artifacts/`

Override root with `MANIMATE_LOCAL_ROOT`.

## Notes

- This repo is intentionally local-only.
- Voiceover works when `ELEVENLABS_API_KEY` is set.
- Advanced actions are chat-driven (for example, ask for `render in hq`) rather than dedicated API routes.
