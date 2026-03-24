/**
 * Lambda handler — entry point for the Codex Metrics function.
 *
 * Fetches all data from the OpenAI Admin API in parallel,
 * aggregates it into a CodexMetricsResponse, and returns it.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { OpenAIAdminClient } from "./openai-admin.js";
import { aggregate, getBillingPeriod, toUnixSeconds } from "./aggregator.js";
import type { RawProjectApiKeysResponse } from "./types.js";

export const handler = async (
  event?: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const apiKey = process.env.OPENAI_ADMIN_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "OPENAI_ADMIN_API_KEY environment variable is not set",
      }),
    };
  }

  const client = new OpenAIAdminClient(apiKey);
  const now = new Date();
  const billingPeriod = getBillingPeriod(now);
  const startTime = toUnixSeconds(new Date(billingPeriod.start));
  const endTime = toUnixSeconds(now);

  const openaiApiTokenLimit = parseInt(
    process.env.OPENAI_API_TOKEN_LIMIT ?? "50000000",
    10
  );
  const codexCliTokenLimit = parseInt(
    process.env.CODEX_CLI_TOKEN_LIMIT ?? "50000000",
    10
  );

  try {
    // Fetch usage, cost, and account data in parallel
    const [
      usageReport,
      usageByModel,
      usageByUser,
      costReport,
      costByLineItem,
      projects,
      users,
    ] = await Promise.all([
      client.getCompletionsUsage({
        start_time: startTime,
        end_time: endTime,
      }),
      client.getCompletionsUsageByModel({
        start_time: startTime,
        end_time: endTime,
      }),
      client.getCompletionsUsageByUser({
        start_time: startTime,
        end_time: endTime,
      }),
      client.getCosts({
        start_time: startTime,
        end_time: endTime,
      }),
      client.getCostsByLineItem({
        start_time: startTime,
        end_time: endTime,
      }),
      client.listProjects(),
      client.listUsers(),
    ]);

    // Fetch API keys for each project (sequential to avoid rate limits)
    const apiKeysByProject = new Map<string, RawProjectApiKeysResponse>();
    for (const project of projects.data ?? []) {
      try {
        const keys = await client.listProjectApiKeys(project.id);
        apiKeysByProject.set(project.id, keys);
      } catch {
        // Skip projects where we can't list keys
      }
    }

    const response = aggregate({
      usageReport,
      usageByModel,
      usageByUser,
      costReport,
      costByLineItem,
      projects,
      users,
      apiKeysByProject,
      now,
      openaiApiTokenLimit,
      codexCliTokenLimit,
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(response, null, 2),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to fetch Codex metrics:", message);

    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "Failed to fetch metrics from OpenAI Admin API",
        detail: message,
      }),
    };
  }
};
