"""
TypedDict definitions for Codex Metrics Lambda.

Output types mirror CodexMetricsResponse from the TypeScript version.
Raw types mirror the OpenAI Admin API response shapes.
"""

from __future__ import annotations

from typing import NotRequired, Optional, TypedDict


# ============================================================================
# Codex Metrics Response — the shaped output
# ============================================================================


class CapacityMetrics(TypedDict):
    tokens_used: int
    token_limit: int
    tokens_remaining: int
    usage_pct: float
    daily_burn_rate: int
    projected_tokens_at_period_end: int
    days_until_exhaustion: Optional[float]


class CapacityPerUser(TypedDict):
    user_id: str
    name: str
    tokens_used: int


class CostByLineItem(TypedDict):
    line_item: str
    cost_usd: float


class DailyCost(TypedDict):
    date: str
    cost_usd: float


class CostMetrics(TypedDict):
    current_spend_usd: float
    projected_spend_usd: float
    daily_burn_rate_usd: float
    by_line_item: list[CostByLineItem]
    daily: list[DailyCost]


class ModelUsage(TypedDict):
    model: str
    tokens: int


class DailyTokens(TypedDict):
    date: str
    tokens: int


class UsageBreakdown(TypedDict):
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    num_requests: int
    by_model: list[ModelUsage]
    daily: list[DailyTokens]


class CodexPerUser(TypedDict):
    user_id: str
    name: str
    tokens: int
    models_used: list[str]


class ProjectInfo(TypedDict):
    id: str
    name: str
    archived: bool


class MemberInfo(TypedDict):
    id: str
    name: str
    email: str
    role: str


class ApiKeyInfo(TypedDict):
    id: str
    name: str
    project_id: str


class ApiKeySummary(TypedDict):
    total: int
    keys: list[ApiKeyInfo]


class AccountInfo(TypedDict):
    organization_id: str
    projects: list[ProjectInfo]
    members: list[MemberInfo]
    api_keys: ApiKeySummary


class BillingPeriod(TypedDict):
    start: str
    end: str
    days_total: int
    days_elapsed: float
    days_remaining: float
    resets_at: str


class MetaInfo(TypedDict):
    fetched_at: str
    api_version: str


class CodexMetricsResponse(TypedDict):
    capacity: dict
    cost: CostMetrics
    usage: dict
    account: AccountInfo
    billing_period: BillingPeriod
    meta: MetaInfo


# ============================================================================
# Known Codex model names — used to filter CLI usage from general completions
# ============================================================================

CODEX_MODEL_PATTERNS = [
    "codex-mini-latest",
    "gpt-5-codex",
    "gpt-5-codex-mini",
    "gpt-5.1-codex",
    "gpt-5.1-codex-max",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.4-codex",
]


def is_codex_model(model: str) -> bool:
    return any(
        model == pattern or model.startswith(pattern + "-")
        for pattern in CODEX_MODEL_PATTERNS
    )


# ============================================================================
# Raw OpenAI Admin API response types
# ============================================================================


# GET /v1/organization/usage/completions
class RawUsageResult(TypedDict, total=False):
    object: str
    input_tokens: int
    output_tokens: int
    input_cached_tokens: int
    input_audio_tokens: int
    output_audio_tokens: int
    num_model_requests: int
    project_id: Optional[str]
    user_id: Optional[str]
    api_key_id: Optional[str]
    model: Optional[str]
    batch: Optional[bool]


class RawUsageBucket(TypedDict):
    object: str
    start_time: int  # Unix seconds
    end_time: int
    results: list[RawUsageResult]


class RawCompletionsUsageResponse(TypedDict):
    object: str
    data: list[RawUsageBucket]
    next_page: Optional[str]


# GET /v1/organization/costs
class RawCostAmount(TypedDict):
    value: float  # USD directly
    currency: str


class RawCostResult(TypedDict, total=False):
    object: str
    amount: RawCostAmount
    line_item: Optional[str]
    project_id: Optional[str]
    organization_id: Optional[str]


class RawCostBucket(TypedDict):
    object: str
    start_time: int
    end_time: int
    results: list[RawCostResult]


class RawCostsResponse(TypedDict):
    object: str
    data: list[RawCostBucket]
    next_page: Optional[str]


# GET /v1/organization/projects
class RawProject(TypedDict):
    id: str
    object: str
    name: str
    created_at: int
    archived_at: Optional[int]
    status: str


class RawProjectsResponse(TypedDict):
    object: str
    data: list[RawProject]
    first_id: Optional[str]
    last_id: Optional[str]
    has_more: bool


# GET /v1/organization/users
class RawUser(TypedDict):
    object: str
    id: str
    name: str
    email: str
    role: str
    added_at: int


class RawUsersResponse(TypedDict):
    object: str
    data: list[RawUser]
    first_id: Optional[str]
    last_id: Optional[str]
    has_more: bool


# GET /v1/organization/projects/{id}/api_keys
class RawProjectApiKeyOwnerUser(TypedDict, total=False):
    id: str
    name: str
    email: str


class RawProjectApiKeyOwnerServiceAccount(TypedDict, total=False):
    id: str
    name: str


class RawProjectApiKeyOwner(TypedDict, total=False):
    type: str
    user: RawProjectApiKeyOwnerUser
    service_account: RawProjectApiKeyOwnerServiceAccount


class RawProjectApiKey(TypedDict):
    object: str
    redacted_value: str
    name: str
    created_at: int
    id: str
    owner: RawProjectApiKeyOwner


class RawProjectApiKeysResponse(TypedDict):
    object: str
    data: list[RawProjectApiKey]
    first_id: Optional[str]
    last_id: Optional[str]
    has_more: bool
