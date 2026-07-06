# Manimate Minimal Architecture Review

Date: 2026-07-03

## Context

Manimate is not a general workflow platform. It is a local wrapper around Claude/Codex execution for Manim projects:

```text
Claude/Codex runner + session workspace
UI wrapper
SQLite memory
external share link
```

Claude or Codex remains the main execution engine. Manimate should start runs, observe canonical outputs, persist enough state for the UI, and optionally upload shareable artifacts.

## Main Finding

The architecture should be reduced. The previous design was too close to a mini platform with separate indexes, artifact tables, event streams, and queue concepts. From first principles, most of that is unnecessary for a product whose core loop is:

```text
user prompt -> claude -p / codex exec -> workspace files -> UI preview -> optional share URL
```

The simplest durable model is:

```text
sessions
turns
settings
```

## Ownership Boundaries

### Claude/Codex owns execution

- Runs inside the session project directory.
- Edits files freely.
- Uses `CLAUDE.md` / `AGENTS.md` as the product prompt layer.
- Produces canonical outputs.

### Manimate backend owns observation

- Starts and cancels runs.
- Streams live output to the current UI/CLI.
- Snapshots known outputs after or during a run.
- Updates SQLite with compact session/turn state.

### SQLite owns UI memory

- Stores sessions.
- Stores user turns and final assistant responses.
- Stores current status, errors, share URL, and key artifact pointers.
- Should not store every tool event.

### UI owns presentation

- Lists sessions.
- Opens a session.
- Starts/cancels a run.
- Displays canonical artifacts.
- Should not become a file-sync system or filesystem browser.

### R2/hosted Manimate owns distribution

- Uploads video/thumbnail/shareable outputs.
- Returns a share URL.
- Does not replace local SQLite as the local source of truth.

## Minimal SQLite Schema

### `sessions`

One row per Manimate project/session.

```text
id
title
status              idle | running | completed | failed | canceled
model               claude | codex
aspect_ratio
voice_id
agent_session_id    Claude/Codex resume id
video_path
thumbnail_path
share_url
share_status
share_error
last_status_message
last_error
created_at
updated_at
```

Do not store the workspace path. Derive it:

```text
~/.manimate/sessions/{session_id}/project
```

### `turns`

One row per user request / Claude run.

This replaces separate `messages`, `runs`, and most `activity_events`.

```text
id
session_id
prompt
response
status
model
pid
pgid
agent_session_id
attachment_metadata_json
started_at
finished_at
error
```

A turn is both the user message and the execution record. This matches the product model: user asks, Claude runs, final result is stored.

### `settings`

Local config only.

```text
key
value_json
updated_at
```

Examples:

- preferred model
- preferred voice
- ElevenLabs settings
- cloud auth token / hosted base URL

## Canonical Workspace Outputs

No separate artifact table is necessary for the first clean version.

Canonical files live in the workspace:

```text
plan.md
script.py
video.mp4 / final.mp4
subtitles.srt
chapters.json
thumbnail.jpg
```

SQLite only needs important pointers:

```text
sessions.video_path
sessions.thumbnail_path
sessions.updated_at
```

If a UI view needs `plan.md` or `script.py`, read that specific canonical file on demand.

## Minimal API Surface

Recommended API surface:

```text
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id
POST /api/sessions/:id/run
POST /api/sessions/:id/cancel
POST /api/sessions/:id/uploads
POST /api/sessions/:id/share
GET  /api/artifact?session_id=...&kind=...
GET/POST /api/settings
```

Artifact API should use canonical `kind`, not arbitrary file paths:

```text
kind=plan
kind=script
kind=video
kind=thumbnail
kind=subtitles
kind=chapters
```

This prevents the UI from becoming a general filesystem browser.

## APIs To Delete Or Avoid

These are unnecessary for the reduced architecture:

```text
/api/sessions/:id/messages
/api/thumbnail
/api/files?path=...
/api/events/*
/api/cloud-sync/retry
```

Notes:

- Session details can include turns or call a dedicated turn route if needed.
- Thumbnail is just `GET /api/artifact?kind=thumbnail`.
- Video is just `GET /api/artifact?kind=video`.
- Live events can stream during `POST /run`; historical events do not need to be preserved in SQLite.

## Event Persistence Decision

Do not persist every tool event to SQLite.

Current data showed more than 100k activity event rows. That is too much for the core product need.

Recommended behavior:

- Stream tool/progress events live to the active browser/CLI.
- Persist only:
  - `turn.prompt`
  - `turn.response`
  - `turn.status`
  - `turn.error`
  - `session.last_status_message`
  - `session.last_error`
- If debug logs are needed, write them to files:

```text
~/.manimate/sessions/{session_id}/run-{turn_id}.log
```

Not SQLite.

## Library Search

Keep library full-text search.

It is useful to search prior `plan.md` and `script.py` content for accurate reuse and review.

But it must be explicit:

```text
GET /api/sessions?include_search_content=1
```

or later:

```text
GET /api/library-search?q=...
```

Rules:

- Sidebar/default session list must stay lightweight.
- Library search may be heavier.
- Do not poll library search every few seconds.
- If history grows much larger, add SQLite FTS or a small search cache later.

## Current Code Changes Already Made

Implemented before this report:

- `GET /api/sessions` now returns a lightweight list by default.
- `GET /api/sessions?include_search_content=1` remains the explicit heavy library search path.
- Sidebar uses default `/api/sessions`.
- Sidebar refresh is visible/focus based and every 10s while visible.
- Library refresh is visible/focus based and every 60s while visible.
- Thumbnail GET no longer lazily runs ffmpeg.
- Cloud sync uses an existing thumbnail only.

Measured on current local data:

```text
GET /api/sessions
  ~288 KB for 1006 sessions

GET /api/sessions?include_search_content=1
  ~27.3 MB for 1006 sessions
```

## What To Simplify Next

1. Collapse `messages`, `runs`, and most `activity_events` into `turns`.
2. Remove long-term persistence of tool events.
3. Replace `/api/files?path=...` and `/api/thumbnail` with `GET /api/artifact?kind=...`.
4. Stop storing large plan/script/subtitle/chapter blobs in `sessions`.
5. Store only video/thumbnail/share pointers on `sessions`.
6. Keep raw run logs as files if needed for debugging.

## Review Questions For Another Agent

1. Is `turns` enough to replace `messages`, `runs`, and historical `activity_events`?
2. Should session detail embed all turns, or should turns have a separate endpoint?
3. Should `plan.md` and `script.py` be read on demand from files or cached in SQLite for library search?
4. Should library search use the current explicit heavy endpoint first, or move directly to SQLite FTS?
5. Can `/api/artifact?kind=...` fully replace `/api/files` and `/api/thumbnail` without hurting preview/video range requests?
6. What minimal run recovery is needed for killed/restarted servers? Is `pid`, `pgid`, and `status` enough, or do we need `heartbeat_at`?
7. Should cloud share status live on `sessions`, or is a separate table justified once share behavior grows?

## Recommended Target

The target architecture should be:

```text
Claude/Codex edits workspace

Backend:
  creates session
  starts one turn
  streams live output
  snapshots canonical outputs
  updates session row

SQLite:
  sessions
  turns
  settings

UI:
  list sessions
  open session
  start/cancel turn
  display canonical artifacts

R2:
  upload video/thumbnail
  return share_url
```

This keeps Manimate close to its real job: a polished local UI around Claude/Codex-powered Manim generation.
