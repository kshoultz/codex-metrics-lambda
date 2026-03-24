"""
OpenAI Admin API client — thin, typed, zero-dependency (urllib.request).

Requires an sk-admin-* key from:
https://platform.openai.com/settings/organization/admin-keys
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

BASE_URL = "https://api.openai.com"


class OpenAIAdminClient:
    def __init__(self, api_key: str, base_url: str = BASE_URL) -> None:
        if not api_key:
            raise ValueError(
                "OPENAI_ADMIN_API_KEY is required. "
                "Get one at https://platform.openai.com/settings/organization/admin-keys"
            )
        self._api_key = api_key
        self._base_url = base_url
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    # -- HTTP helpers ----------------------------------------------------------

    def _get(
        self,
        path: str,
        params: Optional[dict[str, Any]] = None,
    ) -> dict:
        url = f"{self._base_url}{path}"
        if params:
            # Build query string, handling repeated params for arrays
            parts: list[str] = []
            for k, v in params.items():
                if v is None:
                    continue
                if isinstance(v, list):
                    # OpenAI uses repeated params: group_by=model&group_by=user_id
                    for item in v:
                        parts.append(f"{urllib.parse.quote(k)}={urllib.parse.quote(str(item))}")
                else:
                    parts.append(f"{urllib.parse.quote(k)}={urllib.parse.quote(str(v))}")
            if parts:
                url = f"{url}?{'&'.join(parts)}"

        req = urllib.request.Request(url, headers=self._headers, method="GET")

        try:
            with urllib.request.urlopen(req) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else ""
            raise RuntimeError(
                f"OpenAI Admin API {e.code}: {e.reason} — {error_body}"
            ) from e

    # -- Usage Reports ---------------------------------------------------------

    def get_completions_usage(
        self,
        *,
        start_time: int,
        end_time: Optional[int] = None,
        bucket_width: str = "1d",
        group_by: Optional[list[str]] = None,
        models: Optional[list[str]] = None,
        project_ids: Optional[list[str]] = None,
        user_ids: Optional[list[str]] = None,
        limit: Optional[int] = None,
        page: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {
            "start_time": start_time,
            "bucket_width": bucket_width,
        }
        if end_time is not None:
            params["end_time"] = end_time
        if group_by:
            params["group_by"] = group_by
        if models:
            params["models"] = models
        if project_ids:
            params["project_ids"] = project_ids
        if user_ids:
            params["user_ids"] = user_ids
        if limit is not None:
            params["limit"] = limit
        if page:
            params["page"] = page
        return self._get("/v1/organization/usage/completions", params)

    def get_completions_usage_by_model(
        self,
        *,
        start_time: int,
        end_time: Optional[int] = None,
        bucket_width: str = "1d",
    ) -> dict:
        return self.get_completions_usage(
            start_time=start_time,
            end_time=end_time,
            bucket_width=bucket_width,
            group_by=["model"],
        )

    def get_completions_usage_by_user(
        self,
        *,
        start_time: int,
        end_time: Optional[int] = None,
        bucket_width: str = "1d",
        models: Optional[list[str]] = None,
    ) -> dict:
        return self.get_completions_usage(
            start_time=start_time,
            end_time=end_time,
            bucket_width=bucket_width,
            group_by=["user_id", "model"],
            models=models,
        )

    # -- Cost Reports ----------------------------------------------------------

    def get_costs(
        self,
        *,
        start_time: int,
        end_time: Optional[int] = None,
        bucket_width: str = "1d",
        group_by: Optional[list[str]] = None,
        project_ids: Optional[list[str]] = None,
        limit: Optional[int] = None,
        page: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {
            "start_time": start_time,
            "bucket_width": bucket_width,
        }
        if end_time is not None:
            params["end_time"] = end_time
        if group_by:
            params["group_by"] = group_by
        if project_ids:
            params["project_ids"] = project_ids
        if limit is not None:
            params["limit"] = limit
        if page:
            params["page"] = page
        return self._get("/v1/organization/costs", params)

    def get_costs_by_line_item(
        self,
        *,
        start_time: int,
        end_time: Optional[int] = None,
    ) -> dict:
        return self.get_costs(
            start_time=start_time,
            end_time=end_time,
            group_by=["line_item"],
        )

    # -- Projects --------------------------------------------------------------

    def list_projects(
        self,
        *,
        limit: int = 100,
        include_archived: Optional[bool] = None,
        after: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {"limit": limit}
        if include_archived is not None:
            params["include_archived"] = str(include_archived).lower()
        if after:
            params["after"] = after
        return self._get("/v1/organization/projects", params)

    # -- Users -----------------------------------------------------------------

    def list_users(
        self,
        *,
        limit: int = 100,
        after: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {"limit": limit}
        if after:
            params["after"] = after
        return self._get("/v1/organization/users", params)

    # -- Project API Keys ------------------------------------------------------

    def list_project_api_keys(
        self,
        project_id: str,
        *,
        limit: int = 100,
        after: Optional[str] = None,
    ) -> dict:
        params: dict[str, Any] = {"limit": limit}
        if after:
            params["after"] = after
        return self._get(f"/v1/organization/projects/{project_id}/api_keys", params)
