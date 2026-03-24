import { describe, it, expect } from "vitest";
import {
  sumTokens,
  sumTokensByType,
  sumCostUsd,
  projectMonthlyCost,
  getBillingPeriod,
  toUnixSeconds,
  filterCodexResults,
  groupUsageByModel,
  groupCostByLineItem,
  dailyTokenBreakdown,
  dailyCostBreakdown,
  aggregateCodexByUser,
  aggregate,
} from "../src/aggregator.js";
import { isCodexModel } from "../src/types.js";
import type {
  RawUsageBucket,
  RawCostBucket,
  RawUser,
} from "../src/types.js";

// ============================================================================
// Codex Model Detection
// ============================================================================

describe("isCodexModel", () => {
  it("matches known Codex model names", () => {
    expect(isCodexModel("codex-mini-latest")).toBe(true);
    expect(isCodexModel("gpt-5-codex")).toBe(true);
    expect(isCodexModel("gpt-5.1-codex-max")).toBe(true);
    expect(isCodexModel("gpt-5.3-codex-spark")).toBe(true);
  });

  it("rejects non-Codex models", () => {
    expect(isCodexModel("gpt-4o")).toBe(false);
    expect(isCodexModel("gpt-5")).toBe(false);
    expect(isCodexModel("o3-mini")).toBe(false);
  });
});

// ============================================================================
// Token Summation
// ============================================================================

describe("sumTokens", () => {
  it("sums input + output + cached tokens across buckets", () => {
    const buckets: RawUsageBucket[] = [
      {
        object: "bucket",
        start_time: 1710000000,
        end_time: 1710086400,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000,
            output_tokens: 500,
            input_cached_tokens: 200,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            num_model_requests: 10,
            project_id: null,
            user_id: null,
            api_key_id: null,
            model: null,
            batch: null,
          },
        ],
      },
      {
        object: "bucket",
        start_time: 1710086400,
        end_time: 1710172800,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 2000,
            output_tokens: 800,
            input_cached_tokens: 100,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            num_model_requests: 5,
            project_id: null,
            user_id: null,
            api_key_id: null,
            model: null,
            batch: null,
          },
        ],
      },
    ];

    expect(sumTokens(buckets)).toBe(1000 + 500 + 200 + 2000 + 800 + 100);
  });

  it("returns 0 for empty buckets", () => {
    expect(sumTokens([])).toBe(0);
  });
});

describe("sumTokensByType", () => {
  it("breaks down tokens by type", () => {
    const buckets: RawUsageBucket[] = [
      {
        object: "bucket",
        start_time: 1710000000,
        end_time: 1710086400,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000,
            output_tokens: 500,
            input_cached_tokens: 200,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            num_model_requests: 10,
            project_id: null,
            user_id: null,
            api_key_id: null,
            model: null,
            batch: null,
          },
        ],
      },
    ];

    const result = sumTokensByType(buckets);
    expect(result.input).toBe(1000);
    expect(result.output).toBe(500);
    expect(result.cached).toBe(200);
    expect(result.requests).toBe(10);
  });
});

// ============================================================================
// Codex Filtering
// ============================================================================

describe("filterCodexResults", () => {
  it("keeps only Codex model results", () => {
    const buckets: RawUsageBucket[] = [
      {
        object: "bucket",
        start_time: 1710000000,
        end_time: 1710086400,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000, output_tokens: 500, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 5,
            project_id: null, user_id: null, api_key_id: null,
            model: "gpt-5-codex", batch: null,
          },
          {
            object: "organization.usage.completions.result",
            input_tokens: 5000, output_tokens: 2000, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 20,
            project_id: null, user_id: null, api_key_id: null,
            model: "gpt-4o", batch: null,
          },
        ],
      },
    ];

    const filtered = filterCodexResults(buckets);
    expect(filtered.length).toBe(1);
    expect(filtered[0].results.length).toBe(1);
    expect(filtered[0].results[0].model).toBe("gpt-5-codex");
  });
});

// ============================================================================
// Cost Summation
// ============================================================================

describe("sumCostUsd", () => {
  it("sums USD amounts directly", () => {
    const buckets: RawCostBucket[] = [
      {
        object: "bucket",
        start_time: 1710000000,
        end_time: 1710086400,
        results: [
          { object: "organization.costs.result", amount: { value: 5.50, currency: "usd" }, line_item: null, project_id: null, organization_id: null },
          { object: "organization.costs.result", amount: { value: 3.25, currency: "usd" }, line_item: null, project_id: null, organization_id: null },
        ],
      },
    ];

    expect(sumCostUsd(buckets)).toBe(8.75);
  });

  it("returns 0 for empty buckets", () => {
    expect(sumCostUsd([])).toBe(0);
  });
});

// ============================================================================
// Cost Projection
// ============================================================================

describe("projectMonthlyCost", () => {
  it("projects monthly cost via linear extrapolation", () => {
    expect(projectMonthlyCost(10, 10, 30)).toBe(30);
  });

  it("returns current cost if no days elapsed", () => {
    expect(projectMonthlyCost(5, 0, 30)).toBe(5);
  });
});

// ============================================================================
// Billing Period
// ============================================================================

describe("getBillingPeriod", () => {
  it("returns period starting on the 1st of the month", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const period = getBillingPeriod(now);

    expect(period.start).toBe("2026-03-01T00:00:00.000Z");
    expect(period.end).toBe("2026-04-01T00:00:00.000Z");
    expect(period.days_total).toBe(31);
    expect(period.days_elapsed).toBeGreaterThan(14);
    expect(period.days_remaining).toBeLessThan(17);
  });
});

describe("toUnixSeconds", () => {
  it("converts Date to Unix seconds", () => {
    const date = new Date("2026-03-01T00:00:00Z");
    expect(toUnixSeconds(date)).toBe(1772323200);
  });
});

// ============================================================================
// Grouping
// ============================================================================

describe("groupUsageByModel", () => {
  it("groups and sums tokens by model", () => {
    const buckets: RawUsageBucket[] = [
      {
        object: "bucket",
        start_time: 1710000000,
        end_time: 1710086400,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000, output_tokens: 500, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 5,
            project_id: null, user_id: null, api_key_id: null,
            model: "gpt-4o", batch: null,
          },
          {
            object: "organization.usage.completions.result",
            input_tokens: 5000, output_tokens: 2000, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 20,
            project_id: null, user_id: null, api_key_id: null,
            model: "gpt-5-codex", batch: null,
          },
        ],
      },
    ];

    const result = groupUsageByModel(buckets);
    expect(result[0].model).toBe("gpt-5-codex");
    expect(result[0].tokens).toBe(7000);
    expect(result[1].model).toBe("gpt-4o");
    expect(result[1].tokens).toBe(1500);
  });
});

describe("groupCostByLineItem", () => {
  it("groups cost by line item", () => {
    const buckets: RawCostBucket[] = [
      {
        object: "bucket",
        start_time: 1710000000,
        end_time: 1710086400,
        results: [
          { object: "organization.costs.result", amount: { value: 10.00, currency: "usd" }, line_item: "GPT-4o Completions", project_id: null, organization_id: null },
          { object: "organization.costs.result", amount: { value: 5.50, currency: "usd" }, line_item: "Codex Completions", project_id: null, organization_id: null },
        ],
      },
    ];

    const result = groupCostByLineItem(buckets);
    expect(result[0].line_item).toBe("GPT-4o Completions");
    expect(result[0].cost_usd).toBe(10.00);
    expect(result[1].line_item).toBe("Codex Completions");
    expect(result[1].cost_usd).toBe(5.50);
  });
});

// ============================================================================
// Daily Breakdowns
// ============================================================================

describe("dailyTokenBreakdown", () => {
  it("produces date/token pairs from buckets", () => {
    const buckets: RawUsageBucket[] = [
      {
        object: "bucket", start_time: 1710000000, end_time: 1710086400,
        results: [{
          object: "organization.usage.completions.result",
          input_tokens: 100, output_tokens: 50, input_cached_tokens: 0,
          input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 1,
          project_id: null, user_id: null, api_key_id: null, model: null, batch: null,
        }],
      },
    ];

    const result = dailyTokenBreakdown(buckets);
    expect(result.length).toBe(1);
    expect(result[0].tokens).toBe(150);
  });
});

describe("dailyCostBreakdown", () => {
  it("produces date/cost pairs from buckets", () => {
    const buckets: RawCostBucket[] = [
      {
        object: "bucket", start_time: 1710000000, end_time: 1710086400,
        results: [
          { object: "organization.costs.result", amount: { value: 5.00, currency: "usd" }, line_item: null, project_id: null, organization_id: null },
        ],
      },
    ];

    const result = dailyCostBreakdown(buckets);
    expect(result.length).toBe(1);
    expect(result[0].cost_usd).toBe(5.00);
  });
});

// ============================================================================
// Per-User Codex
// ============================================================================

describe("aggregateCodexByUser", () => {
  it("groups Codex usage by user_id with name lookup", () => {
    const buckets: RawUsageBucket[] = [
      {
        object: "bucket", start_time: 1710000000, end_time: 1710086400,
        results: [
          {
            object: "organization.usage.completions.result",
            input_tokens: 1000, output_tokens: 500, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 5,
            project_id: null, user_id: "user-1", api_key_id: null,
            model: "gpt-5-codex", batch: null,
          },
          {
            object: "organization.usage.completions.result",
            input_tokens: 200, output_tokens: 100, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 2,
            project_id: null, user_id: "user-2", api_key_id: null,
            model: "codex-mini-latest", batch: null,
          },
          {
            object: "organization.usage.completions.result",
            input_tokens: 5000, output_tokens: 2000, input_cached_tokens: 0,
            input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 20,
            project_id: null, user_id: "user-1", api_key_id: null,
            model: "gpt-4o", batch: null, // NOT codex — should be excluded
          },
        ],
      },
    ];

    const userMap = new Map<string, RawUser>([
      ["user-1", { object: "organization.user", id: "user-1", name: "Kevin", email: "kevin@test.com", role: "owner", added_at: 0 }],
      ["user-2", { object: "organization.user", id: "user-2", name: "Dev", email: "dev@test.com", role: "member", added_at: 0 }],
    ]);

    const result = aggregateCodexByUser(buckets, userMap);
    expect(result.perUser.length).toBe(2);
    expect(result.perUser[0].user_id).toBe("user-1");
    expect(result.perUser[0].name).toBe("Kevin");
    expect(result.perUser[0].tokens).toBe(1500); // only gpt-5-codex, not gpt-4o
    expect(result.perUser[1].user_id).toBe("user-2");
    expect(result.perUser[1].tokens).toBe(300);
  });
});

// ============================================================================
// Full Aggregation
// ============================================================================

describe("aggregate", () => {
  it("produces a complete CodexMetricsResponse", () => {
    const now = new Date("2026-03-15T12:00:00Z");

    const result = aggregate({
      usageReport: {
        object: "page",
        data: [
          {
            object: "bucket", start_time: 1772006400, end_time: 1772092800,
            results: [{
              object: "organization.usage.completions.result",
              input_tokens: 10000, output_tokens: 5000, input_cached_tokens: 500,
              input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 50,
              project_id: null, user_id: null, api_key_id: null, model: null, batch: null,
            }],
          },
        ],
        next_page: null,
      },
      usageByModel: {
        object: "page",
        data: [
          {
            object: "bucket", start_time: 1772006400, end_time: 1772092800,
            results: [{
              object: "organization.usage.completions.result",
              input_tokens: 10000, output_tokens: 5000, input_cached_tokens: 500,
              input_audio_tokens: 0, output_audio_tokens: 0, num_model_requests: 50,
              project_id: null, user_id: null, api_key_id: null, model: "gpt-4o", batch: null,
            }],
          },
        ],
        next_page: null,
      },
      usageByUser: { object: "page", data: [], next_page: null },
      costReport: {
        object: "page",
        data: [
          {
            object: "bucket", start_time: 1772006400, end_time: 1772092800,
            results: [
              { object: "organization.costs.result", amount: { value: 5.00, currency: "usd" }, line_item: null, project_id: null, organization_id: null },
            ],
          },
        ],
        next_page: null,
      },
      costByLineItem: { object: "page", data: [], next_page: null },
      projects: {
        object: "list",
        data: [{ id: "proj-1", object: "organization.project", name: "Default", created_at: 0, archived_at: null, status: "active" }],
        first_id: null, last_id: null, has_more: false,
      },
      users: {
        object: "list",
        data: [{ object: "organization.user", id: "u-1", name: "Kevin", email: "kevin@test.com", role: "owner", added_at: 0 }],
        first_id: null, last_id: null, has_more: false,
      },
      apiKeysByProject: new Map(),
      now,
    });

    // Capacity
    expect(result.capacity.openai_api.tokens_used).toBe(15500);
    expect(result.capacity.openai_api.token_limit).toBe(50_000_000);
    expect(result.capacity.codex_cli).toBeNull();

    // Cost
    expect(result.cost.current_spend_usd).toBe(5.0);
    expect(result.cost.projected_spend_usd).toBeGreaterThan(5.0);

    // Usage
    expect(result.usage.openai_api.input_tokens).toBe(10000);
    expect(result.usage.openai_api.output_tokens).toBe(5000);
    expect(result.usage.openai_api.cached_tokens).toBe(500);
    expect(result.usage.codex_cli).toBeNull();

    // Account
    expect(result.account.projects.length).toBe(1);
    expect(result.account.members.length).toBe(1);

    // Billing
    expect(result.billing_period.days_total).toBe(31);

    // Meta
    expect(result.meta.fetched_at).toBe(now.toISOString());
  });
});
