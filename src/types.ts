// ============================================================================
// Codex Metrics Response — the shaped output
// ============================================================================

export interface CodexMetricsResponse {
  capacity: {
    openai_api: CapacityMetrics;
    codex_cli: (CapacityMetrics & {
      per_user: { user_id: string; name: string; tokens_used: number }[];
    }) | null;
  };
  cost: CostMetrics;
  usage: {
    openai_api: UsageBreakdown;
    codex_cli: (UsageBreakdown & {
      per_user: {
        user_id: string;
        name: string;
        tokens: number;
        models_used: string[];
      }[];
    }) | null;
  };
  account: AccountInfo;
  billing_period: BillingPeriod;
  meta: {
    fetched_at: string;
    api_version: string;
  };
}

export interface CapacityMetrics {
  tokens_used: number;
  token_limit: number;
  tokens_remaining: number;
  usage_pct: number;
  daily_burn_rate: number;
  projected_tokens_at_period_end: number;
  days_until_exhaustion: number | null;
}

export interface CostMetrics {
  current_spend_usd: number;
  projected_spend_usd: number;
  daily_burn_rate_usd: number;
  by_line_item: { line_item: string; cost_usd: number }[];
  daily: { date: string; cost_usd: number }[];
}

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  num_requests: number;
  by_model: { model: string; tokens: number }[];
  daily: { date: string; tokens: number }[];
}

export interface AccountInfo {
  organization_id: string;
  projects: { id: string; name: string; archived: boolean }[];
  members: { id: string; name: string; email: string; role: string }[];
  api_keys: {
    total: number;
    keys: {
      id: string;
      name: string;
      project_id: string;
    }[];
  };
}

export interface BillingPeriod {
  start: string;
  end: string;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  resets_at: string;
}

// ============================================================================
// Known Codex model names — used to filter CLI usage from general completions
// ============================================================================

export const CODEX_MODEL_PATTERNS = [
  "codex-mini-latest",
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.4-codex",
];

export function isCodexModel(model: string): boolean {
  return CODEX_MODEL_PATTERNS.some(
    (pattern) => model === pattern || model.startsWith(pattern + "-")
  );
}

// ============================================================================
// Raw OpenAI Admin API response types
// ============================================================================

// GET /v1/organization/usage/completions
export interface RawCompletionsUsageResponse {
  object: "page";
  data: RawUsageBucket[];
  next_page: string | null;
}

export interface RawUsageBucket {
  object: "bucket";
  start_time: number; // Unix seconds
  end_time: number;
  results: RawUsageResult[];
}

export interface RawUsageResult {
  object: "organization.usage.completions.result";
  input_tokens: number;
  output_tokens: number;
  input_cached_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
  num_model_requests: number;
  project_id: string | null;
  user_id: string | null;
  api_key_id: string | null;
  model: string | null;
  batch: boolean | null;
}

// GET /v1/organization/costs
export interface RawCostsResponse {
  object: "page";
  data: RawCostBucket[];
  next_page: string | null;
}

export interface RawCostBucket {
  object: "bucket";
  start_time: number;
  end_time: number;
  results: RawCostResult[];
}

export interface RawCostResult {
  object: "organization.costs.result";
  amount: {
    value: number; // USD directly
    currency: string;
  };
  line_item: string | null;
  project_id: string | null;
  organization_id: string | null;
}

// GET /v1/organization/projects
export interface RawProjectsResponse {
  object: "list";
  data: RawProject[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface RawProject {
  id: string;
  object: "organization.project";
  name: string;
  created_at: number;
  archived_at: number | null;
  status: string;
}

// GET /v1/organization/users
export interface RawUsersResponse {
  object: "list";
  data: RawUser[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface RawUser {
  object: "organization.user";
  id: string;
  name: string;
  email: string;
  role: string;
  added_at: number;
}

// GET /v1/organization/projects/{id}/api_keys
export interface RawProjectApiKeysResponse {
  object: "list";
  data: RawProjectApiKey[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
}

export interface RawProjectApiKey {
  object: "organization.project.api_key";
  redacted_value: string;
  name: string;
  created_at: number;
  id: string;
  owner: {
    type: string;
    user?: { id: string; name: string; email: string };
    service_account?: { id: string; name: string };
  };
}
