#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${AWS_ENDPOINT:-http://localstack:4566}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

awsl() { aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"; }

echo "============================================"
echo "  codex-metrics-lambda: deploy-all"
echo "============================================"

# ── 1. Validate API key ─────────────────────────────────────────────
if [ -z "${OPENAI_ADMIN_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_ADMIN_API_KEY not set in .env"
  exit 1
fi

# ── 2. Build env vars JSON ──────────────────────────────────────────
ENV_VARS="{\"Variables\":{\"OPENAI_ADMIN_API_KEY\":\"${OPENAI_ADMIN_API_KEY}\""
[ -n "${OPENAI_API_TOKEN_LIMIT:-}" ] && ENV_VARS="${ENV_VARS},\"OPENAI_API_TOKEN_LIMIT\":\"${OPENAI_API_TOKEN_LIMIT}\""
[ -n "${CODEX_CLI_TOKEN_LIMIT:-}" ] && ENV_VARS="${ENV_VARS},\"CODEX_CLI_TOKEN_LIMIT\":\"${CODEX_CLI_TOKEN_LIMIT}\""
ENV_VARS="${ENV_VARS}}}"

# ── 3. Create IAM role (idempotent) ─────────────────────────────────
echo ""
echo "==> Creating IAM role..."
awsl iam create-role \
  --role-name lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --no-cli-pager 2>/dev/null || true

# ── 4. Build & deploy TypeScript Lambda ─────────────────────────────
echo ""
echo "==> Building TypeScript Lambda..."
mkdir -p /tmp/ts-dist
esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --outfile=/tmp/ts-dist/index.mjs \
  --format=esm \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

(cd /tmp/ts-dist && zip -q function.zip index.mjs)

echo "==> Deploying codex-metrics (TypeScript)..."
if awsl lambda get-function --function-name codex-metrics --no-cli-pager &>/dev/null; then
  awsl lambda update-function-code \
    --function-name codex-metrics \
    --zip-file fileb:///tmp/ts-dist/function.zip \
    --no-cli-pager > /dev/null
  awsl lambda update-function-configuration \
    --function-name codex-metrics \
    --environment "$ENV_VARS" \
    --no-cli-pager > /dev/null
else
  awsl lambda create-function \
    --function-name codex-metrics \
    --runtime nodejs18.x \
    --handler index.handler \
    --zip-file fileb:///tmp/ts-dist/function.zip \
    --role arn:aws:iam::000000000000:role/lambda-role \
    --timeout 30 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --no-cli-pager > /dev/null
fi
echo "    ✓ codex-metrics deployed"
echo "    Waiting for function to become active..."
awsl lambda wait function-active-v2 --function-name codex-metrics

# ── 5. Build & deploy Python Lambda ────────────────────────────────
echo ""
echo "==> Packaging Python Lambda..."
mkdir -p /tmp/py-dist
cp -r python/src /tmp/py-dist/
(cd /tmp/py-dist && zip -qr function.zip src/)

echo "==> Deploying codex-metrics-python..."
if awsl lambda get-function --function-name codex-metrics-python --no-cli-pager &>/dev/null; then
  awsl lambda update-function-code \
    --function-name codex-metrics-python \
    --zip-file fileb:///tmp/py-dist/function.zip \
    --no-cli-pager > /dev/null
  awsl lambda update-function-configuration \
    --function-name codex-metrics-python \
    --environment "$ENV_VARS" \
    --no-cli-pager > /dev/null
else
  awsl lambda create-function \
    --function-name codex-metrics-python \
    --runtime python3.11 \
    --handler src.handler.handler \
    --zip-file fileb:///tmp/py-dist/function.zip \
    --role arn:aws:iam::000000000000:role/lambda-role \
    --timeout 30 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --no-cli-pager > /dev/null
fi
echo "    ✓ codex-metrics-python deployed"
echo "    Waiting for function to become active..."
awsl lambda wait function-active-v2 --function-name codex-metrics-python

# ── 6. Invoke both Lambdas ──────────────────────────────────────────
echo ""
echo "============================================"
echo "  Invoking TypeScript Lambda..."
echo "============================================"
awsl lambda invoke \
  --function-name codex-metrics \
  --no-cli-pager \
  /tmp/ts-response.json > /dev/null
cat /tmp/ts-response.json
echo ""

echo ""
echo "============================================"
echo "  Invoking Python Lambda..."
echo "============================================"
awsl lambda invoke \
  --function-name codex-metrics-python \
  --no-cli-pager \
  /tmp/py-response.json > /dev/null
cat /tmp/py-response.json
echo ""

echo ""
echo "============================================"
echo "  ✓ All lambdas deployed and invoked!"
echo "============================================"
