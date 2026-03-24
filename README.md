# codex-metrics-lambda

Lambda that fetches your OpenAI account metrics via the Admin API and returns a single shaped response: token capacity, cost tracking, usage breakdown, Codex CLI per-user stats, and account info.

Twin project to [claude-metrics-lambda](../claude-metrics-lambda/) — same pattern, different provider.

Available in **TypeScript** and **Python** — both produce identical JSON output.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18 (for TypeScript Lambda)
- [Python](https://www.python.org/) >= 3.11 (for Python Lambda)
- [Docker](https://www.docker.com/)
- [AWS CLI](https://aws.amazon.com/cli/)

## Quick Start (TypeScript)

```bash
npm install
cp .env.example .env
# Edit .env and set OPENAI_ADMIN_API_KEY
# Get one from: https://platform.openai.com/settings/organization/admin-keys

docker compose up -d
npm run deploy:local
aws --endpoint-url http://localhost:4566 lambda invoke --function-name codex-metrics --region us-east-1 /dev/stdout
```

Or run directly without Docker: `npm run invoke`

## Quick Start (Python)

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# From project root
docker compose up -d
./python/scripts/deploy-local.sh
aws --endpoint-url http://localhost:4566 lambda invoke --function-name codex-metrics-python --region us-east-1 /dev/stdout
```

Or run directly without Docker: `python scripts/invoke_local.py`

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

## Tests

```bash
# TypeScript
npm test

# Python
cd python && source .venv/bin/activate && python -m pytest -v
```

## Project Structure

```
src/                          # TypeScript Lambda
├── index.ts              # Lambda handler
├── openai-admin.ts       # Admin API client (native fetch, zero deps)
├── aggregator.ts         # Data shaping + math
└── types.ts              # All TypeScript interfaces + Codex model detection

python/                       # Python Lambda
├── src/
│   ├── handler.py        # Lambda handler
│   ├── openai_admin.py   # Admin API client (urllib.request, zero deps)
│   ├── aggregator.py     # Data shaping + math
│   └── types.py          # TypedDict definitions + Codex model detection
├── tests/
│   └── test_aggregator.py
├── scripts/
│   ├── invoke_local.py
│   └── deploy-local.sh
├── Dockerfile
└── pyproject.toml
```

## License

MIT
