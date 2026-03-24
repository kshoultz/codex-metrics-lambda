"""
Lambda handler — entry point for the Codex Metrics function (Python).

Fetches all data from the OpenAI Admin API in parallel,
aggregates it into a CodexMetricsResponse, and returns it.
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .aggregator import aggregate, get_billing_period, to_unix_seconds
from .openai_admin import OpenAIAdminClient


def handler(event=None, context=None):
    api_key = os.environ.get("OPENAI_ADMIN_API_KEY")
    if not api_key:
        return {
            "statusCode": 500,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({
                "error": "OPENAI_ADMIN_API_KEY environment variable is not set",
            }),
        }

    client = OpenAIAdminClient(api_key)
    now = datetime.now(timezone.utc)
    billing_period = get_billing_period(now)
    start_time = to_unix_seconds(datetime.fromisoformat(billing_period["start"].replace("Z", "+00:00")))
    end_time = to_unix_seconds(now)

    openai_api_token_limit = int(os.environ.get("OPENAI_API_TOKEN_LIMIT", "50000000"))
    codex_cli_token_limit = int(os.environ.get("CODEX_CLI_TOKEN_LIMIT", "50000000"))

    try:
        # Fetch usage, cost, and account data in parallel
        with ThreadPoolExecutor(max_workers=7) as executor:
            f_usage = executor.submit(
                client.get_completions_usage,
                start_time=start_time,
                end_time=end_time,
            )
            f_usage_model = executor.submit(
                client.get_completions_usage_by_model,
                start_time=start_time,
                end_time=end_time,
            )
            f_usage_user = executor.submit(
                client.get_completions_usage_by_user,
                start_time=start_time,
                end_time=end_time,
            )
            f_cost = executor.submit(
                client.get_costs,
                start_time=start_time,
                end_time=end_time,
            )
            f_cost_line = executor.submit(
                client.get_costs_by_line_item,
                start_time=start_time,
                end_time=end_time,
            )
            f_projects = executor.submit(client.list_projects)
            f_users = executor.submit(client.list_users)

        usage_report = f_usage.result()
        usage_by_model = f_usage_model.result()
        usage_by_user = f_usage_user.result()
        cost_report = f_cost.result()
        cost_by_line_item = f_cost_line.result()
        projects = f_projects.result()
        users = f_users.result()

        # Fetch API keys for each project (sequential to avoid rate limits)
        api_keys_by_project: dict[str, dict] = {}
        for project in projects.get("data") or []:
            try:
                keys = client.list_project_api_keys(project["id"])
                api_keys_by_project[project["id"]] = keys
            except Exception:
                pass  # Skip projects where we can't list keys

        response = aggregate({
            "usage_report": usage_report,
            "usage_by_model": usage_by_model,
            "usage_by_user": usage_by_user,
            "cost_report": cost_report,
            "cost_by_line_item": cost_by_line_item,
            "projects": projects,
            "users": users,
            "api_keys_by_project": api_keys_by_project,
            "now": now,
            "openai_api_token_limit": openai_api_token_limit,
            "codex_cli_token_limit": codex_cli_token_limit,
        })

        return {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps(response, indent=2),
        }
    except Exception as err:
        message = str(err)
        print(f"Failed to fetch Codex metrics: {message}")

        return {
            "statusCode": 502,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({
                "error": "Failed to fetch metrics from OpenAI Admin API",
                "detail": message,
            }),
        }
