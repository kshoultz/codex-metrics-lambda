"""
Aggregator — shapes raw OpenAI Admin API responses into CodexMetricsResponse.

Same math as claude-metrics-lambda (billing period, burn rate, projection,
exhaustion), adapted for OpenAI's response shapes:
- Simpler token fields (input, output, cached — no ephemeral cache creation)
- Costs in USD directly (no cents conversion)
- Timestamps as Unix seconds (not RFC 3339)
- Codex CLI detected by filtering known model names
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from .types import is_codex_model

DEFAULT_TOKEN_LIMIT = 50_000_000  # 50M tokens


# ============================================================================
# Helpers — rounding must match JavaScript Math.round (round-half-up)
# ============================================================================

def round1(n: float) -> float:
    """Round to 1 decimal place (JS Math.round semantics)."""
    return math.floor(n * 10 + 0.5) / 10


def round2(n: float) -> float:
    """Round to 2 decimal places (JS Math.round semantics)."""
    return math.floor(n * 100 + 0.5) / 100


def _format_iso_utc(dt: datetime) -> str:
    """Format datetime to JS-compatible ISO string: YYYY-MM-DDTHH:MM:SS.mmmZ."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _unix_to_date(unix: int) -> str:
    """Convert Unix seconds to YYYY-MM-DD string."""
    return datetime.fromtimestamp(unix, tz=timezone.utc).strftime("%Y-%m-%d")


# ============================================================================
# Billing Period
# ============================================================================

def get_billing_period(now: Optional[datetime] = None) -> dict[str, Any]:
    if now is None:
        now = datetime.now(timezone.utc)

    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    if now.month == 12:
        end_of_month = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end_of_month = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)

    days_total = round((end_of_month - start).total_seconds() / 86400)
    days_elapsed = max((now - start).total_seconds() / 86400, 0.0)
    days_remaining = max(days_total - days_elapsed, 0.0)

    return {
        "start": _format_iso_utc(start),
        "end": _format_iso_utc(end_of_month),
        "days_total": days_total,
        "days_elapsed": round2(days_elapsed),
        "days_remaining": round2(days_remaining),
        "resets_at": _format_iso_utc(end_of_month),
    }


def to_unix_seconds(dt: datetime) -> int:
    """Convert a datetime to Unix seconds for the OpenAI API."""
    return int(dt.timestamp())


# ============================================================================
# Token Summation
# ============================================================================

def sum_tokens(buckets: list[dict]) -> int:
    """Sum all tokens across usage buckets."""
    total = 0
    for bucket in buckets:
        for result in bucket.get("results") or []:
            total += result.get("input_tokens") or 0
            total += result.get("output_tokens") or 0
            total += result.get("input_cached_tokens") or 0
    return total


def sum_tokens_by_type(buckets: list[dict]) -> dict[str, int]:
    """Sum tokens broken down by type."""
    inp = 0
    output = 0
    cached = 0
    requests = 0

    for bucket in buckets:
        for result in bucket.get("results") or []:
            inp += result.get("input_tokens") or 0
            output += result.get("output_tokens") or 0
            cached += result.get("input_cached_tokens") or 0
            requests += result.get("num_model_requests") or 0

    return {"input": inp, "output": output, "cached": cached, "requests": requests}


def filter_codex_results(buckets: list[dict]) -> list[dict]:
    """Filter bucket results to only Codex model results."""
    filtered = []
    for bucket in buckets:
        codex_results = [
            r for r in bucket.get("results") or []
            if r.get("model") is not None and is_codex_model(r["model"])
        ]
        if codex_results:
            filtered.append({**bucket, "results": codex_results})
    return filtered


# ============================================================================
# Cost Summation
# ============================================================================

def sum_cost_usd(buckets: list[dict]) -> float:
    """Sum cost across buckets. OpenAI returns amount.value in USD directly."""
    total = 0.0
    for bucket in buckets:
        for result in bucket.get("results") or []:
            amount = result.get("amount") or {}
            total += amount.get("value") or 0
    return round2(total)


# ============================================================================
# Cost Projection (same math as claude-metrics-lambda)
# ============================================================================

def project_monthly_cost(
    current_cost_usd: float,
    days_elapsed: float,
    days_total: int,
) -> float:
    """Project monthly cost based on linear extrapolation of spend-to-date."""
    if days_elapsed <= 0:
        return current_cost_usd
    daily_rate = current_cost_usd / days_elapsed
    return round2(daily_rate * days_total)


# ============================================================================
# By-Model / By-Line-Item Grouping
# ============================================================================

def group_usage_by_model(buckets: list[dict]) -> list[dict]:
    """Group usage buckets by model, summing tokens per model."""
    model_map: dict[str, int] = defaultdict(int)
    for bucket in buckets:
        for result in bucket.get("results") or []:
            model = result.get("model") or "unknown"
            tokens = (
                (result.get("input_tokens") or 0)
                + (result.get("output_tokens") or 0)
                + (result.get("input_cached_tokens") or 0)
            )
            model_map[model] += tokens
    return sorted(
        [{"model": m, "tokens": t} for m, t in model_map.items()],
        key=lambda x: x["tokens"],
        reverse=True,
    )


def group_cost_by_line_item(buckets: list[dict]) -> list[dict]:
    """Group cost buckets by line item."""
    item_map: dict[str, float] = defaultdict(float)
    for bucket in buckets:
        for result in bucket.get("results") or []:
            item = result.get("line_item") or "unknown"
            amount = result.get("amount") or {}
            item_map[item] += amount.get("value") or 0
    return sorted(
        [{"line_item": li, "cost_usd": round2(c)} for li, c in item_map.items()],
        key=lambda x: x["cost_usd"],
        reverse=True,
    )


# ============================================================================
# Daily Breakdown
# ============================================================================

def daily_token_breakdown(buckets: list[dict]) -> list[dict]:
    """Build daily token totals from usage buckets."""
    result = []
    for bucket in buckets:
        tokens = 0
        for r in bucket.get("results") or []:
            tokens += (r.get("input_tokens") or 0)
            tokens += (r.get("output_tokens") or 0)
            tokens += (r.get("input_cached_tokens") or 0)
        result.append({
            "date": _unix_to_date(bucket["start_time"]),
            "tokens": tokens,
        })
    return result


def daily_cost_breakdown(buckets: list[dict]) -> list[dict]:
    """Build daily cost totals from cost buckets."""
    result = []
    for bucket in buckets:
        usd = 0.0
        for r in bucket.get("results") or []:
            amount = r.get("amount") or {}
            usd += amount.get("value") or 0
        result.append({
            "date": _unix_to_date(bucket["start_time"]),
            "cost_usd": round2(usd),
        })
    return result


# ============================================================================
# Per-User Codex Aggregation
# ============================================================================

def aggregate_codex_by_user(
    buckets: list[dict],
    user_map: dict[str, dict],
) -> dict:
    """Group Codex usage by user_id with name lookup."""
    user_data: dict[str, dict] = {}

    for bucket in buckets:
        for result in bucket.get("results") or []:
            model = result.get("model")
            if model is None or not is_codex_model(model):
                continue
            user_id = result.get("user_id") or "unknown"
            tokens = (
                (result.get("input_tokens") or 0)
                + (result.get("output_tokens") or 0)
                + (result.get("input_cached_tokens") or 0)
            )

            if user_id not in user_data:
                user_data[user_id] = {"tokens": 0, "models_used": set()}
            user_data[user_id]["tokens"] += tokens
            user_data[user_id]["models_used"].add(model)

    per_user = sorted(
        [
            {
                "user_id": uid,
                "name": user_map.get(uid, {}).get("name", uid),
                "tokens": data["tokens"],
                "models_used": data["models_used"],
            }
            for uid, data in user_data.items()
        ],
        key=lambda x: x["tokens"],
        reverse=True,
    )

    return {"per_user": per_user}


# ============================================================================
# Capacity Metrics
# ============================================================================

def _build_capacity(
    tokens_used: int,
    token_limit: int,
    days_elapsed: float,
    days_remaining: float,
) -> dict:
    tokens_remaining = max(token_limit - tokens_used, 0)
    usage_pct = round1((tokens_used / token_limit) * 100) if token_limit > 0 else 0.0
    daily_burn_rate = round(tokens_used / days_elapsed) if days_elapsed > 0 else 0
    projected_at_end = tokens_used + daily_burn_rate * days_remaining

    days_until_exhaustion: Optional[float] = None
    if daily_burn_rate > 0 and projected_at_end > token_limit:
        days_until_exhaustion = round1(tokens_remaining / daily_burn_rate)

    return {
        "tokens_used": tokens_used,
        "token_limit": token_limit,
        "tokens_remaining": tokens_remaining,
        "usage_pct": usage_pct,
        "daily_burn_rate": daily_burn_rate,
        "projected_tokens_at_period_end": round(projected_at_end),
        "days_until_exhaustion": days_until_exhaustion,
    }


# ============================================================================
# Main Aggregator
# ============================================================================

def aggregate(input_data: dict) -> dict:
    now: datetime = input_data.get("now") or datetime.now(timezone.utc)
    billing_period = get_billing_period(now)
    openai_api_token_limit = input_data.get("openai_api_token_limit") or DEFAULT_TOKEN_LIMIT
    codex_cli_token_limit = input_data.get("codex_cli_token_limit") or DEFAULT_TOKEN_LIMIT

    # Build user lookup
    user_map: dict[str, dict] = {}
    for user in (input_data["users"].get("data") or []):
        user_map[user["id"]] = user

    # -- Usage --
    usage_data = input_data["usage_report"].get("data") or []
    api_tokens = sum_tokens_by_type(usage_data)
    api_total_tokens = sum_tokens(usage_data)

    # -- Codex CLI --
    codex_buckets = filter_codex_results(usage_data)
    codex_tokens = sum_tokens_by_type(codex_buckets)
    codex_total_tokens = sum_tokens(codex_buckets)
    has_codex = codex_total_tokens > 0

    codex_by_user = aggregate_codex_by_user(
        input_data["usage_by_user"].get("data") or [],
        user_map,
    )

    # -- Cost --
    cost_data = input_data["cost_report"].get("data") or []
    current_spend_usd = sum_cost_usd(cost_data)
    projected_spend_usd = project_monthly_cost(
        current_spend_usd,
        billing_period["days_elapsed"],
        billing_period["days_total"],
    )
    daily_burn_rate_usd = (
        round2(current_spend_usd / billing_period["days_elapsed"])
        if billing_period["days_elapsed"] > 0
        else 0.0
    )

    # -- Capacity --
    api_capacity = _build_capacity(
        api_total_tokens,
        openai_api_token_limit,
        billing_period["days_elapsed"],
        billing_period["days_remaining"],
    )

    codex_capacity = None
    if has_codex:
        codex_capacity = _build_capacity(
            codex_total_tokens,
            codex_cli_token_limit,
            billing_period["days_elapsed"],
            billing_period["days_remaining"],
        )
        codex_capacity["per_user"] = [
            {
                "user_id": u["user_id"],
                "name": u["name"],
                "tokens_used": u["tokens"],
            }
            for u in codex_by_user["per_user"]
        ]

    # -- Usage breakdown --
    usage_by_model_data = input_data["usage_by_model"].get("data") or []
    api_usage = {
        "input_tokens": api_tokens["input"],
        "output_tokens": api_tokens["output"],
        "cached_tokens": api_tokens["cached"],
        "num_requests": api_tokens["requests"],
        "by_model": group_usage_by_model(usage_by_model_data),
        "daily": daily_token_breakdown(usage_data),
    }

    codex_usage = None
    if has_codex:
        codex_usage = {
            "input_tokens": codex_tokens["input"],
            "output_tokens": codex_tokens["output"],
            "cached_tokens": codex_tokens["cached"],
            "num_requests": codex_tokens["requests"],
            "by_model": group_usage_by_model(codex_buckets),
            "daily": daily_token_breakdown(codex_buckets),
            "per_user": [
                {
                    "user_id": u["user_id"],
                    "name": u["name"],
                    "tokens": u["tokens"],
                    "models_used": list(u["models_used"]),
                }
                for u in codex_by_user["per_user"]
            ],
        }

    # -- Account --
    all_keys: list[dict] = []
    api_keys_by_project: dict[str, dict] = input_data.get("api_keys_by_project") or {}
    for project_id, keys_resp in api_keys_by_project.items():
        for key in keys_resp.get("data") or []:
            all_keys.append({"id": key["id"], "name": key["name"], "project_id": project_id})

    account = {
        "organization_id": "",
        "projects": [
            {
                "id": p["id"],
                "name": p["name"],
                "archived": p.get("archived_at") is not None,
            }
            for p in (input_data["projects"].get("data") or [])
        ],
        "members": [
            {
                "id": u["id"],
                "name": u["name"],
                "email": u["email"],
                "role": u["role"],
            }
            for u in (input_data["users"].get("data") or [])
        ],
        "api_keys": {
            "total": len(all_keys),
            "keys": all_keys,
        },
    }

    # -- Cost metrics --
    cost_by_line_item_data = input_data["cost_by_line_item"].get("data") or []
    cost = {
        "current_spend_usd": current_spend_usd,
        "projected_spend_usd": projected_spend_usd,
        "daily_burn_rate_usd": daily_burn_rate_usd,
        "by_line_item": group_cost_by_line_item(cost_by_line_item_data),
        "daily": daily_cost_breakdown(cost_data),
    }

    return {
        "capacity": {
            "openai_api": api_capacity,
            "codex_cli": codex_capacity,
        },
        "cost": cost,
        "usage": {
            "openai_api": api_usage,
            "codex_cli": codex_usage,
        },
        "account": account,
        "billing_period": billing_period,
        "meta": {
            "fetched_at": _format_iso_utc(now),
            "api_version": "v1",
        },
    }
