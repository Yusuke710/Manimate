# Cloud Connect — Local Manimate Changes

**Date**: 2026-03-17
**Status**: Planning
**Full plan**: `Manimate-Infra/docs/2026-03-17-open-source-cloud-connect-plan.md`

## What This Repo Needs To Build

Users install Manimate locally, run Claude on their own machine, and optionally connect to manimate.ai for a stable URL, video history, and sharing. This document covers only the changes to the local (`Manimate`) repo.

## Core Product Shape

- Claude Code, Manim, ffmpeg, and the full generation loop run on the user's machine
- Local SQLite + local filesystem remain the canonical runtime state
- When connected, Manimate mirrors a portable subset of each session into the authenticated `manimate.ai` account
- The cloud mirror should preserve the same `session_id`, so a local session can later be opened at `https://manimate.ai/app?session=<session_id>`
- `manimate.ai` is not the default executor in this mode; it is the account-backed history, artifact storage, and sharing surface for locally generated work

---

## Phase 1: Fix Build Blockers

These must be done before distribution is possible.

### 1.1 Self-host Figtree font
`src/app/layout.tsx` uses `next/font/google` which fetches from Google at build time. `npm run build` fails offline.

- Download Figtree woff2 files (weights 400/500/600) → `public/fonts/`
- Replace `import { Figtree } from "next/font/google"` with `localFont()` pointing to the public files

### 1.2 Remove CDN preconnect
`src/app/layout.tsx` has a `<link rel="preconnect" href="https://cdn.jsdelivr.net">`. Either bundle the KaTeX CSS locally in `public/` or remove the preconnect and load it lazily. Do not block the build on external CDN availability.

### 1.3 Fix `process.cwd()` asset paths
`src/lib/local/config.ts` resolves `CLAUDE.md`, `tts-generate.py`, and `lint-subtitles.py` from `process.cwd()`. When Manimate runs as a background daemon (started from a different working directory), these paths break silently.

- Replace `process.cwd()` with `path.resolve(new URL('../../..', import.meta.url).pathname, ...)` or equivalent so assets resolve relative to the installed package, not the launch directory.

### 1.4 Add Python requirements
Create `scripts/requirements.txt` listing all pip deps used by `tts-generate.py` (at minimum: `requests`).

---

## Phase 2: Install Script

New file: `install.sh` (repo root). This is what users run:

```bash
curl -fsSL https://manimate.ai/install.sh | bash
```

Steps:
1. Detect OS — exit with message on Windows
2. Check Node.js >= 22 — print install instructions if missing
3. Download release to `~/.manimate/app/`
4. `npm install --production && npm run build`
5. Install `manimate` shim to `~/.local/bin/manimate`
6. Run `manimate doctor`
7. Print: "Run `manimate` to launch locally and connect to manimate.ai if needed"

---

## Phase 3: `manimate` CLI

New file: `scripts/manimate.mjs` — the single entrypoint for all CLI operations.

### Commands

| Command | Description |
|---|---|
| `manimate doctor` | Check all dependencies, print status |
| `manimate start` | Start daemon in background |
| `manimate stop` | Stop daemon |
| `manimate status` | Show daemon status and cloud connection |
| `manimate` | Launch local app; if needed, start browser auth with manimate.ai |
| `manimate disconnect` | Remove cloud token |
| `manimate sync [--session <id>]` | Backfill or repair cloud mirror for local sessions |
| `manimate open` | Open local UI in browser |
| `manimate generate --prompt "..."` | One-shot generation (existing behavior) |

### `manimate doctor` checks

```
✓ claude --version          Claude Code CLI
✓ manim --version           Manim CE
✓ ffmpeg -version           ffmpeg
✓ ffprobe -version          ffprobe
✓ python3 --version         Python 3
✓ pip3 show requests        Python requests
~ ELEVENLABS_API_KEY        (optional) set in .env.local for voiceover
~ Cloud token               (optional) reconnect by reopening 'manimate'
```

---

## Phase 4: Cloud Connect + Session Sync Mode

### Session sync model

When connected, the local app should not only accept cloud-originated jobs. It should also push locally created sessions upward into the user's `manimate.ai` account.

- A local session and its cloud mirror share the same `session_id`
- Cloud ownership is tied to the connected account token
- Sync is incremental and idempotent: rerunning sync should repair drift, not create duplicates
- The cloud copy is sufficient for browsing, sharing, video playback, and timeline/history inspection in `manimate.ai`

### Portable data contract

Portable and should sync:

- session row: title, status, model, aspect ratio, voice selection, timestamps
- messages and message metadata
- uploaded chat attachments, rewritten from local absolute paths to cloud object keys
- runs and activity events
- plan/script/subtitles/chapters
- final video and thumbnail

Not portable by default:

- full sandbox filesystem
- live Claude CLI process state
- arbitrary extra project files that were never persisted as attachments or known artifacts

If an extra local file is required for later cloud-side editing or rerendering, it needs explicit upload/sync treatment. Otherwise the synced session is still valid for history/review/sharing, but not guaranteed to be fully resumable in a fresh cloud sandbox.

### Token storage
`~/.manimate/config.json`:
```json
{
  "token": "...",
  "userId": "...",
  "connectedAt": "2026-03-17T..."
}
```

### Reconnect flow
1. Generate a random `machineId`
2. Open browser: `https://manimate.ai/connect?device=<machineId>`
3. Poll `GET https://manimate.ai/api/devices/token?device=<machineId>` every 2s (timeout 5min)
4. On token received: save to `~/.manimate/config.json`, print "Connected"

### Daemon WebSocket client
When daemon starts and `~/.manimate/config.json` has a token:

1. Connect to `wss://manimate.ai/api/relay/connect` with `Authorization: Bearer <token>`
2. Ping every 30s, reconnect on disconnect with backoff (1s → 2s → 4s → max 60s)
3. On `job` message: run `handleLocalChatRequest` with the job's prompt/options, stream `progress` events back
4. Independently of relay jobs, watch local session mutations and enqueue cloud sync work for sessions created from the local UI or CLI
5. Use cloud sync APIs to upsert session rows, messages, runs/activity, and artifact metadata
6. Upload blobs (attachments, final MP4, thumbnail) to cloud object storage, then rewrite synced metadata to cloud object keys/URLs
7. Send `complete` message with the synced cloud session metadata

### Sync triggers

- On session creation: ensure cloud session exists for the connected user
- On message append: sync new messages and attachment metadata
- On run/activity updates: sync incremental timeline changes
- On artifact persistence: sync plan/script/subtitles/chapters deltas
- On render completion: upload video + thumbnail, then update cloud session
- On reconnect after offline use: drain unsynced local changes

### Backfill existing local sessions

Support copying a pre-existing local session into the connected cloud account after the fact. This is the key path for:

- a user who generated locally first, then later signs into `manimate.ai`
- a user who wants a localhost session to become accessible at `manimate.ai`
- repair/reimport of a specific session without rerunning generation

This should preserve the original `session_id` rather than minting a second cloud-only identifier.

### Environment variables (new, add to `.env.example`)
```bash
# Cloud connect (set automatically after opening `manimate`)
MANIMATE_CLOUD_TOKEN=
MANIMATE_CLOUD_URL=https://manimate.ai
```

### Offline / local-only mode
If no token or cloud unreachable: daemon runs exactly as today. Everything works at `http://localhost:32179`. No degradation, no error.

---

## Files To Create / Modify

| File | Action |
|---|---|
| `install.sh` | Create |
| `scripts/manimate.mjs` | Create (replaces `manimate-tool.mjs` as primary CLI) |
| `scripts/requirements.txt` | Create |
| `src/app/layout.tsx` | Modify — self-host font, remove CDN preconnect |
| `src/lib/local/config.ts` | Modify — fix `process.cwd()` paths |
| `src/lib/local/cloud-client.ts` | Create — WebSocket daemon + auth/session bootstrap |
| `src/lib/local/cloud-sync.ts` | Create — local session → cloud mirror sync logic |
| `src/lib/local/chat.ts` | Modify — emit sync hooks after local persistence changes |
| `src/lib/local/db.ts` | Modify — support dirty tracking / sync checkpoints if needed |
| `.env.example` | Modify — add cloud vars |

---

## What Does Not Change

- Core generation still runs locally, using the user's Claude Code + Manim install
- SQLite local DB remains the source of truth
- Existing local-only behavior still works when disconnected
- ElevenLabs TTS — unchanged, still optional

## Likely UI Changes

The main local UX should stay intact, but a connected build will probably want small affordances:

- sync status for the current session
- a way to open the cloud mirror for the active session
- optional manual backfill / retry sync action for existing local sessions
