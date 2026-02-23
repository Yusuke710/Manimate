# Migration from LiteLLM to OpenRouter

## Decision Summary

We migrated from a self-hosted LiteLLM proxy to OpenRouter's Provisioning API for per-user API key management and credit tracking.

## Why We Moved

### Problems with LiteLLM

1. **Infrastructure overhead**: Required hosting and maintaining a separate LiteLLM proxy server
2. **Complexity**: Needed to manage user creation, key generation, and budget tracking across two systems
3. **Cost**: Additional server costs for the proxy infrastructure
4. **Latency**: Extra network hop through the proxy added latency to API calls

### Benefits of OpenRouter

1. **No infrastructure**: OpenRouter handles everything - no proxy server to maintain
2. **Per-user API keys**: Provisioning API creates isolated keys with spend limits
3. **Built-in budget enforcement**: HTTP 402 returned when budget exceeded, automatically stopping Claude Code
4. **Real-time usage tracking**: Usage tracked per-key without additional implementation
5. **Simpler architecture**: Direct API calls with per-user authentication

## How It Works

### Credit Arbitrage Model

We use a "credit arbitrage" approach:
- Users purchase "Magent credits" at our price (200 credits = $1)
- We fund their OpenRouter key with less (applying our margin)
- Example: User pays $10 → we set $6.67 limit on their key (33% margin)

### Key Provisioning Flow

```
1. User signs up → No OpenRouter key yet
2. First API request → Create OpenRouter key via Provisioning API
3. Store key + hash in database (users.openrouter_key, users.openrouter_key_hash)
4. Sandbox uses ANTHROPIC_AUTH_TOKEN={user's key} + ANTHROPIC_BASE_URL=https://openrouter.ai/api
5. OpenRouter tracks usage automatically
6. When budget exceeded → HTTP 402 → Claude Code stops
```

### Environment Variables

**Sandbox (E2B)**:
- `ANTHROPIC_AUTH_TOKEN`: User's OpenRouter API key
- `ANTHROPIC_BASE_URL`: `https://openrouter.ai/api`
- `ANTHROPIC_API_KEY`: Empty string (required for OpenRouter)

**Server**:
- `OPENROUTER_PROVISIONING_KEY`: Management key for creating/updating user keys

## API Reference

### OpenRouter Provisioning API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/keys` | POST | Create new API key |
| `/api/v1/key` | GET | Get key info (with user's key) |
| `/api/v1/keys/{hash}` | PATCH | Update key limit |
| `/api/v1/keys/{hash}` | DELETE | Delete key |

### Key Response Structure

```json
{
  "key": "sk-or-v1-...",  // The actual API key (root level)
  "data": {
    "hash": "...",        // Key hash for updates (nested)
    "limit": 6.50,
    "usage": 0.0,
    "limit_remaining": 6.50
  }
}
```

## Database Changes

Added columns to `users` table:
- `openrouter_key`: The user's OpenRouter API key
- `openrouter_key_hash`: Hash for updating/deleting the key via Provisioning API

Migration: `supabase/migrations/20260209000000_add_openrouter_columns.sql`

## Code Structure

```
src/lib/openrouter.ts          # OpenRouter API integration
src/lib/e2b.ts                 # Sandbox creation (uses OpenRouter key)
src/app/api/credits/route.ts   # Credit status endpoint
src/app/api/chat/route.ts      # Chat API (provisions keys, tracks usage)
```

## Comparison

| Feature | LiteLLM | OpenRouter |
|---------|---------|------------|
| Infrastructure | Self-hosted proxy | Managed service |
| Key provisioning | Custom implementation | Provisioning API |
| Budget enforcement | HTTP 400 | HTTP 402 |
| Usage tracking | Query proxy | Built into key |
| Latency | +1 hop | Direct |
| Cost | Server + API | API only |

## Rollback Plan

If needed, the LiteLLM code is preserved in `src/lib/litellm.ts` and can be re-enabled by:
1. Setting `API_PROVIDER=litellm` in environment
2. Restoring LiteLLM imports in chat/credits routes
3. Deploying LiteLLM proxy server

However, we recommend staying with OpenRouter due to reduced complexity and infrastructure costs.
