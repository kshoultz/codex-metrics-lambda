/**
 * OpenAI Admin API client — thin, typed, zero-dependency (native fetch).
 *
 * Requires an sk-admin-* key from:
 * https://platform.openai.com/settings/organization/admin-keys
 */

import type {
  RawCompletionsUsageResponse,
  RawCostsResponse,
  RawProjectApiKeysResponse,
  RawProjectsResponse,
  RawUsersResponse,
} from "./types.js";

const BASE_URL = "https://api.openai.com";

export class OpenAIAdminClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(apiKey: string, baseUrl = BASE_URL) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_ADMIN_API_KEY is required. " +
          "Get one at https://platform.openai.com/settings/organization/admin-keys"
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  // ── HTTP helpers ─────────────────────────────────────────────

  private async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[]>
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          // OpenAI uses repeated params for arrays: group_by=model&group_by=user_id
          for (const v of value) {
            url.searchParams.append(key, v);
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI Admin API ${response.status}: ${response.statusText} — ${body}`
      );
    }

    return (await response.json()) as T;
  }

  // ── Usage Reports ────────────────────────────────────────────

  async getCompletionsUsage(opts: {
    start_time: number; // Unix seconds
    end_time?: number;
    bucket_width?: string;
    group_by?: string[];
    models?: string[];
    project_ids?: string[];
    user_ids?: string[];
    limit?: number;
    page?: string;
  }): Promise<RawCompletionsUsageResponse> {
    return this.get<RawCompletionsUsageResponse>(
      "/v1/organization/usage/completions",
      {
        start_time: opts.start_time,
        ...(opts.end_time !== undefined && { end_time: opts.end_time }),
        bucket_width: opts.bucket_width ?? "1d",
        ...(opts.group_by && { group_by: opts.group_by }),
        ...(opts.models && { models: opts.models }),
        ...(opts.project_ids && { project_ids: opts.project_ids }),
        ...(opts.user_ids && { user_ids: opts.user_ids }),
        ...(opts.limit !== undefined && { limit: opts.limit }),
        ...(opts.page && { page: opts.page }),
      }
    );
  }

  async getCompletionsUsageByModel(opts: {
    start_time: number;
    end_time?: number;
    bucket_width?: string;
  }): Promise<RawCompletionsUsageResponse> {
    return this.getCompletionsUsage({
      ...opts,
      group_by: ["model"],
    });
  }

  async getCompletionsUsageByUser(opts: {
    start_time: number;
    end_time?: number;
    bucket_width?: string;
    models?: string[];
  }): Promise<RawCompletionsUsageResponse> {
    return this.getCompletionsUsage({
      ...opts,
      group_by: ["user_id", "model"],
    });
  }

  // ── Cost Reports ─────────────────────────────────────────────

  async getCosts(opts: {
    start_time: number;
    end_time?: number;
    bucket_width?: string;
    group_by?: string[];
    project_ids?: string[];
    limit?: number;
    page?: string;
  }): Promise<RawCostsResponse> {
    return this.get<RawCostsResponse>("/v1/organization/costs", {
      start_time: opts.start_time,
      ...(opts.end_time !== undefined && { end_time: opts.end_time }),
      bucket_width: opts.bucket_width ?? "1d",
      ...(opts.group_by && { group_by: opts.group_by }),
      ...(opts.project_ids && { project_ids: opts.project_ids }),
      ...(opts.limit !== undefined && { limit: opts.limit }),
      ...(opts.page && { page: opts.page }),
    });
  }

  async getCostsByLineItem(opts: {
    start_time: number;
    end_time?: number;
  }): Promise<RawCostsResponse> {
    return this.getCosts({
      ...opts,
      group_by: ["line_item"],
    });
  }

  // ── Projects ─────────────────────────────────────────────────

  async listProjects(opts?: {
    limit?: number;
    include_archived?: boolean;
    after?: string;
  }): Promise<RawProjectsResponse> {
    return this.get<RawProjectsResponse>("/v1/organization/projects", {
      limit: opts?.limit ?? 100,
      ...(opts?.include_archived !== undefined && {
        include_archived: opts.include_archived,
      }),
      ...(opts?.after && { after: opts.after }),
    });
  }

  // ── Users ────────────────────────────────────────────────────

  async listUsers(opts?: {
    limit?: number;
    after?: string;
  }): Promise<RawUsersResponse> {
    return this.get<RawUsersResponse>("/v1/organization/users", {
      limit: opts?.limit ?? 100,
      ...(opts?.after && { after: opts.after }),
    });
  }

  // ── Project API Keys ─────────────────────────────────────────

  async listProjectApiKeys(
    projectId: string,
    opts?: { limit?: number; after?: string }
  ): Promise<RawProjectApiKeysResponse> {
    return this.get<RawProjectApiKeysResponse>(
      `/v1/organization/projects/${projectId}/api_keys`,
      {
        limit: opts?.limit ?? 100,
        ...(opts?.after && { after: opts.after }),
      }
    );
  }
}
