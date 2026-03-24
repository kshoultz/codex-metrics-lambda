# codex-metrics-lambda

Lambda that fetches your OpenAI account metrics via the Admin API and returns a single shaped response: token capacity, cost tracking, usage breakdown, Codex CLI per-user stats, and account info.

Twin project to [claude-metrics-lambda](../claude-metrics-lambda/) — same pattern, different provider.

Available in **TypeScript** and **Python** — both produce identical JSON output.

## Quick Start

Only Docker required. No local Node.js, Python, or AWS CLI needed.

```bash
cp .env.example .env          # add your OPENAI_ADMIN_API_KEY
docker compose up              # deploys and invokes both lambdas
```

Get an Admin API key from: https://platform.openai.com/settings/organization/admin-keys

## Dashboard

View your metrics in a formatted terminal display — no Docker or Lambda needed. Calls the OpenAI API directly from Node.js.

```bash
npm install                    # first time only
npm run dashboard
```

Requires Node.js >= 18 and `OPENAI_ADMIN_API_KEY` in your `.env`.

## Run Tests

```bash
docker compose --profile test up test-ts test-python
```

## What You Get

A single JSON response answering two questions:

**Will I run out of tokens?** — tokens used/remaining/limit, daily burn rate, projected end-of-month usage, days until exhaustion, Codex CLI usage separated from general API

**How much have I spent?** — current spend, projected monthly, daily burn rate, cost by line item, daily trend

Plus: full usage breakdown (input/output/cached), Codex CLI per-user stats, account info (projects, members, API keys), and billing period details.

## Codex CLI Detection

Codex CLI usage is detected by filtering completions for known Codex model names (`codex-mini-latest`, `gpt-5-codex`, `gpt-5.1-codex-max`, etc.). This list is configurable in `src/types.ts` (or `python/src/types.py`).

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

## Project Structure

Two functionally identical Lambda implementations that produce the same JSON output.

```
src/                          # TypeScript Lambda
├── index.ts
├── openai-admin.ts
├── aggregator.ts
└── types.ts

python/src/                   # Python Lambda
├── handler.py
├── openai_admin.py
├── aggregator.py
└── types.py
```

## Alternative: Run Without Docker

Requires Node.js >= 18, Python >= 3.11, and AWS CLI on your host.

```bash
# TypeScript — run directly
npm install
npm run invoke

# TypeScript — deploy to LocalStack
npm run deploy:local

# Python — run directly
cd python && python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" && python scripts/invoke_local.py

# Python — deploy to LocalStack
./python/scripts/deploy-local.sh

# Unit tests
npm test
cd python && source .venv/bin/activate && python -m pytest -v
```

## License

MIT
