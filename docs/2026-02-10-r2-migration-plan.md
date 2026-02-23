# R2 Migration: Supabase Storage → Cloudflare R2

## Overview
Replaced Supabase Storage with Cloudflare R2 for video and image storage. No data migration needed (not in production). Migration completed 2026-02-10.

## Architecture

```
E2B Sandbox → API Route → R2 (S3 API) ← Presigned URLs for private access
```

- All storage is private. Files are accessed via **presigned URLs** (same model as current Supabase signed URLs).
- CDN via custom domain is optional/future — presigned URLs work directly against the R2 endpoint.

**Two R2 buckets** (matching current Supabase buckets):
- `magent-videos` — video files at `{sessionId}/video.mp4`
- `magent-chat-images` — user-uploaded images at `{userId}/{sessionId}/{uuid}.{ext}`

## Environment Variables

```env
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-api-token-access-key>
R2_SECRET_ACCESS_KEY=<r2-api-token-secret>
R2_VIDEOS_BUCKET=magent-videos
R2_IMAGES_BUCKET=magent-chat-images
```

## Implementation Steps

### Step 1: Install dependencies

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Step 2: Create `src/lib/r2.ts` — R2 storage module (103 lines)

Thin wrapper around `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`.
Bucket names are read from env vars with sensible defaults.

Key design decisions:
- **Env var validation** at module load (console.error) + throw in `getClient()` for clear failure
- **Lazy-init singleton** S3Client
- **`downloadFile` returns `ArrayBuffer`** (not Blob) — simpler for call sites that write to sandbox or check `.byteLength`
- **`objectExists` helper** uses `HeadObject` with HTTP 404 status check (not error name) for `failIfExists`
- **`getPresignedUrls`** uses for-loop with `console.warn` on failures for debuggability
- **Exported `R2_SIGNED_URL_TTL_SECONDS`** — single source of truth, no duplicate constants in routes

### Step 3: Updated storage call sites (6 files)

All bucket references use the exported constants `VIDEOS_BUCKET` / `IMAGES_BUCKET`.

| File | Changes |
|------|---------|
| `artifact-persistence.ts` | `uploadFile(VIDEOS_BUCKET, ...)` + `getPresignedUrl(VIDEOS_BUCKET, ...)` |
| `voiceover/route.ts` | `downloadFile` (returns ArrayBuffer, written to sandbox), `uploadFile`, `getPresignedUrl` |
| `share/[sessionId]/video/route.ts` | `getPresignedUrl(VIDEOS_BUCKET, ..., R2_SIGNED_URL_TTL_SECONDS)` |
| `sessions/[sessionId]/messages/route.ts` | `getPresignedUrl` (default TTL) + `getPresignedUrls` for batch image signing |
| `chat/route.ts` | `downloadFile(IMAGES_BUCKET, ...)` — returns ArrayBuffer, used directly |
| `chat/uploads/route.ts` | `uploadFile(IMAGES_BUCKET, ..., { failIfExists: true })` |

### Step 4: R2 buckets set up in Cloudflare dashboard

Two buckets created: `magent-videos`, `magent-chat-images`. R2 API token with read/write access.

### Step 5: Verified

All routes tested:
- New session video generation → video.mp4 uploaded to R2
- Presigned video URL playback works
- Voiceover download/re-upload cycle works
- Old sessions gracefully degrade (empty player, no crash)
- R2 dashboard confirms data present

## Files Changed Summary

| File | Change |
|------|--------|
| `src/lib/r2.ts` | **NEW** — R2 storage module (103 lines) |
| `src/lib/artifact-persistence.ts` | Replace 2 storage calls |
| `src/app/api/voiceover/route.ts` | Replace 3 storage calls |
| `src/app/api/share/[sessionId]/video/route.ts` | Replace 1 storage call |
| `src/app/api/sessions/[sessionId]/messages/route.ts` | Replace 2 storage calls |
| `src/app/api/chat/route.ts` | Replace 1 storage call |
| `src/app/api/chat/uploads/route.ts` | Replace 1 storage call |
| `package.json` | Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |

## What Stays the Same
- Supabase DB for sessions, messages, users, etc. (unchanged)
- `sessions.video_path` column still stores the R2 key (same format: `{sessionId}/video.mp4`)
- `messages.metadata.images[].path` still stores the R2 key
- Signed URL TTL (1 hour) remains the same
- All access control logic stays server-side (auth checked before generating presigned URLs)
