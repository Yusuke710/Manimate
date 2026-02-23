# Manimate (Local-Only)

Local single-user version of Manimate with:

- local Claude Code runtime (no E2B),
- local filesystem storage (no R2),
- local SQLite persistence (no Supabase),
- SSE chat streaming with session/run persistence.

## Prerequisites

- Node.js 22+
- Claude Code CLI (`claude`) authenticated with your local subscription
- Manim CE (`manim`) and `ffmpeg`

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local Data Layout

Default root: `~/.manimate/`

- `~/.manimate/db/app.db`
- `~/.manimate/sessions/<session_id>/project/`
- `~/.manimate/sessions/<session_id>/uploads/`
- `~/.manimate/sessions/<session_id>/artifacts/`

Override root with `MANIMATE_LOCAL_ROOT`.

## Notes

- This repo is intentionally local-only.
- Supabase, E2B, and R2 integration paths are not part of this codebase.
- Voiceover works when `ELEVENLABS_API_KEY` is set.
- HQ render is local and keeps generated voiceover audio when available.
