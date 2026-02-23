# Sentry Setup

**Date**: 2026-02-15
**SDK**: `@sentry/nextjs@10.38.0`
**Dashboard**: https://yusuke-miyashita.sentry.io/issues/
**Org**: `yusuke-miyashita` / **Project**: `magent-nextjs`

## Free Tier Limits

- 5K errors/month
- 10K transactions/month
- 50 session replays/month

## Files

| File | Purpose |
|------|---------|
| `src/instrumentation-client.ts` | Client-side init, Session Replay, router transition hook |
| `src/instrumentation.ts` | Server/edge registration, `onRequestError` hook |
| `sentry.server.config.ts` | Server-side init |
| `sentry.edge.config.ts` | Edge runtime init |
| `src/app/global-error.tsx` | React error boundary for unhandled errors |
| `next.config.ts` | `withSentryConfig` wrapper for source map uploads |

## Env Vars

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | `.env` + Vercel (all envs) | SDK endpoint |
| `SENTRY_AUTH_TOKEN` | `.env` + Vercel (production + preview) | Source map upload at build time |

## Config Choices

- **`tracesSampleRate: 0.1`** — 10% of transactions sampled (keeps within free tier)
- **`replaysOnErrorSampleRate: 1.0`** — Record replay when errors occur
- **`replaysSessionSampleRate: 0`** — No baseline session recording (saves 50/month quota)
- **No tunnel route** — Would conflict with Supabase auth middleware, unnecessary for small beta
- **No Sentry MCP server** — Can add later for programmatic issue access from Claude Code
- **No PII collection** — `sendDefaultPii` removed

## Accessing Issues

1. Browse dashboard: https://yusuke-miyashita.sentry.io/issues/
2. Share issue URL with Claude Code to diagnose + fix
3. Optionally add Sentry MCP server later for direct API access
