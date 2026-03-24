# Codex Metrics Lambda (Python)

Python implementation of the Codex Metrics Lambda — functionally identical to the TypeScript version. Fetches OpenAI account usage metrics via the Admin API and returns a comprehensive JSON response with Codex CLI detection.

## Zero Dependencies

Uses only Python standard library at runtime:
- `urllib.request` for HTTP calls
- `concurrent.futures` for parallel requests
- `json`, `datetime`, `math` for data processing

## Quick Start

```bash
# From the python/ directory
cd python

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dev dependencies
pip install -e ".[dev]"

# Run tests
python -m pytest -v

# Invoke locally (requires OPENAI_ADMIN_API_KEY in ../.env or .env)
python scripts/invoke_local.py

# Type check
mypy src/
```

## Deploy to LocalStack

```bash
# From project root
docker compose up -d
./python/scripts/deploy-local.sh

# Invoke
aws --endpoint-url http://localhost:4566 lambda invoke --function-name codex-metrics-python --region us-east-1 /dev/stdout
```

## Codex CLI Detection

Codex CLI usage is detected by filtering completions for known model names (`codex-mini-latest`, `gpt-5-codex`, `gpt-5.1-codex-max`, etc.). The pattern list is in `src/types.py`.

## Project Structure

```
python/
├── src/
│   ├── handler.py            # Lambda entry point
│   ├── types.py              # TypedDict definitions + Codex model detection
│   ├── openai_admin.py       # Admin API client
│   └── aggregator.py         # Data aggregation logic
├── tests/
│   └── test_aggregator.py    # Unit tests (pytest)
├── scripts/
│   ├── invoke_local.py       # Local invocation
│   └── deploy-local.sh       # LocalStack deployment
├── Dockerfile                # Python 3.11 Lambda container
└── pyproject.toml            # Project config
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_ADMIN_API_KEY` | Yes | — | `sk-admin-...` key from platform.openai.com |
| `OPENAI_API_TOKEN_LIMIT` | No | `50000000` | Token limit for API capacity calculations |
| `CODEX_CLI_TOKEN_LIMIT` | No | `50000000` | Token limit for Codex CLI capacity calculations |
