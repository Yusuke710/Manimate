# Rename: Magent → Manimate

**Date**: 2026-02-18

## What changed

All user-facing branding renamed from "Magent" to "Manimate" across the app:

- Page titles, metadata, logo SVG text
- Login page, sidebar, chat message labels
- Pricing page heading
- Stripe plan names (Manimate Plus / Pro / Credits)
- Chat init messages ("Manimate initialized" / "Manimate reconnected")
- Privacy policy and Terms of Use legal copy
- localStorage keys (`manimate-*` prefix)
- `CLAUDE.md` project name
- Profile icon SVG filename

## Infrastructure names NOT yet changed

The following still use the old `magent` name and should be updated when convenient:

- **Email addresses**: `magent.ai.app@gmail.com`, `privacy@magent.ai` (in terms + privacy pages)
- **Portkey provider slug**: `@magent/claude-opus-4-6` (in `src/lib/portkey.ts` + tests)
- **R2 bucket names**: `magent-videos`, `magent-chat-images` (in `src/lib/r2.ts`, `.env.example`)
- **Sentry project**: `magent-nextjs` (in `next.config.ts`)
- **Kimi SSE fix tmp path**: `/tmp/magent-kimi-sse-fix.mjs` (in `src/lib/kimi-sse-fix-script.ts`)
- **Docs**: Historical docs in `docs/` still reference "Magent" — left as-is since they're point-in-time records
