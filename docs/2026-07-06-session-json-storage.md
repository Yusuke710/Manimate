# Why Manimate stores sessions as `session.json`, not SQLite

**Date**: 2026-07-06
**Status**: Accepted, implementation in progress
**Supersedes**: the four-table SQLite store at `~/.manimate/db/app.db` (`sessions`, `messages`, `runs`, `activity_events`)

## The problem

Manimate stored session data twice. The CLIs it delegates to already persist
complete transcripts of every run — Claude Code in `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`,
Codex in `~/.codex/sessions/` — while Manimate mirrored nearly the same
information into SQLite. The worst offender was `activity_events`: a lossy
re-recording of the CLI transcript (tool results truncated to 6 KB, some event
types dropped, Codex events reshaped) built during SSE streaming, making up the
bulk of the database. On top of that, `db.ts` carried ~836 lines of schema
definitions, column-migration plumbing, and row mappers — permanent
maintenance cost for what is, per session, a few kilobytes of conversation.

## The decision

One session = one directory. Each directory is complete, portable, and
self-describing:

```
~/.manimate/sessions/<id>/
├── session.json             # conversation + metadata (source of truth)
├── transcripts/<run>.jsonl  # verbatim CLI transcript, copied at run end
├── thumbnail.jpg
└── project/                 # plan.md, script.py, video.mp4, ... (the skill layer's files)
```

- **`session.json`** holds the curated state: user prompts, final assistant
  replies, per-turn run outcomes, video metadata (relative path + mtime
  version), chapters, cloud-sync state. Small (~6 KB for a typical session),
  rewritten a few times per turn.
- **`transcripts/`** holds the exact agentic trace: a byte-for-byte copy of the
  CLI's own JSONL, made once when a run finishes. Nothing is re-encoded.
- **`project/`** is never duplicated into JSON. `plan.md` / `script.py` /
  `subtitles.srt` are read from disk where they already live.
- **SSE is live-only.** Tool activity streams to the browser during a run but
  is not persisted in any Manimate-specific format. After a reload, a past turn
  shows the prompt, the reply, and the video — the full trace is in
  `transcripts/` if ever needed.

## Why files beat SQLite here

The deciding observation: SQLite's genuine advantages — cross-session SQL,
column-level concurrent updates, cross-process locking, cheap appends, FTS —
all kick in with **more data, more writers, or more query types** than Manimate
has. Today: one user, one Next.js server process, ~1,000 sessions, a few small
writes per turn, two query patterns (list, search). At that point SQLite is
insurance, and its premium is 800+ lines of code plus a second source of truth
that can drift from the session directory.

What tipped it beyond code size:

1. **One format everywhere.** `session.json` is near-verbatim the payload
   cloud sync uploads to Cloudflare. Local disk and cloud snapshot stop being
   two formats with a converter between them.
2. **Portability.** Relative paths inside the file mean copying a session
   directory to another machine (or `rm -rf`-ing it) is a complete, clean
   operation. With SQLite, directories and DB rows could orphan each other.
3. **Agents are the future readers.** For the planned in-context-learning use
   case (agents retrieving past sessions as examples), files are the substrate
   agents natively grep. A database would need an API layer in between.
4. **The migration asymmetry.** Files → SQLite is a trivial import script
   (walk dirs, insert rows); a live SQLite schema → files is a messy one-time
   extraction. Starting with files keeps SQLite a cheap future option instead
   of a decision to unwind. We are doing the messy direction once, now, so we
   never have to do it under pressure.

## Why the trace is a verbatim CLI transcript copy

Claude Code auto-deletes its transcripts after ~30 days (`cleanupPeriodDays`),
so the trace had to be preserved somewhere — but *re-recording* it (the old
`activity_events` approach) was both lossy and redundant. Copying the CLI's
own file at run completion is:

- **Exact** — includes everything Manimate's SSE parser truncates or drops.
- **Cheap** — one `copyFile` per run instead of thousands of DB writes.
- **Standard** — the Hugging Face Hub renders Claude Code / Codex / Pi JSONL
  sessions unmodified in its trace viewer ([Agent Traces](https://huggingface.co/docs/hub/agent-traces)),
  so traces are already publishable as datasets for ICL or sharing without
  inventing a format. Pi's ecosystem made the same split we did: curated
  session file + append-only raw trace as separate artifacts.

Transcripts stay **local-only by default**. They contain command output, local
paths, and potentially secrets; cloud sync uploads `session.json` + video +
thumbnail, not traces. (If a share-traces feature ever lands, borrow
`pi-share-hf`'s approach: redact known secrets, run TruffleHog, review before
upload.)

## Load-bearing implementation details

These three are not optional; the design is unsafe without them:

1. **Atomic writes** — write to a temp file, then rename. A crash mid-write
   must never corrupt a session's history.
2. **Per-session mutation queue** — `chat.ts` and `cloud-sync.ts` update the
   same session concurrently. Whole-file rewrites turn independent column
   updates into read-modify-write races; every mutation goes through one
   serialized function per session.
3. **In-memory list cache** — the sessions sidebar polls aggressively; the
   list view must not re-scan ~1,000 directories per poll.

Also kept: the run heartbeat (previously `runs.last_event_at`, now inside
`session.json`). It exists because Next.js can load route modules as separate
instances, so the in-memory process registry alone can't prove a run is alive
(see a99e96d "Fix runs falsely marked interrupted mid-render").

## Migration and rollback

`scripts/migrate-sessions-to-json.mjs` performs the one-time conversion
(`--dry-run` to preview, `--force` to overwrite). It also backfills
`project/plan.md` / `script.py` / `subtitles.srt` from the DB content columns
when the file is missing on disk, so dropping those columns loses nothing —
the 2026-07-06 run backfilled artifacts for 637 of 1016 sessions.

Safety nets, in order of durability:

1. **Consistent pre-migration backup** at
   `~/.manimate/backups/app-pre-session-json-2026-07-06.db` (190 MB, 1016
   sessions / 5467 messages, taken via `sqlite3 .backup` on 2026-07-06).
2. The **original database** at `~/.manimate/db/app.db` is never modified or
   deleted by the migration; the new code simply stops opening it.
3. `session.json` files themselves are a clean import format if SQLite ever
   returns (see tripwires below).

Note on subtitles: `subtitles.srt` in the project dir is now the canonical
on-disk location. It is derived (from `timestamps.json` / per-scene SRTs) and
written there by the app, replacing the old `subtitles_content` DB column as
the cache.

## When to revisit (tripwires)

Reopen the SQLite question if any of these happen:

- **A second writer process** that bypasses the Next.js server — a headless
  CLI, a background sync daemon, a cron job writing session state directly.
  This is the non-negotiable one: files have no cross-process locking story.
- The library grows past **~5–10K sessions** or search feels slow.
- A feature needs **append-style history or cross-session analytics** back.

The import script back to SQLite is deliberately trivial: `session.json` files
are a clean, self-describing export format.

## What was rejected

- **Keep SQLite, slim the schema** — smaller diff, but keeps two formats
  (DB + cloud snapshot), keeps migrations forever, and doesn't make session
  dirs self-contained. Chosen against because the goal is a light app layer
  around the skill engine, not a smaller database.
- **kokoro-style hybrid (SQLite + snapshot files)** — considered as a middle
  path; rejected as two sources of truth once full JSON proved sufficient.
- **Adopting HF's STS-Format or Pi's session format for our own trace** —
  unnecessary; Manimate delegates to Claude Code/Codex, whose native formats
  are already ecosystem-standard. STS only becomes relevant if Manimate ever
  becomes its own harness.
