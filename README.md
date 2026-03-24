# codex-metrics-lambda

TypeScript Lambda that fetches your OpenAI account metrics via the Admin API and returns a single shaped response with everything you need: token capacity, cost tracking, usage breakdown, Codex CLI per-user stats, and account info.

Twin project to [claude-metrics-lambda](../claude-metrics-lambda/) — same pattern, different provider.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USER/codex-metrics-lambda.git
cd codex-metrics-lambda
npm install
```

### 2. Add your API key

```bash
cp .env.example .env
# Edit .env and set OPENAI_ADMIN_API_KEY
```

Get an Admin API key from: https://platform.openai.com/settings/organization/admin-keys

### 3. Run locally (no Docker needed)

```bash
npm run invoke
```

### 4. Run via Docker + LocalStack

```bash
docker compose up -d
npm run deploy:local

# Invoke the Lambda
awslocal lambda invoke --function-name codex-metrics --region us-east-1 /dev/stdout
```

## What You Get

A single JSON response organized around two questions:

**Will I run out of tokens?**
- Tokens used / remaining / limit
- Daily burn rate
- Projected tokens at period end
- Days until exhaustion
- Codex CLI usage separated from general API usage

**How much have I spent?**
- Current spend in USD
- Projected monthly spend
- Daily burn rate in USD
- Cost breakdown by line item (model)
- Daily cost for sparkline/trend

Plus: full usage breakdown (input/output/cached), Codex CLI per-user stats, account info (projects, members, API keys), and billing period details.

## Codex CLI Detection

Codex CLI usage is detected by filtering completions for known Codex model names (`codex-mini-latest`, `gpt-5-codex`, `gpt-5.1-codex-max`, etc.). This list is configurable in `src/types.ts`.

## Response Shape

```typescript
{
  capacity: {
    openai_api: { tokens_used, token_limit, tokens_remaining, usage_pct, daily_burn_rate, projected_tokens_at_period_end, days_until_exhaustion },
    codex_cli: { ...same, per_user: [{ user_id, name, tokens_used }] } | null
  },
  cost: {
    current_spend_usd, projected_spend_usd, daily_burn_rate_usd,
    by_line_item: [{ line_item, cost_usd }],
    daily: [{ date, cost_usd }]
  },
  usage: {
    openai_api: { input_tokens, output_tokens, cached_tokens, num_requests, by_model, daily },
    codex_cli: { ...same, per_user: [{ user_id, name, tokens, models_used }] } | null
  },
  account: { organization_id, projects, members, api_keys },
  billing_period: { start, end, days_total, days_elapsed, days_remaining, resets_at },
  meta: { fetched_at, api_version }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_ADMIN_API_KEY` | Yes | — | Admin API key (`sk-admin-...`) |
| `OPENAI_API_TOKEN_LIMIT` | No | `50000000` | Token limit for capacity calculations |
| `CODEX_CLI_TOKEN_LIMIT` | No | `50000000` | Codex CLI token limit |

## Tests

```bash
npm test
```

## Project Structure

```
src/
├── index.ts              # Lambda handler
├── openai-admin.ts       # Typed Admin API client (native fetch, zero deps)
├── aggregator.ts         # Data shaping + math (token sums, cost projection, burn rate)
└── types.ts              # All TypeScript interfaces + Codex model detection
```

## License

MIT
