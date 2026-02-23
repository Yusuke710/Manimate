# Stripe Setup Guide

## Overview

Magent uses Stripe for:
- **One-time credit purchases** (Checkout Session in `payment` mode)
- **Monthly subscriptions** (Checkout Session in `subscription` mode)

## Stripe Dashboard Configuration

### 1. Webhook Endpoint

URL: `https://magent-pi.vercel.app/api/credits/topup`

**Required events** (add all of these):
- `checkout.session.completed` — handles first-time payments (both one-time and subscription)
- `invoice.payment_succeeded` — handles recurring monthly subscription renewals

To add events: **Developers > Webhooks > your endpoint > Update > Select events**

### 2. Subscription Setup

No manual product/price creation needed — we use `price_data` in the Checkout Session API to create prices dynamically. Stripe auto-creates the product and price on first checkout.

Plans:
| Plan | Price | Monthly Credits | Concurrent Tasks |
|------|-------|----------------|-----------------|
| Free | $0 | 300/day + 1,000 starter | 1 |
| Plus | $39/mo | 7,800 + 300/day | 3 |
| Pro | $199/mo | 39,800 + 300/day | 10 |

### 3. Invoice Behavior

Stripe automatically handles invoices for subscriptions:
- **First invoice**: Created at checkout, paid immediately → triggers `checkout.session.completed`
- **Recurring invoices**: Created monthly → triggers `invoice.payment_succeeded`
- Invoices are visible in Stripe Dashboard > **Billing > Invoices**
- Customers receive email receipts automatically (configure in **Settings > Emails**)

To customize invoice appearance:
- Go to **Settings > Branding** — set logo, colors, business info
- Go to **Settings > Customer emails** — enable/customize receipt emails

### 4. Environment Variables

**Local development** (`.env`):
```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_... (from `stripe listen --api-key`)
```

**Production** (Vercel env vars):
```
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_... (from Stripe Dashboard webhook endpoint)
```

Note: `NEXT_PUBLIC_SITE_URL` is not needed — checkout/subscribe routes use `request.nextUrl.origin` which automatically resolves to the correct URL in both dev and production.

### 5. Local Testing

```bash
# Terminal 1: Dev server
npm run dev

# Terminal 2: Forward Stripe webhooks locally
# IMPORTANT: Use --api-key to ensure the correct Stripe account is used
stripe listen --api-key sk_test_YOUR_TEST_KEY --forward-to localhost:3000/api/credits/topup
```

Test cards:
- `4242 4242 4242 4242` — succeeds
- `4000 0000 0000 3220` — requires 3D Secure
- `4000 0000 0000 0002` — declines

### 5b. One-Time Credit Top-Up

Users can purchase any dollar amount between $5 and $500. Credits are calculated at $1 = 200 credits.

The `/pricing` page includes a custom amount input field with a "Buy credits" button.

### 6. Subscription Lifecycle

```
User clicks "Upgrade" on /pricing
  → POST /api/credits/subscribe { plan: "plus" }
  → Creates Stripe Checkout Session (mode: subscription)
  → Redirects to Stripe Checkout page
  → User pays
  → Stripe fires checkout.session.completed webhook
  → /api/credits/topup handles it:
    - Updates subscriptions table (plan = "plus", status = "active")
    - Zeros old monthly bucket, inserts new monthly bucket (7,800 credits)
    - Syncs users.credits cache

Monthly renewal:
  → Stripe auto-charges saved payment method
  → Fires invoice.payment_succeeded webhook
  → /api/credits/topup handles it:
    - Skips if billing_reason = "subscription_create" (already handled above)
    - Zeros old monthly bucket, inserts fresh monthly bucket
    - Syncs users.credits cache
```

### 7. API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/credits/checkout` | POST | Create one-time payment session |
| `/api/credits/subscribe` | POST | Create subscription session |
| `/api/credits/topup` | POST | Stripe webhook handler (all events) |
| `/api/credits` | GET | Get user's credit balance + breakdown |

### 8. TODO for Production

- [x] Add `invoice.payment_succeeded` to Stripe webhook events in dashboard
- [ ] Configure branding in Stripe Dashboard (logo, colors)
- [ ] Enable customer email receipts in Stripe Settings
- [ ] Add subscription cancellation flow (Stripe Customer Portal)
- [ ] Add plan downgrade handling
- [ ] Switch Vercel env vars from test keys to live keys when ready
