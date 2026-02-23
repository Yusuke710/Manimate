# Magent System Architecture

## High-Level Overview

Magent is a Manus-style AI agent that generates math animations (Manim) via conversational chat. Users describe what they want, Claude Code runs in a sandboxed environment to write and render Manim scripts, and the result is a video with optional voiceover narration.

```
                                    MAGENT SYSTEM
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                                                                             │
 │  ┌──────────────┐    SSE Stream     ┌──────────────────────────────────┐    │
 │  │              │ ◄──────────────── │                                  │    │
 │  │   Browser    │                   │    Next.js App Router            │    │
 │  │   (React)    │ ──────────────► │    (API Routes)                  │    │
 │  │              │   HTTP Requests   │                                  │    │
 │  └──────────────┘                   └──────────┬───────────────────────┘    │
 │                                                 │                           │
 │                          ┌──────────────────────┼──────────────────────┐    │
 │                          │                      │                      │    │
 │                          ▼                      ▼                      ▼    │
 │                  ┌──────────────┐    ┌──────────────────┐   ┌────────────┐ │
 │                  │  Supabase    │    │   E2B Sandbox    │   │ Cloudflare │ │
 │                  │  (DB+Auth)   │    │  (Claude Code    │   │    R2      │ │
 │                  │              │    │   + Manim)       │   │ (Storage)  │ │
 │                  └──────────────┘    └──────────────────┘   └────────────┘ │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## External Services

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                               │
│                                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │  Supabase   │  │    E2B      │  │   Portkey   │  │  ElevenLabs   │  │
│  │             │  │             │  │             │  │               │  │
│  │ - Postgres  │  │ - Sandbox   │  │ - LLM API   │  │ - TTS API     │  │
│  │ - Auth      │  │   runtime   │  │   gateway   │  │ - Voice gen   │  │
│  │ - Realtime  │  │ - Claude    │  │ - BYOK      │  │               │  │
│  │             │  │   Code CLI  │  │   (zero     │  │               │  │
│  │             │  │ - Manim     │  │   markup)   │  │               │  │
│  │             │  │ - FFmpeg    │  │ - Per-user  │  │               │  │
│  │             │  │             │  │   metadata  │  │               │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────────┘  │
│                                                                           │
│  ┌─────────────┐  ┌─────────────┐                                        │
│  │ Cloudflare  │  │   Stripe    │                                        │
│  │     R2      │  │             │                                        │
│  │             │  │ - Payments  │                                        │
│  │ - Video     │  │ - Credit    │                                        │
│  │   storage   │  │   top-up    │                                        │
│  │ - Image     │  │             │                                        │
│  │   storage   │  │             │                                        │
│  │ - CDN       │  │             │                                        │
│  └─────────────┘  └─────────────┘                                        │
└───────────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### Frontend (React/Next.js Client)

```
src/app/page.tsx                    Main page — ChatPanel + PreviewPanel
src/components/
├── AuthProvider.tsx                Supabase auth context
├── SessionsSidebar.tsx             Session list (left sidebar)
├── SplitPanel.tsx                  Resizable split layout
├── ChatInput.tsx                   Message input with image upload
├── ChatMessages.tsx                Message list with activity feed
├── PreviewPanel.tsx                Tabs: Plan | Code | Preview (video)
├── ShareButton.tsx                 Share session publicly
└── UserProfile.tsx                 User info + credits display
```

**State management**: `useReducer` in `page.tsx` with actions like `SET_VIDEO_URL`, `ADD_MESSAGE`, etc.

### API Routes (Next.js Server)

```
src/app/api/
├── chat/
│   ├── route.ts                   POST — Main SSE streaming endpoint (~1500 lines)
│   │                              Creates/connects E2B sandbox, runs Claude Code,
│   │                              streams progress, persists artifacts
│   └── uploads/
│       └── route.ts               POST — Upload images for chat (→ Storage)
├── sessions/
│   ├── route.ts                   POST — Create new session
│   └── [sessionId]/
│       ├── route.ts               GET — Session details + voiceover status
│       ├── messages/
│       │   └── route.ts           GET — Messages + signed URLs for video/images
│       └── share/
│           └── route.ts           GET/POST — Manage session sharing
├── share/
│   └── [sessionId]/
│       └── video/
│           └── route.ts           GET — Public video access via share token
├── voiceover/
│   └── route.ts                   POST — Generate voiceover (ElevenLabs + FFmpeg)
├── chapters/
│   └── route.ts                   GET/POST — Video chapter management
├── subtitles/
│   └── route.ts                   GET — Fetch subtitles from sandbox
├── files/
│   └── route.ts                   GET — Read files from sandbox
├── credits/
│   ├── route.ts                   GET — Check credit balance
│   └── topup/
│       └── route.ts               POST — Stripe webhook for credit top-up
├── cancel/
│   └── route.ts                   POST — Cancel running task
└── cron/
    ├── sandbox-status/
    │   └── route.ts               Cleanup stale sandbox sessions
    └── session-cleanup/
        └── route.ts               Archive old sessions
```

### Server Libraries

```
src/lib/
├── e2b.ts                         E2B sandbox create/connect/resume
├── artifact-persistence.ts        Read artifacts from sandbox, upload video to R2
├── r2.ts                          Cloudflare R2 storage (upload, download, presigned URLs)
├── portkey.ts                     Portkey gateway env vars, credit math, budget detection
├── elevenlabs.ts                  TTS generation with caching
├── sandbox-utils.ts               getProjectPath(sandboxId) helper
├── ndjson-parser.ts               Parse Claude Code NDJSON output
├── types.ts                       Shared types (Message, SSEEvent, ImageAttachment)
└── supabase/
    ├── server.ts                  createServerClient (RLS) + createServiceClient (admin)
    ├── client.ts                  createBrowserClient (client-side)
    └── database.types.ts          Generated Supabase types
```

## Data Flow: Chat → Video

```
User types prompt
       │
       ▼
  ┌─────────────┐
  │ POST /api/  │     1. Auth check (Supabase)
  │   chat      │     2. Credit check (Supabase) → --max-budget-usd
  │             │     3. Image download (Storage → sandbox)
  │  (SSE)      │     4. Create/connect E2B sandbox
  │             │     5. Run Claude Code CLI in sandbox
  │             │     6. Stream NDJSON progress → SSE events
  │             │     7. Read artifacts from sandbox
  │             │     8. Upload video.mp4 (sandbox → Storage)
  │             │     9. Persist to DB (messages, artifacts, chapters)
  │             │    10. Trigger voiceover (async POST /api/voiceover)
  └─────────────┘
       │
       ▼
  Browser receives SSE events, updates UI in real-time
  PreviewPanel polls /api/sessions/{id} for voiceover status
```

## Data Flow: Voiceover

```
POST /api/voiceover
       │
       ▼
  1. Download video from Storage
  2. Parse subtitles from sandbox (SRT file)
  3. Generate TTS per subtitle segment (ElevenLabs API)
  4. Mix audio + video via FFmpeg (in E2B sandbox)
  5. Upload voiced video to Storage (overwrites same key)
  6. Generate new signed URL
  7. Update session in DB (last_video_url, voiceover_status)
       │
       ▼
  PreviewPanel detects completion → seamless video swap
```

## Database Schema (Supabase Postgres)

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│     users       │     │    sessions      │     │    messages       │
│─────────────────│     │──────────────────│     │───────────────────│
│ id (uuid, PK)   │──┐  │ id (uuid, PK)    │──┐  │ id (uuid, PK)    │
│ email            │  │  │ user_id (FK)     │  │  │ session_id (FK)  │
│ credits          │  │  │ title            │  │  │ role             │
│                  │  │  │ status           │  │  │ content          │
│                  │  │  │ sandbox_id       │  │  │ metadata (jsonb) │
│                  │  │  │ claude_session_id │  │  │   → video_url    │
│                  │  │  │ snapshot_id      │  │  │   → images[]     │
│                  │  │  │ video_path       │  │  │ created_at       │
│                  │  │  │ last_video_url   │  │  └───────────────────┘
│                  │  │  │ script_content   │  │
│                  │  │  │ chapters (jsonb) │  │  ┌───────────────────┐
│                  │  │  │ voiceover_status │  │  │ activity_events  │
│                  │  │  │ voiceover_error  │  │  │───────────────────│
│                  │  │  │ is_public        │  │  │ id (serial, PK)  │
│                  │  │  │ share_token      │  └──│ run_id (FK)      │
│                  │  │  │ created_at       │     │ turn_id          │
│                  │  │  └──────────────────┘     │ type             │
│                  │  │                            │ message          │
│                  │  │  ┌──────────────────┐     │ payload (jsonb)  │
│                  │  │  │      runs        │     │ created_at       │
│                  │  │  │──────────────────│     └───────────────────┘
│                  │  └──│ session_id (FK)  │
│                  │     │ status           │     ┌───────────────────┐
│                  │     │ sandbox_id       │     │credit_transactions│
│                  │     │ claude_session_id│     │───────────────────│
│                  │     │ started_at       │     │ id (serial, PK)  │
│                  │     │ last_event_at    │     │ user_id (FK)     │
│                  │     └──────────────────┘     │ amount           │
│                  │                               │ balance_after    │
│                  └───────────────────────────────│ description      │
│                                                  │ usage_type       │
└─────────────────┘                               │ created_at       │
                                                   └───────────────────┘
```

## Storage Layer (Cloudflare R2)

```
R2 (S3-compatible API via @aws-sdk/client-s3)
├── magent-videos (private bucket)
│   └── {sessionId}/video.mp4            Video files
│       Access: Presigned URLs (1 hour TTL)
│       Auth: Server-side API keys
│
└── magent-chat-images (private bucket)
    └── {userId}/{sessionId}/{uuid}.ext  User-uploaded images
        Access: Presigned URLs (1 hour TTL)
        Auth: Server-side API keys + path prefix validation in code
```

### Storage Operations Map

```
                          ┌─────────────────────────┐
                          │    src/lib/r2.ts (NEW)   │
                          │                         │
                          │  uploadFile()           │
                          │  downloadFile()         │
                          │  getPresignedUrl()      │
                          │  getPresignedUrls()     │
                          └────────────┬────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
     ┌──────▼──────┐          ┌───────▼────────┐         ┌──────▼──────┐
     │   UPLOAD    │          │   DOWNLOAD     │         │  SIGN URL   │
     └──────┬──────┘          └───────┬────────┘         └──────┬──────┘
            │                         │                         │
   ┌────────┼────────┐        ┌───────┼────────┐     ┌─────────┼──────────┐
   │                 │        │                │     │         │          │
   ▼                 ▼        ▼                ▼     ▼         ▼          ▼
artifact-        uploads/   voiceover/      chat/  messages/  share/    artifact-
persistence.ts   route.ts   route.ts       route.ts route.ts  video/   persistence.ts
                                                    route.ts
(video.mp4)     (images)   (voiced         (image  (video +  (public   (video URL
                            video)          for     batch     video     after upload)
                                           Claude)  images)   access)
```

### Storage API (src/lib/r2.ts)

```
┌────────────────────────────────────────────────────────────────────┐
│  uploadFile(bucket, key, body, contentType, options?)              │
│  downloadFile(bucket, key) → ArrayBuffer                          │
│  getPresignedUrl(bucket, key, ttl?) → string                      │
│  getPresignedUrls(bucket, keys[], ttl?) → {path, signedUrl}[]     │
│                                                                    │
│  Auth: Server-side R2 API keys (no Supabase RLS for storage)      │
│  Access control: Code-level path prefix validation in routes       │
└────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

```env
# Supabase (DB + Auth — stays)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# E2B (sandbox runtime)
E2B_API_KEY=...
E2B_TEMPLATE=manim-claude

# Portkey (LLM API gateway — BYOK, zero token markup)
PORTKEY_API_KEY=...
PORTKEY_PROVIDER_SLUG=@magent

# ElevenLabs (TTS)
ELEVENLABS_API_KEY=...

# Stripe (payments)
STRIPE_WEBHOOK_SECRET=...
ADMIN_API_KEY=...

# Cloudflare R2 (NEW — replaces Supabase Storage)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_VIDEOS_BUCKET=magent-videos
R2_IMAGES_BUCKET=magent-chat-images
```

## Realtime Subscriptions

```
Browser  ◄────  Supabase Realtime (WebSocket)
   │
   ├── messages-{sessionId}     New messages + activity events
   │     INSERT on messages table
   │
   └── user-credits-{userId}    Credit balance updates
         UPDATE on users table
```

## Security Model

```
┌──────────────────────────────────────────────────────────┐
│                     SECURITY LAYERS                       │
│                                                          │
│  1. Auth: Supabase Auth (OAuth) — cookie-based sessions  │
│  2. DB:   Row-Level Security (user can only see own)     │
│  3. Storage: R2 server-side auth + path prefix check     │
│     - Videos: auth → session ownership check → presign   │
│     - Images: auth → path.startsWith(userId/) → presign  │
│  4. API:  Portkey + --max-budget-usd enforcement         │
│  5. Sandbox: E2B isolated runtime (no host access)       │
└──────────────────────────────────────────────────────────┘
```
