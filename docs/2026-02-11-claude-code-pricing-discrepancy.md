# Claude Code `total_cost_usd` Reports 3x Actual Cost

**Date**: 2026-02-11

## Finding

Claude Code's `total_cost_usd` (from the `result` NDJSON message) reports costs at **Opus 4.0 rates ($15/$75)**, exactly 3x the actual Opus 4.6 rates ($5/$25). The Anthropic dashboard confirms the real charge matches Opus 4.6 pricing.

| Rate | Opus 4.6 (actual) | Claude Code `total_cost_usd` |
|------|-------------------|------------------------------|
| Input | $5/MTok | $15/MTok |
| Output | $25/MTok | $75/MTok |
| Cache write (5m) | $6.25/MTok | $18.75/MTok |
| Cache read | $0.50/MTok | $1.50/MTok |

## Verification

Test run ("Draw a simple blue circle" with Opus 4.6):

```
Claude Code total_cost_usd: $1.43
Anthropic dashboard actual:  $0.48  ($4.25 → $3.77)
Ratio: 1.43 / 0.48 ≈ 3x
```

## Fix

- `CLAUDE_PRICING` in `portkey.ts` uses correct Opus 4.6 rates ($5/$25)
- `CLAUDE_CODE_COST_DIVISOR = 3` exported from `portkey.ts`
- `actualCostUsd = obj.total_cost_usd / CLAUDE_CODE_COST_DIVISOR` in `route.ts`

## Additional Note: Thinking Tokens

Claude Code's `assistant` NDJSON messages report `output_tokens` as visible content only (excluding extended thinking). The `result` message's `output_tokens` includes full thinking tokens. For a typical run:
- Sum of assistant `output_tokens`: ~125 tokens (visible content)
- Result `output_tokens`: ~942 tokens (includes thinking)

Mid-run estimates from `assistant` messages will undercount output by the thinking gap.

## Source

- Published Opus 4.6 pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Anthropic dashboard confirmed actual billing at $5/$25 rates
