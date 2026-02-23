# Why LiteLLM is Essential for Magent's Usage Tracking

## The Problem: Tracking Usage Inside Claude Code is Hard

When running Claude Code (Anthropic's CLI tool), tracking API usage per-user is challenging for several reasons:

### 1. Claude Code Manages Its Own API Calls
Claude Code is an autonomous agent that makes multiple API calls during a single task:
- Initial prompt processing
- Tool calls (file reads, writes, bash commands)
- Multi-turn conversations
- Sub-agent spawning for complex tasks

You don't control when or how many API calls are made - Claude Code decides based on the task.

### 2. No Built-in Per-User Tracking
The Anthropic API tracks usage at the API key level, not per-user. If you have one API key shared across all users, you cannot:
- Know how much each user consumed
- Set individual spending limits
- Stop a specific user when they exceed their budget

### 3. Real-Time Budget Enforcement is Impossible
Without a proxy layer, you would need to:
- Query the Anthropic API after each call to check usage
- Manually calculate costs from token counts
- Implement your own rate limiting logic
- Risk overruns while waiting for usage data to sync

### 4. Stopping Mid-Generation is Not Supported
Once Claude Code starts a task, there's no native way to:
- Stop it when a user hits their credit limit
- Interrupt long-running agent loops
- Enforce hard spending caps in real-time

## The Solution: LiteLLM Proxy

LiteLLM acts as an intelligent proxy between Magent and the Anthropic API, solving all these problems.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Magent App                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  User A  │  │  User B  │  │  User C  │  │  User D  │        │
│  │ (key_a)  │  │ (key_b)  │  │ (key_c)  │  │ (key_d)  │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
└───────┼─────────────┼─────────────┼─────────────┼───────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LiteLLM Proxy                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Per-User Budget Tracking & Enforcement                    │ │
│  │  • key_a: $6.50 budget, $2.30 spent                        │ │
│  │  • key_b: $6.50 budget, $6.48 spent (near limit!)          │ │
│  │  • key_c: $20.00 budget, $5.00 spent                       │ │
│  │  • key_d: $6.50 budget, $6.50 spent (BLOCKED)              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            │                                    │
│                   Single Anthropic API Key                      │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Anthropic API  │
                    │   (Claude)      │
                    └─────────────────┘
```

## How LiteLLM Solves Each Problem

### 1. Per-User API Keys with Individual Budgets

When a user signs up, Magent creates a unique LiteLLM virtual key for them:

```typescript
// From src/lib/litellm.ts
export async function createLiteLLMUser(userId: string, email: string) {
  // Create user with budget
  const userResponse = await fetch(`${baseUrl}/user/new`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${masterKey}` },
    body: JSON.stringify({
      user_id: `magent_${userId}`,
      user_email: email,
      max_budget: 6.50,  // Default $6.50 budget
    }),
  });

  // Create per-user API key
  const keyResponse = await fetch(`${baseUrl}/key/generate`, {
    method: 'POST',
    body: JSON.stringify({
      user_id: `magent_${userId}`,
      max_budget: 6.50,
      models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
    }),
  });

  return keyResponse.key;  // e.g., "sk-litellm-user-abc123"
}
```

Each user gets their own virtual API key that:
- Routes through the single Anthropic API key
- Tracks spending independently
- Has its own budget limit

### 2. Real-Time Usage Tracking

LiteLLM tracks every API call in its PostgreSQL database. Magent queries the LiteLLM REST API (not the database directly) to get usage information:

```typescript
// From src/lib/litellm.ts
export async function getCreditStatus(userId: string) {
  // Query LiteLLM API for user spend data
  const response = await fetch(`${baseUrl}/user/info?user_id=magent_${userId}`, {
    headers: { 'Authorization': `Bearer ${masterKey}` },
  });

  const data = await response.json();
  const remainingUsd = data.user_info.max_budget - data.user_info.spend;
  const remainingCredits = usdToCredits(remainingUsd);  // 200 credits = $1

  return { credits_remaining: remainingCredits, credits_total, credits_used };
}
```

LiteLLM's internal database schema looks like:

```sql
-- LiteLLM automatically tracks spend in its database
-- (You query via REST API, not directly)
-- user_id          | spend  | max_budget
-- magent_user123   | 2.34   | 6.50
```

### 3. Automatic Budget Enforcement (The Key Feature!)

This is the magic that makes Claude Code usage trackable and controllable.

**When a user hits their budget, LiteLLM automatically blocks the request:**

```typescript
// LiteLLM returns this error when budget exceeded
{
  "error": {
    "message": "Budget has been exceeded! Current spend: 6.50; Max Budget: 6.50",
    "type": "budget_exceeded",
    "code": 400
  }
}
```

**Magent handles this gracefully:**

```typescript
// From src/lib/litellm.ts
export class BudgetExceededError extends Error {
  public readonly available: number;
  public readonly spent: number;
  public readonly code = "BUDGET_EXCEEDED";

  constructor(available: number, spent: number) {
    super(
      `Budget exceeded. Available: ${available} credits, Spent: ${spent} credits.`
    );
    this.name = "BudgetExceededError";
    this.available = available;
    this.spent = spent;
  }
}

// Detects budget errors from LiteLLM error messages or strings
export function isBudgetExceededError(error: unknown): boolean {
  if (typeof error === "string") {
    const lower = error.toLowerCase();
    return lower.includes("budget") &&
           (lower.includes("exceeded") || lower.includes("limit"));
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("budget") &&
           (message.includes("exceeded") || message.includes("limit"));
  }
  return false;
}
```

**Credit Sync to Database:**

After each task completes (or is aborted), Magent syncs the latest credit balance from LiteLLM back to the database for display in the UI:

```typescript
// From src/app/api/chat/route.ts
async function syncCreditsFromLiteLLM(
  serviceClient: SupabaseClient,
  userId: string
): Promise<void> {
  const status = await getCreditStatus(userId);
  await serviceClient
    .from("users")
    .update({ credits: status.credits_remaining })
    .eq("id", userId);
}
```

This sync happens at multiple points: after task completion, after abort, and periodically during long tasks.

### 4. Stopping at Budget Limits

When Claude Code is running and makes an API call that would exceed the budget:

1. **LiteLLM intercepts** the request before it reaches Anthropic
2. **Checks the user's remaining budget** against estimated cost
3. **Blocks the request** if budget would be exceeded
4. **Returns an HTTP 400 error** that stops further API calls

**Important clarification:** LiteLLM blocks new API requests, it does not interrupt an in-progress streaming response. This means:
- A single API call that is already streaming will complete
- But the next API call (e.g., next tool use, next turn) will be blocked
- Claude Code detects the error and stops its task loop

This provides effective cost control:
- Users can't accidentally overspend beyond one API call
- Long agent tasks stop at the next turn when budget is exceeded
- No manual intervention needed
- Minimal risk of runaway costs

## Credit System Design

Magent uses a credit system on top of LiteLLM's dollar-based budgets:

```typescript
// Credit conversion (matches Manus pricing)
const CREDITS_PER_USD = 200;  // 200 credits = $1.00

export function usdToCredits(usd: number): number {
  return Math.round(usd * CREDITS_PER_USD);
}

export function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD;
}
```

**Why credits instead of dollars?**
- More intuitive for users ("50 credits" vs "$0.25")
- Abstracts away API pricing complexity
- Allows flexible pricing tiers
- Matches industry conventions (like Manus)

## User Lifecycle

### 1. Signup
```
User signs up → Supabase trigger → provision-litellm-user Edge Function
                                   ↓
                            Creates LiteLLM user ($6.50 budget)
                                   ↓
                            Generates virtual API key
                                   ↓
                            Stores key in users.litellm_key_id
```

### 2. Using Credits
```
User starts task → Magent fetches user's LiteLLM key
                   ↓
            Claude Code runs with that key
                   ↓
            LiteLLM tracks each API call
                   ↓
            Updates spend in real-time
                   ↓
            Blocks if budget exceeded
```

### 3. Top Up
```
User purchases credits → Stripe webhook → /api/credits/topup
                                          ↓
                                   Updates LiteLLM budget
                                          ↓
                                   Records transaction
                                          ↓
                                   User can continue
```

## Key Configuration

### LiteLLM Proxy Config (`litellm/config.yaml`)

```yaml
model_list:
  - model_name: claude-sonnet-4-20250514
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514  # Note: anthropic/ prefix required
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: claude-opus-4-5-20251101
    litellm_params:
      model: anthropic/claude-opus-4-5-20251101
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: "claude-*"  # Wildcard for any claude model
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL  # PostgreSQL for spend tracking
```

### Environment Variables

```bash
# Magent app (server-side)
LITELLM_BASE_URL=https://magent-litellm.fly.dev
LITELLM_MASTER_KEY=sk-master-xxx  # For admin operations (user/key management)

# E2B Sandbox environment (set dynamically per-user)
ANTHROPIC_API_KEY=<user's litellm key>  # Per-user LiteLLM key
ANTHROPIC_BASE_URL=https://magent-litellm.fly.dev  # Routes calls through LiteLLM

# LiteLLM proxy
ANTHROPIC_API_KEY=sk-ant-xxx      # Actual Anthropic key (on proxy server)
DATABASE_URL=postgresql://...      # Supabase connection for spend tracking
```

### Local Development Note

When running locally, the LiteLLM proxy is typically on `localhost:4000`. However, E2B cloud sandboxes cannot reach localhost. In this case, Magent falls back to using the raw `ANTHROPIC_API_KEY` directly without LiteLLM proxy routing:

```typescript
// From src/lib/e2b.ts
if (!litellmBaseUrl || litellmBaseUrl.includes("localhost")) {
  // Don't set ANTHROPIC_BASE_URL - will use default Anthropic API
} else {
  envs.ANTHROPIC_BASE_URL = litellmBaseUrl;  // Route through LiteLLM
}
```

## Benefits Summary

| Without LiteLLM | With LiteLLM |
|-----------------|--------------|
| One API key for everyone | Per-user virtual keys |
| No individual tracking | Real-time spend tracking |
| Manual cost calculation | Automatic cost tracking |
| No spending limits | Hard budget enforcement |
| Runaway costs possible | Automatic cutoff at limit |
| Complex usage queries | Simple REST API |
| Build your own tracking | Battle-tested solution |

## Conclusion

LiteLLM is essential for Magent because it transforms a single Anthropic API key into a multi-tenant system with:

1. **Per-user tracking** - Know exactly what each user consumes
2. **Budget enforcement** - Users can't exceed their credits
3. **Automatic stopping** - No runaway costs from long Claude Code tasks
4. **Simple integration** - REST API for all operations
5. **Production-ready** - PostgreSQL-backed, battle-tested

Without LiteLLM, building this functionality would require:
- Custom proxy implementation
- Token counting and cost calculation
- Database schema for tracking
- Real-time budget checking logic
- Error handling for limit exceeded

LiteLLM provides all of this out of the box, letting Magent focus on the product instead of infrastructure.

## Related Documentation

- [LiteLLM Fly.io Deployment Guide](./litellm-fly-deployment.md)
- [LiteLLM Official Documentation](https://docs.litellm.ai/)
