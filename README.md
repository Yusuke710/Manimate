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
- HQ render is local and keeps generated voiceover audio when available.
