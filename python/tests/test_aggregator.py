"""
Unit tests for the aggregator module — mirrors the TypeScript Vitest tests
with identical mock data and expected values.
"""

from datetime import datetime, timezone

import pytest

from src.aggregator import (
    aggregate,
    aggregate_codex_by_user,
    daily_cost_breakdown,
    daily_token_breakdown,
    filter_codex_results,
    get_billing_period,
    group_cost_by_line_item,
    group_usage_by_model,
    project_monthly_cost,
    sum_cost_usd,
    sum_tokens,
    sum_tokens_by_type,
    to_unix_seconds,
)
from src.types import is_codex_model


# ============================================================================
# Codex Model Detection
# ============================================================================


class TestIsCodexModel:
    def test_matches_known_codex_model_names(self):
        assert is_codex_model("codex-mini-latest") is True
        assert is_codex_model("gpt-5-codex") is True
        assert is_codex_model("gpt-5.1-codex-max") is True
        assert is_codex_model("gpt-5.3-codex-spark") is True

    def test_rejects_non_codex_models(self):
        assert is_codex_model("gpt-4o") is False
        assert is_codex_model("gpt-5") is False
        assert is_codex_model("o3-mini") is False


# ============================================================================
# Token Summation
# ============================================================================


class TestSumTokens:
    def test_sums_input_output_cached_tokens_across_buckets(self):
        buckets = [
            {
                "object": "bucket",
                "start_time": 1710000000,
                "end_time": 1710086400,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 1000,
                        "output_tokens": 500,
                        "input_cached_tokens": 200,
                        "input_audio_tokens": 0,
                        "output_audio_tokens": 0,
                        "num_model_requests": 10,
                        "project_id": None,
                        "user_id": None,
                        "api_key_id": None,
                        "model": None,
                        "batch": None,
                    },
                ],
            },
            {
                "object": "bucket",
                "start_time": 1710086400,
                "end_time": 1710172800,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 2000,
                        "output_tokens": 800,
                        "input_cached_tokens": 100,
                        "input_audio_tokens": 0,
                        "output_audio_tokens": 0,
                        "num_model_requests": 5,
                        "project_id": None,
                        "user_id": None,
                        "api_key_id": None,
                        "model": None,
                        "batch": None,
                    },
                ],
            },
        ]

        assert sum_tokens(buckets) == 1000 + 500 + 200 + 2000 + 800 + 100

    def test_returns_zero_for_empty_buckets(self):
        assert sum_tokens([]) == 0


class TestSumTokensByType:
    def test_breaks_down_tokens_by_type(self):
        buckets = [
            {
                "object": "bucket",
                "start_time": 1710000000,
                "end_time": 1710086400,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 1000,
                        "output_tokens": 500,
                        "input_cached_tokens": 200,
                        "input_audio_tokens": 0,
                        "output_audio_tokens": 0,
                        "num_model_requests": 10,
                        "project_id": None,
                        "user_id": None,
                        "api_key_id": None,
                        "model": None,
                        "batch": None,
                    },
                ],
            },
        ]

        result = sum_tokens_by_type(buckets)
        assert result["input"] == 1000
        assert result["output"] == 500
        assert result["cached"] == 200
        assert result["requests"] == 10


# ============================================================================
# Codex Filtering
# ============================================================================


class TestFilterCodexResults:
    def test_keeps_only_codex_model_results(self):
        buckets = [
            {
                "object": "bucket",
                "start_time": 1710000000,
                "end_time": 1710086400,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 1000, "output_tokens": 500, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 5,
                        "project_id": None, "user_id": None, "api_key_id": None,
                        "model": "gpt-5-codex", "batch": None,
                    },
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 5000, "output_tokens": 2000, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 20,
                        "project_id": None, "user_id": None, "api_key_id": None,
                        "model": "gpt-4o", "batch": None,
                    },
                ],
            },
        ]

        filtered = filter_codex_results(buckets)
        assert len(filtered) == 1
        assert len(filtered[0]["results"]) == 1
        assert filtered[0]["results"][0]["model"] == "gpt-5-codex"


# ============================================================================
# Cost Summation
# ============================================================================


class TestSumCostUsd:
    def test_sums_usd_amounts_directly(self):
        buckets = [
            {
                "object": "bucket",
                "start_time": 1710000000,
                "end_time": 1710086400,
                "results": [
                    {"object": "organization.costs.result", "amount": {"value": 5.50, "currency": "usd"}, "line_item": None, "project_id": None, "organization_id": None},
                    {"object": "organization.costs.result", "amount": {"value": 3.25, "currency": "usd"}, "line_item": None, "project_id": None, "organization_id": None},
                ],
            },
        ]

        assert sum_cost_usd(buckets) == 8.75

    def test_returns_zero_for_empty_buckets(self):
        assert sum_cost_usd([]) == 0


# ============================================================================
# Cost Projection
# ============================================================================


class TestProjectMonthlyCost:
    def test_projects_monthly_cost_via_linear_extrapolation(self):
        assert project_monthly_cost(10, 10, 30) == 30

    def test_returns_current_cost_if_no_days_elapsed(self):
        assert project_monthly_cost(5, 0, 30) == 5


# ============================================================================
# Billing Period
# ============================================================================


class TestGetBillingPeriod:
    def test_returns_period_starting_on_first_of_month(self):
        now = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
        period = get_billing_period(now)

        assert period["start"] == "2026-03-01T00:00:00.000Z"
        assert period["end"] == "2026-04-01T00:00:00.000Z"
        assert period["days_total"] == 31
        assert period["days_elapsed"] > 14
        assert period["days_remaining"] < 17


class TestToUnixSeconds:
    def test_converts_date_to_unix_seconds(self):
        dt = datetime(2026, 3, 1, 0, 0, 0, tzinfo=timezone.utc)
        assert to_unix_seconds(dt) == 1772323200


# ============================================================================
# Grouping
# ============================================================================


class TestGroupUsageByModel:
    def test_groups_and_sums_tokens_by_model(self):
        buckets = [
            {
                "object": "bucket",
                "start_time": 1710000000,
                "end_time": 1710086400,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 1000, "output_tokens": 500, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 5,
                        "project_id": None, "user_id": None, "api_key_id": None,
                        "model": "gpt-4o", "batch": None,
                    },
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 5000, "output_tokens": 2000, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 20,
                        "project_id": None, "user_id": None, "api_key_id": None,
                        "model": "gpt-5-codex", "batch": None,
                    },
                ],
            },
        ]

        result = group_usage_by_model(buckets)
        assert result[0]["model"] == "gpt-5-codex"
        assert result[0]["tokens"] == 7000
        assert result[1]["model"] == "gpt-4o"
        assert result[1]["tokens"] == 1500


class TestGroupCostByLineItem:
    def test_groups_cost_by_line_item(self):
        buckets = [
            {
                "object": "bucket",
                "start_time": 1710000000,
                "end_time": 1710086400,
                "results": [
                    {"object": "organization.costs.result", "amount": {"value": 10.00, "currency": "usd"}, "line_item": "GPT-4o Completions", "project_id": None, "organization_id": None},
                    {"object": "organization.costs.result", "amount": {"value": 5.50, "currency": "usd"}, "line_item": "Codex Completions", "project_id": None, "organization_id": None},
                ],
            },
        ]

        result = group_cost_by_line_item(buckets)
        assert result[0]["line_item"] == "GPT-4o Completions"
        assert result[0]["cost_usd"] == 10.00
        assert result[1]["line_item"] == "Codex Completions"
        assert result[1]["cost_usd"] == 5.50


# ============================================================================
# Daily Breakdowns
# ============================================================================


class TestDailyTokenBreakdown:
    def test_produces_date_token_pairs_from_buckets(self):
        buckets = [
            {
                "object": "bucket", "start_time": 1710000000, "end_time": 1710086400,
                "results": [{
                    "object": "organization.usage.completions.result",
                    "input_tokens": 100, "output_tokens": 50, "input_cached_tokens": 0,
                    "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 1,
                    "project_id": None, "user_id": None, "api_key_id": None, "model": None, "batch": None,
                }],
            },
        ]

        result = daily_token_breakdown(buckets)
        assert len(result) == 1
        assert result[0]["tokens"] == 150


class TestDailyCostBreakdown:
    def test_produces_date_cost_pairs_from_buckets(self):
        buckets = [
            {
                "object": "bucket", "start_time": 1710000000, "end_time": 1710086400,
                "results": [
                    {"object": "organization.costs.result", "amount": {"value": 5.00, "currency": "usd"}, "line_item": None, "project_id": None, "organization_id": None},
                ],
            },
        ]

        result = daily_cost_breakdown(buckets)
        assert len(result) == 1
        assert result[0]["cost_usd"] == 5.00


# ============================================================================
# Per-User Codex
# ============================================================================


class TestAggregateCodexByUser:
    def test_groups_codex_usage_by_user_id_with_name_lookup(self):
        buckets = [
            {
                "object": "bucket", "start_time": 1710000000, "end_time": 1710086400,
                "results": [
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 1000, "output_tokens": 500, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 5,
                        "project_id": None, "user_id": "user-1", "api_key_id": None,
                        "model": "gpt-5-codex", "batch": None,
                    },
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 200, "output_tokens": 100, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 2,
                        "project_id": None, "user_id": "user-2", "api_key_id": None,
                        "model": "codex-mini-latest", "batch": None,
                    },
                    {
                        "object": "organization.usage.completions.result",
                        "input_tokens": 5000, "output_tokens": 2000, "input_cached_tokens": 0,
                        "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 20,
                        "project_id": None, "user_id": "user-1", "api_key_id": None,
                        "model": "gpt-4o", "batch": None,  # NOT codex — should be excluded
                    },
                ],
            },
        ]

        user_map = {
            "user-1": {"object": "organization.user", "id": "user-1", "name": "Kevin", "email": "kevin@test.com", "role": "owner", "added_at": 0},
            "user-2": {"object": "organization.user", "id": "user-2", "name": "Dev", "email": "dev@test.com", "role": "member", "added_at": 0},
        }

        result = aggregate_codex_by_user(buckets, user_map)
        assert len(result["per_user"]) == 2
        assert result["per_user"][0]["user_id"] == "user-1"
        assert result["per_user"][0]["name"] == "Kevin"
        assert result["per_user"][0]["tokens"] == 1500  # only gpt-5-codex, not gpt-4o
        assert result["per_user"][1]["user_id"] == "user-2"
        assert result["per_user"][1]["tokens"] == 300


# ============================================================================
# Full Aggregation
# ============================================================================


class TestAggregate:
    def test_produces_a_complete_codex_metrics_response(self):
        now = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)

        result = aggregate({
            "usage_report": {
                "object": "page",
                "data": [
                    {
                        "object": "bucket", "start_time": 1772006400, "end_time": 1772092800,
                        "results": [{
                            "object": "organization.usage.completions.result",
                            "input_tokens": 10000, "output_tokens": 5000, "input_cached_tokens": 500,
                            "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 50,
                            "project_id": None, "user_id": None, "api_key_id": None, "model": None, "batch": None,
                        }],
                    },
                ],
                "next_page": None,
            },
            "usage_by_model": {
                "object": "page",
                "data": [
                    {
                        "object": "bucket", "start_time": 1772006400, "end_time": 1772092800,
                        "results": [{
                            "object": "organization.usage.completions.result",
                            "input_tokens": 10000, "output_tokens": 5000, "input_cached_tokens": 500,
                            "input_audio_tokens": 0, "output_audio_tokens": 0, "num_model_requests": 50,
                            "project_id": None, "user_id": None, "api_key_id": None, "model": "gpt-4o", "batch": None,
                        }],
                    },
                ],
                "next_page": None,
            },
            "usage_by_user": {"object": "page", "data": [], "next_page": None},
            "cost_report": {
                "object": "page",
                "data": [
                    {
                        "object": "bucket", "start_time": 1772006400, "end_time": 1772092800,
                        "results": [
                            {"object": "organization.costs.result", "amount": {"value": 5.00, "currency": "usd"}, "line_item": None, "project_id": None, "organization_id": None},
                        ],
                    },
                ],
                "next_page": None,
            },
            "cost_by_line_item": {"object": "page", "data": [], "next_page": None},
            "projects": {
                "object": "list",
                "data": [{"id": "proj-1", "object": "organization.project", "name": "Default", "created_at": 0, "archived_at": None, "status": "active"}],
                "first_id": None, "last_id": None, "has_more": False,
            },
            "users": {
                "object": "list",
                "data": [{"object": "organization.user", "id": "u-1", "name": "Kevin", "email": "kevin@test.com", "role": "owner", "added_at": 0}],
                "first_id": None, "last_id": None, "has_more": False,
            },
            "api_keys_by_project": {},
            "now": now,
        })

        # Capacity
        assert result["capacity"]["openai_api"]["tokens_used"] == 15500
        assert result["capacity"]["openai_api"]["token_limit"] == 50_000_000
        assert result["capacity"]["codex_cli"] is None

        # Cost
        assert result["cost"]["current_spend_usd"] == 5.0
        assert result["cost"]["projected_spend_usd"] > 5.0

        # Usage
        assert result["usage"]["openai_api"]["input_tokens"] == 10000
        assert result["usage"]["openai_api"]["output_tokens"] == 5000
        assert result["usage"]["openai_api"]["cached_tokens"] == 500
        assert result["usage"]["codex_cli"] is None

        # Account
        assert len(result["account"]["projects"]) == 1
        assert len(result["account"]["members"]) == 1

        # Billing
        assert result["billing_period"]["days_total"] == 31

        # Meta
        assert result["meta"]["fetched_at"] == "2026-03-15T12:00:00.000Z"
