/**
 * Aggregator — shapes raw OpenAI Admin API responses into CodexMetricsResponse.
 *
 * Same math as claude-metrics-lambda (billing period, burn rate, projection,
 * exhaustion), adapted for OpenAI's response shapes:
 * - Simpler token fields (input, output, cached — no ephemeral cache creation)
 * - Costs in USD directly (no cents conversion)
 * - Timestamps as Unix seconds (not RFC 3339)
 * - Codex CLI detected by filtering known model names
 */

import type {
  AccountInfo,
  BillingPeriod,
  CapacityMetrics,
  CodexMetricsResponse,
  CostMetrics,
  RawCompletionsUsageResponse,
  RawCostBucket,
  RawCostsResponse,
  RawProjectApiKeysResponse,
  RawProjectsResponse,
  RawUsageBucket,
  RawUsageResult,
  RawUser,
  RawUsersResponse,
  UsageBreakdown,
} from "./types.js";
import { isCodexModel } from "./types.js";

const DEFAULT_TOKEN_LIMIT = 50_000_000; // 50M tokens

// ============================================================================
// Billing Period
// ============================================================================

export function getBillingPeriod(now = new Date()): BillingPeriod {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const endOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  const daysTotal = Math.round(
    (endOfMonth.getTime() - start.getTime()) / 86_400_000
  );
  const daysElapsed = Math.max(
    (now.getTime() - start.getTime()) / 86_400_000,
    0
  );
  const daysRemaining = Math.max(daysTotal - daysElapsed, 0);

  return {
    start: start.toISOString(),
    end: endOfMonth.toISOString(),
    days_total: daysTotal,
    days_elapsed: round2(daysElapsed),
    days_remaining: round2(daysRemaining),
    resets_at: endOfMonth.toISOString(),
  };
}

/** Convert a Date to Unix seconds for the OpenAI API. */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Convert Unix seconds to YYYY-MM-DD string. */
function unixToDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

// ============================================================================
// Token Summation
// ============================================================================

/** Sum all tokens across usage buckets. */
export function sumTokens(buckets: RawUsageBucket[]): number {
  let total = 0;
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      total += result.input_tokens ?? 0;
      total += result.output_tokens ?? 0;
      total += result.input_cached_tokens ?? 0;
    }
  }
  return total;
}

/** Sum tokens broken down by type. */
export function sumTokensByType(buckets: RawUsageBucket[]): {
  input: number;
  output: number;
  cached: number;
  requests: number;
} {
  let input = 0;
  let output = 0;
  let cached = 0;
  let requests = 0;

  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      input += result.input_tokens ?? 0;
      output += result.output_tokens ?? 0;
      cached += result.input_cached_tokens ?? 0;
      requests += result.num_model_requests ?? 0;
    }
  }

  return { input, output, cached, requests };
}

/** Filter bucket results to only Codex model results. */
export function filterCodexResults(buckets: RawUsageBucket[]): RawUsageBucket[] {
  return buckets
    .map((bucket) => ({
      ...bucket,
      results: bucket.results.filter(
        (r) => r.model != null && isCodexModel(r.model)
      ),
    }))
    .filter((bucket) => bucket.results.length > 0);
}

// ============================================================================
// Cost Summation
// ============================================================================

/** Sum cost across buckets. OpenAI returns amount.value in USD directly. */
export function sumCostUsd(buckets: RawCostBucket[]): number {
  let total = 0;
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      total += result.amount?.value ?? 0;
    }
  }
  return round2(total);
}

// ============================================================================
// Cost Projection (same math as claude-metrics-lambda)
// ============================================================================

export function projectMonthlyCost(
  currentCostUsd: number,
  daysElapsed: number,
  daysTotal: number
): number {
  if (daysElapsed <= 0) return currentCostUsd;
  const dailyRate = currentCostUsd / daysElapsed;
  return round2(dailyRate * daysTotal);
}

// ============================================================================
// By-Model / By-Line-Item Grouping
// ============================================================================

export function groupUsageByModel(
  buckets: RawUsageBucket[]
): { model: string; tokens: number }[] {
  const map = new Map<string, number>();
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      const model = result.model ?? "unknown";
      const tokens =
        (result.input_tokens ?? 0) +
        (result.output_tokens ?? 0) +
        (result.input_cached_tokens ?? 0);
      map.set(model, (map.get(model) ?? 0) + tokens);
    }
  }
  return Array.from(map.entries())
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function groupCostByLineItem(
  buckets: RawCostBucket[]
): { line_item: string; cost_usd: number }[] {
  const map = new Map<string, number>();
  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      const item = result.line_item ?? "unknown";
      map.set(item, (map.get(item) ?? 0) + (result.amount?.value ?? 0));
    }
  }
  return Array.from(map.entries())
    .map(([line_item, cost_usd]) => ({ line_item, cost_usd: round2(cost_usd) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
}

// ============================================================================
// Daily Breakdown
// ============================================================================

export function dailyTokenBreakdown(
  buckets: RawUsageBucket[]
): { date: string; tokens: number }[] {
  return buckets.map((bucket) => {
    let tokens = 0;
    for (const result of bucket.results ?? []) {
      tokens += result.input_tokens ?? 0;
      tokens += result.output_tokens ?? 0;
      tokens += result.input_cached_tokens ?? 0;
    }
    return { date: unixToDate(bucket.start_time), tokens };
  });
}

export function dailyCostBreakdown(
  buckets: RawCostBucket[]
): { date: string; cost_usd: number }[] {
  return buckets.map((bucket) => {
    let usd = 0;
    for (const result of bucket.results ?? []) {
      usd += result.amount?.value ?? 0;
    }
    return { date: unixToDate(bucket.start_time), cost_usd: round2(usd) };
  });
}

// ============================================================================
// Per-User Codex Aggregation
// ============================================================================

export function aggregateCodexByUser(
  buckets: RawUsageBucket[],
  userMap: Map<string, RawUser>
): {
  perUser: { user_id: string; name: string; tokens: number; modelsUsed: Set<string> }[];
} {
  const map = new Map<string, { tokens: number; modelsUsed: Set<string> }>();

  for (const bucket of buckets) {
    for (const result of bucket.results ?? []) {
      if (result.model == null || !isCodexModel(result.model)) continue;
      const userId = result.user_id ?? "unknown";
      const tokens =
        (result.input_tokens ?? 0) +
        (result.output_tokens ?? 0) +
        (result.input_cached_tokens ?? 0);

      const entry = map.get(userId) ?? { tokens: 0, modelsUsed: new Set<string>() };
      entry.tokens += tokens;
      entry.modelsUsed.add(result.model);
      map.set(userId, entry);
    }
  }

  const perUser = Array.from(map.entries())
    .map(([user_id, data]) => ({
      user_id,
      name: userMap.get(user_id)?.name ?? user_id,
      tokens: data.tokens,
      modelsUsed: data.modelsUsed,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return { perUser };
}

// ============================================================================
// Capacity Metrics (same math as claude-metrics-lambda)
// ============================================================================

function buildCapacity(
  tokensUsed: number,
  tokenLimit: number,
  daysElapsed: number,
  daysRemaining: number
): CapacityMetrics {
  const tokensRemaining = Math.max(tokenLimit - tokensUsed, 0);
  const usagePct =
    tokenLimit > 0 ? round1((tokensUsed / tokenLimit) * 100) : 0;
  const dailyBurnRate =
    daysElapsed > 0 ? Math.round(tokensUsed / daysElapsed) : 0;
  const projectedAtEnd = tokensUsed + dailyBurnRate * daysRemaining;

  let daysUntilExhaustion: number | null = null;
  if (dailyBurnRate > 0 && projectedAtEnd > tokenLimit) {
    daysUntilExhaustion = round1(tokensRemaining / dailyBurnRate);
  }

  return {
    tokens_used: tokensUsed,
    token_limit: tokenLimit,
    tokens_remaining: tokensRemaining,
    usage_pct: usagePct,
    daily_burn_rate: dailyBurnRate,
    projected_tokens_at_period_end: Math.round(projectedAtEnd),
    days_until_exhaustion: daysUntilExhaustion,
  };
}

// ============================================================================
// Main Aggregator
// ============================================================================

export interface AggregatorInput {
  usageReport: RawCompletionsUsageResponse;
  usageByModel: RawCompletionsUsageResponse;
  usageByUser: RawCompletionsUsageResponse;
  costReport: RawCostsResponse;
  costByLineItem: RawCostsResponse;
  projects: RawProjectsResponse;
  users: RawUsersResponse;
  apiKeysByProject: Map<string, RawProjectApiKeysResponse>;
  now?: Date;
  openaiApiTokenLimit?: number;
  codexCliTokenLimit?: number;
}

export function aggregate(input: AggregatorInput): CodexMetricsResponse {
  const now = input.now ?? new Date();
  const billingPeriod = getBillingPeriod(now);
  const openaiApiTokenLimit = input.openaiApiTokenLimit ?? DEFAULT_TOKEN_LIMIT;
  const codexCliTokenLimit = input.codexCliTokenLimit ?? DEFAULT_TOKEN_LIMIT;

  // Build user lookup
  const userMap = new Map<string, RawUser>();
  for (const user of input.users.data ?? []) {
    userMap.set(user.id, user);
  }

  // ── Usage ──────────────────────────────────────────────────
  const apiTokens = sumTokensByType(input.usageReport.data ?? []);
  const apiTotalTokens = sumTokens(input.usageReport.data ?? []);

  // ── Codex CLI ──────────────────────────────────────────────
  const codexBuckets = filterCodexResults(input.usageReport.data ?? []);
  const codexTokens = sumTokensByType(codexBuckets);
  const codexTotalTokens = sumTokens(codexBuckets);
  const hasCodex = codexTotalTokens > 0;

  const codexByUser = aggregateCodexByUser(
    input.usageByUser.data ?? [],
    userMap
  );

  // ── Cost ───────────────────────────────────────────────────
  const currentSpendUsd = sumCostUsd(input.costReport.data ?? []);
  const projectedSpendUsd = projectMonthlyCost(
    currentSpendUsd,
    billingPeriod.days_elapsed,
    billingPeriod.days_total
  );
  const dailyBurnRateUsd =
    billingPeriod.days_elapsed > 0
      ? round2(currentSpendUsd / billingPeriod.days_elapsed)
      : 0;

  // ── Capacity ───────────────────────────────────────────────
  const apiCapacity = buildCapacity(
    apiTotalTokens,
    openaiApiTokenLimit,
    billingPeriod.days_elapsed,
    billingPeriod.days_remaining
  );

  const codexCapacity = hasCodex
    ? {
        ...buildCapacity(
          codexTotalTokens,
          codexCliTokenLimit,
          billingPeriod.days_elapsed,
          billingPeriod.days_remaining
        ),
        per_user: codexByUser.perUser.map((u) => ({
          user_id: u.user_id,
          name: u.name,
          tokens_used: u.tokens,
        })),
      }
    : null;

  // ── Usage breakdown ────────────────────────────────────────
  const apiUsage: UsageBreakdown = {
    input_tokens: apiTokens.input,
    output_tokens: apiTokens.output,
    cached_tokens: apiTokens.cached,
    num_requests: apiTokens.requests,
    by_model: groupUsageByModel(input.usageByModel.data ?? []),
    daily: dailyTokenBreakdown(input.usageReport.data ?? []),
  };

  const codexUsage = hasCodex
    ? {
        input_tokens: codexTokens.input,
        output_tokens: codexTokens.output,
        cached_tokens: codexTokens.cached,
        num_requests: codexTokens.requests,
        by_model: groupUsageByModel(codexBuckets),
        daily: dailyTokenBreakdown(codexBuckets),
        per_user: codexByUser.perUser.map((u) => ({
          user_id: u.user_id,
          name: u.name,
          tokens: u.tokens,
          models_used: Array.from(u.modelsUsed),
        })),
      }
    : null;

  // ── Account ────────────────────────────────────────────────
  const allKeys: { id: string; name: string; project_id: string }[] = [];
  for (const [projectId, keysResp] of input.apiKeysByProject) {
    for (const key of keysResp.data ?? []) {
      allKeys.push({ id: key.id, name: key.name, project_id: projectId });
    }
  }

  const account: AccountInfo = {
    organization_id: "",
    projects: (input.projects.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      archived: p.archived_at != null,
    })),
    members: (input.users.data ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    })),
    api_keys: {
      total: allKeys.length,
      keys: allKeys,
    },
  };

  // ── Cost metrics ───────────────────────────────────────────
  const cost: CostMetrics = {
    current_spend_usd: currentSpendUsd,
    projected_spend_usd: projectedSpendUsd,
    daily_burn_rate_usd: dailyBurnRateUsd,
    by_line_item: groupCostByLineItem(input.costByLineItem.data ?? []),
    daily: dailyCostBreakdown(input.costReport.data ?? []),
  };

  return {
    capacity: {
      openai_api: apiCapacity,
      codex_cli: codexCapacity,
    },
    cost,
    usage: {
      openai_api: apiUsage,
      codex_cli: codexUsage,
    },
    account,
    billing_period: billingPeriod,
    meta: {
      fetched_at: now.toISOString(),
      api_version: "v1",
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
