# Credit System V3: Multi-Bucket with Markup

## Overview

Manus-style multi-bucket credit system with 2x markup on API costs (50% margin).

- **Conversion rate**: 200 credits = $1
- **Markup**: 2x (user pays 2x actual API cost in credits)
- **Effective rate**: 400 credits per $1 of API cost
- **Formula**: `credits_charged = ceil(api_cost_usd * 2 * 200)`

## Plan Tiers

| Plan | Price | Monthly Credits | Starter Credits | Daily Credits | Max Concurrent |
|------|-------|----------------|----------------|---------------|----------------|
| free | $0 | 0 | 1,000 | 300 | 1 |
| plus | $39/mo | 7,800 | 0 | 0 | 3 |
| pro | $199/mo | 39,800 | 0 | 0 | 10 |

**Credit math**: `price * 200 = credits`. Margin comes from 2x API markup, not fewer credits.

## Bucket Priority

Credits are consumed in this order (first available, first consumed):

1. **event** — promotional/temporary credits (expire)
2. **daily** — 300/day for free users (resets at UTC midnight)
3. **monthly** — paid plan allocation (resets monthly, no rollover)
4. **addon** — purchased top-ups (never expire)
5. **free** — starter credits from signup (never expire)

## New User Flow

1. `handle_new_user()` trigger fires on auth signup
2. Creates user row with `credits = 1300` (denormalized cache)
3. Calls `provision_credits(user_id, 'free')` which creates:
   - `free` bucket: 1,000 credits (source: `signup`, never expires)
   - `daily` bucket: 300 credits (expires end of UTC day)
   - `subscriptions` row: plan=free, status=active

## Credit Deduction

`debit_credits(user_id, cost, ...)` — atomic multi-bucket deduction:

1. Locks all user's non-expired buckets with `FOR UPDATE`
2. Deducts from buckets in priority order
3. Verifies full deduction (raises exception on shortfall)
4. Logs single transaction record with idempotency key
5. Syncs `users.credits` denormalized cache

Called from:
- `POST /api/chat` — post-run debit with `run-{runId}` idempotency key
- `POST /api/voiceover` — TTS debit with `voiceover-{jobId}` idempotency key

## Budget Enforcement

Pre-flight in chat API:
```
max_budget_usd = credits / (200 * 2) = credits / 400
```
Passed as `--max-budget-usd` to Claude Code CLI to prevent overspend mid-run.

## Cron Functions

- `reset_daily_credits()` — resets 300 daily credits for free users whose bucket expired
- `reset_monthly_credits()` — resets monthly credits for paid plans (no rollover)

## Top-Up Flow

`POST /api/credits/topup` (Stripe webhook or admin):
- Inserts into `credit_buckets` with `bucket_type = 'addon'` (never expires)
- Syncs `users.credits` cache via `get_available_credits()` RPC

## API Endpoints

- `GET /api/credits` — returns total + per-bucket breakdown + plan name
- `POST /api/credits/topup` — add credits (Stripe webhook / admin key)

## Example Cost

Opus task: 50K input + 5K output tokens
- Actual API cost: ~$0.375
- Credits charged: `ceil(0.375 * 2 * 200)` = 150 credits
- Face value to user: 150 / 200 = $0.75

## Key Files

- `supabase/migrations/20260212100000_credit_system_v3.sql` — all DB objects
- `src/lib/portkey.ts` — `CREDIT_MARKUP`, `apiCostToCredits()`, `creditsToMaxBudgetUsd()`
- `src/app/api/chat/route.ts` — pre-flight, mid-run, post-run debit
- `src/app/api/credits/route.ts` — bucket breakdown endpoint
- `src/app/api/credits/topup/route.ts` — addon bucket insert
- `src/app/api/voiceover/route.ts` — TTS credit debit
- `src/lib/supabase/database.types.ts` — `BucketType`, table types
