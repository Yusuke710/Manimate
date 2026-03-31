# Autosync Library MVP

**Date**: 2026-03-31
**Status**: In progress

## Product shape

Every completed local render should sync to `manimate.ai` automatically.

The synced cloud copy has two distinct sharing surfaces:

- **Public video**: visible in the public library and on a public video page
- **Process share**: explicit owner action that exposes the full mirrored session

Public video must **not** expose prompt/messages/script/subtitles/process by default.

## User-facing behavior

### Local Manimate

- User connects local Manimate to `manimate.ai`
- Every completed local render enqueues autosync
- Local session keeps working even if autosync fails
- Sync status is visible per session

### manimate.ai

- **My Videos** shows every synced video for the owner
- **Public Library** shows only video-first cards
- Public video page shows:
  - video
  - title
  - creator
  - date
  - aspect ratio
- Full process is only accessible through **Share Process**

## Data model

### Local repo (`Manimate`)

Keep local SQLite + filesystem as source of truth during generation.

Add local sync state to sessions:

- `cloud_sync_status`
- `cloud_last_synced_at`
- `cloud_last_error`
- `cloud_public_video_url`

### Infra repo (`Manimate-Infra`)

Keep using hosted `sessions`, `messages`, `runs`, and `activity_events` for the mirrored copy.

Add public-video metadata on hosted sessions:

- `public_video_visibility` (`public` | `hidden`)
- `public_video_slug` (stable public URL key)
- `synced_from_local`
- `synced_from_local_at`

Keep process sharing separate from public video visibility.

## Sharing model

### Public video

- default: `public`
- browsable in `/library`
- watchable in `/v/[slug]`
- video only

### Process share

- created explicitly by owner
- separate share token/path
- read-only hosted session snapshot with:
  - messages
  - runs
  - activity events
  - plan
  - script
  - subtitles
  - chapters
  - attachments
  - final video

## MVP implementation order

1. Add hosted schema for public-video metadata
2. Add hosted public-library list route
3. Add hosted public video page
4. Add owner API to read/update public-video visibility
5. Add local sync-state columns and helper hooks
6. Add autosync uploader after completed local runs
7. Add read-only process-share route/page

## Explicit non-goals for this slice

- Cloud-originated prompt dispatch to local Claude
- WebSocket relay
- Mid-run live cloud sync
- Full sandbox filesystem sync
- Cloud-side rerendering

## Notes

- The full mirrored session should sync for owner/history/process sharing
- The public library should remain intentionally video-first
- Public video and process share must remain separate concepts in code and UI
