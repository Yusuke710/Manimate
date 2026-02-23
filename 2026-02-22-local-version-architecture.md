# Local Manimate Architecture Plan (Single-User, No Supabase/R2/E2B)

Date: 2026-02-22  
Status: Draft for implementation  
Owner: Local deployment track

## 1. Goal

Build a fully local version of Manimate that:

- uses local compute (no E2B),
- uses local storage (no R2),
- uses local persistence (no Supabase),
- preserves current interaction model (session IDs, Claude session continuity, SSE activity stream),
- runs Claude Code via existing local Claude subscription (no Anthropic API billing path).

## 2. Scope and Constraints

### In Scope

- Single trusted local user.
- One machine deployment.
- Keep current product behavior where practical:
  - `session_id` lifecycle,
  - `claude_session_id` resume behavior,
  - streaming progress/activity events,
  - persisted messages/runs/artifacts.

### Out of Scope

- Multi-user tenancy.
- Hosted auth providers.
- Remote object storage and signed URLs.
- SaaS billing/subscription flows (Stripe/Credit wallet model can be disabled or simplified).

## 3. Feasibility Summary

Overall feasibility: **High** for local single-user version.

Why:

- Current code already has clear boundaries for compute/storage/auth integrations:
  - compute in `src/lib/e2b.ts`,
  - storage in `src/lib/r2.ts`,
  - persistence/auth in Supabase helpers/routes.
- Session continuity fields already exist and are used in core orchestration:
  - `sessions.id`,
  - `sessions.sandbox_id`,
  - `sessions.claude_session_id`.
- Core orchestration is centralized in `src/app/api/chat/route.ts`, which can be adapted behind local interfaces.

Local machine capability check (this environment):

- `claude`: available (`2.1.34`)
- `manim`: available (`0.19.1`)
- `ffmpeg`: available (`8.0.1`)

## 4. Critical Subscription Constraint (Claude Code)

To avoid API charges and use existing subscription:

- run Claude Code in authenticated subscription mode,
- do not set `ANTHROPIC_API_KEY` in local-mode runtime,
- disable model paths that require API gateways (Portkey/Kimi path).

Implication:

- local mode is Claude-model-only unless a separate paid API mode is intentionally added.

## 5. Target Architecture (Local)

```text
Browser (existing React UI)
      |
      v
Next.js API Routes (local mode)
      |
      +--> Local Runtime Manager
      |      - spawn/monitor Claude CLI
      |      - parse NDJSON stream
      |      - manage run PID + cancellation
      |      - maintain workspace per session
      |
      +--> Local DB (SQLite)
      |      - sessions, messages, runs, activity_events
      |
      +--> Local Artifact Store (filesystem)
             - uploads, plan/script/subtitles, video outputs, voiceover cache
```

## 6. Local Data and Filesystem Design

### Root Layout

Use a single local root, for example:

`~/.manimate/`

Proposed structure:

- `~/.manimate/db/app.db`
- `~/.manimate/sessions/<session_id>/project/`
- `~/.manimate/sessions/<session_id>/uploads/`
- `~/.manimate/sessions/<session_id>/artifacts/`
- `~/.manimate/logs/`

### Session Workspace

Per session:

- `project/plan.md`
- `project/script.py`
- `project/subtitles.srt`
- `project/video.mp4`
- `project/media/...` (manim output)
- `project/voiceover_cache/...`

This preserves the same mental model as current E2B project directories.

## 7. Local Persistence Model

Replace Supabase tables/RPC with SQLite tables and query helpers.

Minimum tables to preserve behavior:

- `sessions`
- `messages`
- `runs`
- `activity_events`

Optional local-only tables:

- `app_user` (single row for profile/preferences),
- `settings` (feature flags, defaults),
- `credit_transactions` only if local credit simulation is retained.

Recommended retained columns:

- Sessions:
  - `id`, `title`, `status`,
  - `sandbox_id` (local runtime/workspace id),
  - `claude_session_id`,
  - `model`, `aspect_ratio`, `voice_id`,
  - `video_path`, `last_video_url`,
  - `plan_content`, `script_content`, `subtitles_content`,
  - `chapters`, `voiceover_status`, `voiceover_error`,
  - timestamps.
- Runs:
  - `id`, `session_id`, `status`, `sandbox_id`, `claude_session_id`,
  - `started_at`, `last_event_at`, `finished_at`,
  - `error_message`, `video_url`.
- Messages:
  - `id`, `session_id`, `role`, `content`, `metadata`, `created_at`.
- Activity events:
  - `id`, `session_id`, `run_id`, `turn_id`, `type`, `message`, `payload`, `created_at`.

## 8. API Behavior Compatibility

Keep existing route contracts where possible to minimize frontend changes:

- `POST /api/sessions`
- `GET /api/sessions/[sessionId]`
- `GET /api/sessions/[sessionId]/messages`
- `POST /api/chat` (SSE)
- `POST /api/chat/uploads`
- `GET /api/files`
- `GET /api/subtitles`
- `GET /api/chapters`
- `POST /api/cancel`
- `POST /api/voiceover`
- `POST|DELETE /api/render-hq`

### What changes under the hood

- Supabase RPC calls -> local query layer (SQLite).
- R2 upload/download/signing -> local path resolution and file-serving routes.
- E2B connect/create -> local workspace + local process manager.

## 9. Runtime Manager Design (replacing E2B)

Responsibilities:

- create/resolve workspace for a session,
- spawn Claude CLI with `stream-json`,
- stream events to SSE clients,
- track PID and run metadata for cancellation/reconnect,
- recover latest persisted state after client disconnect.

### Session continuity

- On each run, capture NDJSON `session_id` as `claude_session_id`.
- Persist to `sessions.claude_session_id`.
- On next run for same session, pass `--resume <claude_session_id>` when valid.

### `sandbox_id` in local mode

Keep field for compatibility, mapped to local runtime/workspace identifier.

## 10. Storage Layer Design (replacing R2)

Introduce local storage adapter with equivalent operations:

- `uploadFile` -> write file under local root
- `downloadFile` -> read file from local path
- `getPresignedUrl` -> return local API URL (or direct file URL if trusted local UI)

Recommended approach:

- Serve videos/images via existing API endpoints with auth disabled in local mode.
- Keep path-based ownership checks simple or bypassed (single trusted user).

## 11. Auth and User Model (single-user local)

Recommended simplification:

- remove Supabase auth dependency in local mode,
- middleware treats all requests as authenticated local user,
- fixed local user id in config (for compatibility with existing ownership fields).

Alternative:

- optional local passcode/session cookie layer for non-trusted LAN usage.

## 12. Credits, Billing, and Plan Logic

For local mode:

- disable Stripe and subscription routes,
- either:
  - remove credit enforcement entirely, or
  - keep a simple local counter for UI compatibility.

Recommendation:

- start with no hard credit enforcement,
- keep `credit_update` SSE events optional with placeholder values.

## 13. Execution Flows

### A. New session + first generation

1. Create `session_id` in SQLite.
2. Create local workspace.
3. Start run record.
4. Spawn Claude CLI.
5. Stream progress/activity events over SSE.
6. Persist messages, run status, artifacts.
7. Return `complete` event with local video URL/path.

### B. Existing session continuation

1. Load session by `session_id`.
2. Resolve workspace and `claude_session_id`.
3. Run Claude with `--resume` when applicable.
4. Persist updated artifacts and metadata.

### C. Cancel run

1. Resolve active PID for session/run.
2. Send graceful terminate, then force kill if needed.
3. Mark run canceled.
4. Keep workspace intact for future continuation.

## 14. Migration Strategy

### Phase 1: Local MVP (fast path)

- Add `LOCAL_MODE=true` feature flag.
- Introduce local adapters:
  - DB adapter (SQLite),
  - storage adapter (filesystem),
  - runtime adapter (local process manager).
- Route implementations switch to adapter interfaces in local mode.
- Keep frontend unchanged as much as possible.

Deliverable: Generate video end-to-end locally with persisted sessions and resume.

### Phase 2: Reliability

- Move long-running jobs to a worker-like local supervisor process (or robust background manager).
- Add restart-safe run recovery.
- Improve cancellation and stale-run cleanup.

Deliverable: Reconnect/resume works across client refreshes and server hiccups.

### Phase 3: Full feature parity

- Voiceover and HQ render fully local.
- Share/export behavior adapted for local files.
- Replace realtime subscriptions with polling/SSE replay where needed.

Deliverable: Feature set close to current hosted behavior without external services.

## 15. Main Risks and Mitigations

### Risk: Claude subscription limits

Impact:

- heavy or parallel runs may hit usage caps sooner than expected.

Mitigation:

- enforce one active run per session (or globally at first),
- surface clear UI errors for throttling/limit events.

### Risk: CLI auth/session instability

Impact:

- Claude CLI may require re-login or session refresh.

Mitigation:

- preflight check at startup,
- clear error instructions in UI,
- optional health endpoint for local diagnostics.

### Risk: In-process job loss on app restart

Impact:

- active run may be interrupted if Next.js process restarts.

Mitigation:

- move execution to supervised local worker in Phase 2.

### Risk: Path and process security on shared machine

Impact:

- local file exposure or command misuse.

Mitigation:

- strict workspace path normalization,
- explicit allowed file roots,
- single-user trust assumption documented.

## 16. Acceptance Criteria

Local mode is acceptable when:

- new session creation works without Supabase,
- chat SSE generation works using local Claude CLI,
- `session_id` persists and session reload restores history,
- `claude_session_id` resume works across turns,
- video artifacts are generated, stored, and playable locally,
- cancel works and preserves workspace state,
- no Supabase/R2/E2B environment variables are required.

## 17. Suggested File-Level Refactor Boundaries

These are architectural boundaries, not implementation details.

- Keep route shapes; replace service implementations:
  - `src/lib/e2b.ts` -> runtime interface + local runtime implementation.
  - `src/lib/r2.ts` -> storage interface + local storage implementation.
  - `src/lib/supabase/*` usage in routes -> db interface + local db implementation.
- Keep orchestration in `src/app/api/chat/route.ts`, but progressively extract:
  - request validation,
  - run lifecycle management,
  - CLI execution parsing,
  - artifact finalization.

## 18. Decision Log (Current)

- Single-user local trust model: **Accepted**.
- Preserve session semantics (`session_id`, `claude_session_id`): **Accepted**.
- Remove Supabase/R2/E2B dependencies in local mode: **Accepted**.
- Prioritize behavior compatibility over architectural purity for first iteration: **Accepted**.
