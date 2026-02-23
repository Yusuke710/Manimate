# LiteLLM Fly.io Deployment Guide

This document describes how to deploy LiteLLM proxy to Fly.io with Supabase PostgreSQL for credit/spend tracking.

## Architecture

```
┌─────────────────────┐     ┌─────────────────────────┐
│  Next.js App        │────▶│  Fly.io (LiteLLM)       │
│  (Vercel)           │     │  magent-litellm.fly.dev │
└─────────────────────┘     └───────────┬─────────────┘
                                        │
┌─────────────────────┐                 │
│  E2B Sandbox        │─────────────────┘
│  (Claude Code)      │
└─────────────────────┘
                                        │
                            ┌───────────▼─────────────┐
                            │  Supabase PostgreSQL    │
                            │  (litellm schema)       │
                            └─────────────────────────┘
```

## Prerequisites

1. **Fly CLI**: `brew install flyctl`
2. **Fly.io account**: `fly auth login`
3. **Supabase project** with PostgreSQL database

## Files Created

### `litellm/Dockerfile`

```dockerfile
FROM ghcr.io/berriai/litellm:main-stable

COPY config.yaml /app/config.yaml

EXPOSE 4000

CMD ["--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
```

**Important**: The `--host 0.0.0.0` flag is required for Fly.io to route traffic to the container.

### `litellm/fly.toml`

```toml
app = 'magent-litellm'
primary_region = 'syd'  # Sydney, change to your preferred region

[build]

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  path = "/health/liveliness"

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
```

### `litellm/config.yaml`

```yaml
model_list:
  - model_name: claude-sonnet-4-20250514
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: claude-opus-4-5-20251101
    litellm_params:
      model: anthropic/claude-opus-4-5-20251101
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: "claude-*"
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
```

## Deployment Steps

### 1. Create the Fly App

```bash
cd litellm
fly launch --no-deploy --name magent-litellm --region syd
```

### 2. Get Supabase Connection String

Go to Supabase Dashboard → Settings → Database → Connection string → URI tab.

Use the **direct connection** format:
```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

**Note**: URL-encode special characters in password (e.g., `%` → `%25`, `+` → `%2B`).

### 3. Create LiteLLM Schema in Supabase

Run this migration in Supabase SQL Editor:

```sql
CREATE SCHEMA IF NOT EXISTS litellm;
```

Or apply via migration file: `supabase/migrations/20260205_create_litellm_schema.sql`

### 4. Set Fly Secrets

```bash
fly secrets set DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?schema=litellm"
fly secrets set ANTHROPIC_API_KEY="sk-ant-..."
fly secrets set LITELLM_MASTER_KEY="sk-your-master-key"
```

### 5. Deploy

```bash
fly deploy
```

### 6. Verify

```bash
# Health check
curl https://magent-litellm.fly.dev/health/liveliness
# Expected: "I'm alive!"

# List models
curl https://magent-litellm.fly.dev/v1/models \
  -H "Authorization: Bearer YOUR_LITELLM_MASTER_KEY"
```

## Problems Encountered & Solutions

### Problem 1: App not listening on expected address

**Error**:
```
WARNING The app is not listening on the expected address and will not be reachable by fly-proxy.
You can fix this by configuring your app to listen on the following addresses:
  - 0.0.0.0:4000
```

**Cause**: LiteLLM defaults to binding to `127.0.0.1`, but Fly.io requires `0.0.0.0`.

**Solution**: Add `--host 0.0.0.0` to the Dockerfile CMD:
```dockerfile
CMD ["--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
```

### Problem 2: Database hostname not resolving

**Error**: The direct Supabase hostname `db.[ref].supabase.co` wasn't resolving from Fly.io.

**Cause**: DNS resolution issue from Fly.io network.

**Solution**: The hostname does resolve, but intermittently. The app eventually connected successfully. If issues persist, try the pooler URL with session mode (port 5432).

### Problem 3: Prisma transaction timeout

**Error**:
```
prisma.engine.errors.EngineRequestError: 504: Transaction API error: Unable to start a transaction in the given time.
```

**Cause**: LiteLLM uses Prisma internally which requires transaction support. The Supabase connection was timing out.

**Solution**: Use the direct connection string (port 5432) with session mode, not transaction mode (port 6543). The `?schema=litellm` parameter isolates LiteLLM tables.

### Problem 4: LiteLLM user/key not found after fresh deployment

**Error**: API calls failed with "User not found" because the LiteLLM database was empty after deploying to Fly.io (fresh database).

**Cause**: Old user keys stored in Supabase `users.litellm_key_id` don't exist in the new LiteLLM database.

**Solution**: Create a new LiteLLM user and key, then update Supabase:

```bash
# Create user
curl -X POST "https://magent-litellm.fly.dev/user/new" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_UUID","max_budget":1000}'

# Generate key
curl -X POST "https://magent-litellm.fly.dev/key/generate" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_UUID","max_budget":1000}'

# Update Supabase with new key
UPDATE users SET litellm_key_id = 'sk-new-key' WHERE id = 'USER_UUID';
```

## Credit System

### Conversion Rate
- **200 credits = $1 USD** (Manus pricing)

### User Budget
- Starter: 1000 credits = $5 USD
- Daily: 300 credits = $1.50 USD
- Stripe purchases add to budget

### How It Works

1. Each user has a `max_budget` (USD) in LiteLLM
2. Each API call through LiteLLM tracks `spend`
3. When `spend >= max_budget`, LiteLLM rejects requests
4. App syncs credits: `credits = (max_budget - spend) * 200`

### Managing Budgets

```bash
# Get user info
curl "https://magent-litellm.fly.dev/user/info?user_id=UUID" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"

# Update budget
curl -X POST "https://magent-litellm.fly.dev/user/update" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"UUID","max_budget":100}'
```

## Environment Variables

### Fly.io Secrets
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string with `?schema=litellm` |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models |
| `LITELLM_MASTER_KEY` | Admin key for LiteLLM user/key management |

### App .env
| Variable | Description |
|----------|-------------|
| `LITELLM_BASE_URL` | `https://magent-litellm.fly.dev` |
| `LITELLM_MASTER_KEY` | Same as Fly.io secret |

## Useful Commands

```bash
# Check status
fly status

# View logs
fly logs --no-tail

# SSH into container
fly ssh console

# Redeploy after config changes
fly deploy

# Update secrets
fly secrets set KEY=value

# Rollback
fly releases list
fly releases rollback
```

## Cost

Fly.io shared-cpu-1x with 1GB RAM: ~$5-7/month
