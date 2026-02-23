# Migration from OpenRouter to Portkey

## Decision Summary

We replaced OpenRouter with Portkey as the API gateway for Claude Code in E2B sandboxes. Portkey gives us zero token markup, native image passthrough, and a drastically simpler architecture (-253 net lines of code).

## Why We Moved

### Problems with OpenRouter

1. **5.5% credit purchase fee**: OpenRouter charges 5.5% (min $0.80) on every credit purchase. At scale this adds up — a user buying $100 in credits loses $5.50 to gateway fees before any tokens are consumed.

2. **Image stripping**: OpenRouter silently stripped `image` content blocks from `tool_result` messages. Claude Code's native Read tool sends images as base64 in tool results, but OpenRouter dropped them. We had to build a 60-line vision workaround that intercepted images, called OpenRouter's vision API separately, and injected text descriptions back into the prompt. This was fragile, added latency, and produced worse results than native image understanding.

3. **Per-user key complexity**: OpenRouter's Provisioning API required creating, storing, and managing per-user API keys. Each user needed `openrouter_key` and `openrouter_key_hash` columns in the database. Key creation had race conditions (two concurrent requests could create duplicate keys). We needed periodic credit sync intervals (every 5 seconds) to poll OpenRouter for usage and update our local credit balance.

4. **Credit arbitrage model**: We had to maintain a margin calculation (credits-to-USD conversion with markup) to fund OpenRouter keys with less than what users paid. This added business logic complexity and made pricing opaque.

5. **Abort handling complexity**: When a user stopped a generation mid-run, we had to sync credits back from OpenRouter before invalidating the key, adding complexity to the abort flow.

### Benefits of Portkey

1. **Zero token markup (BYOK model)**: Portkey uses Bring-Your-Own-Key — our Anthropic API key is stored in their dashboard, and all token costs go directly to Anthropic at their published rates. No per-token markup whatsoever.

2. **Native image passthrough**: Portkey forwards all Anthropic message content blocks unchanged, including `image` blocks in `tool_result`. The 60-line vision workaround was deleted entirely. Claude Code reads images natively via its Read tool.

3. **No per-user keys**: Instead of provisioning individual API keys, Portkey uses a single gateway key with `x-portkey-metadata: {"_user":"userId"}` headers for per-user tracking. Zero database columns needed for key management.

4. **Simpler credit enforcement**: Credits are the source of truth in Supabase. On each run: read credits, convert to USD, pass `--max-budget-usd` to Claude Code CLI. After the run, debit actual cost via `debit_credits` RPC with idempotency. No polling, no sync intervals.

5. **Official Claude Code support**: Portkey works via `ANTHROPIC_BASE_URL` + `ANTHROPIC_CUSTOM_HEADERS` — the same mechanism Claude Code uses for custom API endpoints. No protocol translation needed.

## Cost Comparison

| | OpenRouter | Portkey |
|--|-----------|---------|
| **Platform fee** | None | $49/month (Pro) |
| **Token markup** | 0% (pass-through) | 0% (BYOK) |
| **Credit purchase fee** | 5.5% (min $0.80) | None |
| **Per-user keys** | Yes (Provisioning API) | No (metadata headers) |
| **Image support** | Stripped from tool_result | Native passthrough |
| **Request limit** | Unlimited | 100K/month (Pro), $9/100K overage |
| **Observability** | Basic usage per key | Logs, traces, per-user analytics |
| **Data retention** | N/A | 30 days (Pro) |

### Break-even Analysis

OpenRouter's 5.5% fee exceeds Portkey's $49/month flat fee when monthly credit purchases exceed ~$890/month. Below that, OpenRouter is cheaper on pure gateway cost. However, the engineering cost savings (no vision workaround, no key management, no credit sync) and the improved image quality (native vs described) justified the switch at any scale.

## Architecture Change

### Before (OpenRouter)

```
User sends prompt
  → Server creates/fetches OpenRouter per-user key
  → Sandbox uses key as ANTHROPIC_AUTH_TOKEN
  → OpenRouter proxies to Anthropic (strips images)
  → Vision workaround: intercept images, call vision API, inject description
  → 5-second credit sync interval polls OpenRouter for usage
  → On abort: sync credits from OpenRouter, invalidate key
  → ~1500 lines in chat/route.ts
```

### After (Portkey)

```
User sends prompt
  → Server reads credits from Supabase, converts to --max-budget-usd
  → Sandbox uses shared Portkey key + per-user metadata headers
  → Portkey proxies to Anthropic (images pass through natively)
  → Claude Code enforces budget via --max-budget-usd
  → On completion: debit actual cost via debit_credits RPC
  → ~1100 lines in chat/route.ts
```

## Code Impact

| File | Lines removed | Lines added | Net |
|------|--------------|-------------|-----|
| `src/app/api/chat/route.ts` | 327 | 65 | -262 |
| `src/app/api/credits/route.ts` | 82 | 19 | -63 |
| `src/app/api/credits/topup/route.ts` | 51 | 20 | -31 |
| `src/lib/e2b.ts` | 44 | 19 | -25 |
| `src/lib/portkey.ts` (new) | 0 | 91 | +91 |
| `.env.example` | 6 | 5 | -1 |
| **Total** | **510** | **219** | **-253** |

### What was deleted

- `syncCreditsFromOpenRouter()` — periodic polling function
- `creditSyncInterval` — 5-second timer
- `abortOpenRouterKey` — abort handler state
- Vision workaround — 60 lines of base64 interception + OpenRouter vision API call
- OpenRouter key provisioning — ~100 lines of create/fetch/race-condition logic
- `ALLOWED_MIMES` — MIME type list for vision workaround

### What was added

- `src/lib/portkey.ts` — 91 lines: env var builder, credit math, budget error detection
- `--max-budget-usd` flag on Claude Code CLI command
- Post-run `debit_credits` RPC call with idempotency key

## Environment Variables

**New (Portkey)**:
- `PORTKEY_API_KEY` — Gateway API key from Portkey dashboard
- `PORTKEY_PROVIDER_SLUG` — Provider config slug (default: `@magent`)

**Removed (OpenRouter)**:
- `OPENROUTER_PROVISIONING_KEY` — No longer needed (commented out for rollback)

**Sandbox env vars**:
- `ANTHROPIC_BASE_URL` = `https://api.portkey.ai`
- `ANTHROPIC_AUTH_TOKEN` = Portkey API key (shared, not per-user)
- `ANTHROPIC_CUSTOM_HEADERS` = Portkey routing headers with per-user metadata

## Scalability: Phase 2 Plan

### Current State (Phase 1 — Implemented)

Single shared Portkey API key with `x-portkey-metadata: {"_user":"userId"}` headers. Budget enforcement via `--max-budget-usd` CLI flag (client-side) and post-run `debit_credits` RPC.

**Known limitations at scale:**

| Concern | Impact | Mitigation |
|---------|--------|------------|
| Shared Anthropic rate limits | All users share one org's RPM/TPM pool (Tier 3: 2,000 RPM) | Acceptable until ~50 concurrent users |
| Client-side budget enforcement | `--max-budget-usd` enforced by Claude Code, not the gateway. Compromised sandbox could bypass. | E2B sandboxes have no egress by default |
| Concurrent overspend race | Two runs can each read full credits before either debits | Acceptable for MVP; rare with current user count |
| Key blast radius | Shared key leak affects all users | E2B sandbox isolation + no egress mitigates |

### Phase 2: Portkey Enterprise (When Scaling)

**Key finding: Portkey's gateway-enforced budget limits (usage limit policies, per-key budget limits, HTTP 412 enforcement) are Enterprise plan only — NOT available on Pro ($49/month).**

| Feature | Pro ($49/mo) | Enterprise (Custom) |
|---------|-------------|-------------------|
| Per-user API keys via Admin API | Yes | Yes |
| `x-portkey-metadata._user` tracking | Yes | Yes |
| Usage limit policies (gateway budget) | No | Yes |
| Per-key budget limits | No | Yes |
| HTTP 412 when budget exceeded | No | Yes |
| Rate limit policies | No | Yes |

**The Enterprise approach does NOT require per-user keys.** Portkey's policy engine can enforce per-user budgets via metadata grouping on the existing shared key:

```json
{
  "type": "usage_limits",
  "policy": {
    "conditions": [{"key": "metadata._user", "value": "*"}],
    "group_by": [{"key": "metadata._user"}],
    "credit_limit": 50,
    "type": "cost",
    "periodic_reset": "monthly",
    "status": "active"
  }
}
```

This means upgrading to Enterprise is a **zero code change** — the `x-portkey-metadata` headers are already in place. Just enable the policy.

When budget is exceeded, Portkey returns **HTTP 412 Precondition Failed**, blocking all subsequent requests for that user until reset.

### Why NOT Per-User Keys (OpenRouter-Style)

We evaluated re-creating OpenRouter's per-user key model on Portkey:

1. **Per-user keys without budget policies** (Pro plan) only help with blast radius reduction — they don't enforce budgets at the gateway level. Budget enforcement still relies on `--max-budget-usd`.

2. **Per-user keys with budget policies** (Enterprise) works but is unnecessary — the metadata group_by policy achieves the same isolation without managing keys.

3. **E2B gotcha**: Sandbox env vars are set at creation time and not refreshed on reconnect. Key rotation/revocation won't take effect in resumed sandboxes unless you recreate them or inject per-command env vars.

4. **Complexity regression**: Per-user key provisioning re-introduces the same management complexity we removed from OpenRouter (create/store/rotate/delete keys, race conditions, database columns).

### Comparison: Budget Enforcement Across Gateways

| | LiteLLM (Self-Hosted) | OpenRouter | Portkey Pro | Portkey Enterprise |
|--|---|---|---|---|
| Budget enforcement | Server-side (proxy) | Gateway (per-key limit) | Client-side (`--max-budget-usd`) | Gateway (policy, HTTP 412) |
| Per-user isolation | Virtual keys | Provisioning API keys | Metadata headers | Metadata group_by policy |
| Mid-run stopping | HTTP 400 on limit | HTTP 402 on limit | CLI-side budget flag | HTTP 412 on limit |
| Infrastructure | Self-hosted proxy | None | None | None |
| Token markup | None (BYOK) | 0% + 5.5% purchase fee | 0% (BYOK) | 0% (BYOK) |
| Image support | Pass-through | Stripped | Pass-through | Pass-through |

### Phase 2 Migration Checklist

When ready to upgrade to Portkey Enterprise:

1. Contact Portkey sales, negotiate Enterprise pricing
2. Enable usage limit policy with `metadata._user` group_by (zero code change — headers already in place)
3. HTTP 412 detection already added to `isBudgetExceededError()` in `src/lib/portkey.ts`
4. Keep `--max-budget-usd` as defense-in-depth (set slightly lower than gateway limit)
5. Add atomic credit reservations to prevent concurrent overspend race
6. Consider per-user rate limit policies for fair resource allocation

## Rollback Plan

OpenRouter code is preserved in `src/lib/openrouter.ts` (not imported by any active code). To rollback:
1. Restore OpenRouter imports in chat/credits routes
2. Uncomment `OPENROUTER_PROVISIONING_KEY` in `.env`
3. Re-add vision workaround and credit sync logic

We recommend staying with Portkey due to the significant code simplification and native image support.
