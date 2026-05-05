# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
from __future__ import annotations

import logging
from typing import Any

import requests
from flask import current_app as app

from superset.utils import json

logger = logging.getLogger(__name__)

DEFAULT_QUERY_CONTEXT_SIDECAR_TIMEOUT = 30


class QueryContextSidecarError(Exception):
    """Raised when query context cannot be generated via sidecar."""


def maybe_generate_query_context(model: Any, params_json: str | None) -> None:
    """Best-effort generation of query_context via the sidecar service.

    Sets ``model.query_context`` on success.  Failures are logged but never
    re-raised so chart saves are not blocked.
    """
    sidecar_url = app.config.get("QUERY_CONTEXT_SIDECAR_URL")
    if not sidecar_url or not params_json:
        return

    try:
        form_data = json.loads(params_json)
    except (TypeError, json.JSONDecodeError):
        logger.warning("Could not parse chart params for sidecar query context")
        return

    timeout = app.config.get(
        "QUERY_CONTEXT_SIDECAR_TIMEOUT",
        DEFAULT_QUERY_CONTEXT_SIDECAR_TIMEOUT,
    )

    try:
        result = fetch_query_context_from_sidecar(
            sidecar_url=sidecar_url,
            form_data=form_data,
            timeout=timeout,
        )
        model.query_context = json.dumps(result)
    except QueryContextSidecarError:
        logger.warning(
            "Failed to generate query context via sidecar for chart %s",
            getattr(model, "id", "?"),
        )
    except Exception:
        logger.warning(
            "Unexpected error generating query context via sidecar for chart %s",
            getattr(model, "id", "?"),
            exc_info=True,
        )


def fetch_query_context_from_sidecar(
    *,
    sidecar_url: str,
    form_data: dict[str, Any],
    timeout: int,
) -> dict[str, Any]:
    endpoint = f"{sidecar_url.rstrip('/')}/api/v1/build-query-context"

    try:
        response = requests.post(
            endpoint,
            json={"form_data": form_data},
            timeout=timeout,
        )
    except requests.RequestException as ex:
        raise QueryContextSidecarError("Query context sidecar unavailable") from ex

    if response.status_code != 200:
        raise QueryContextSidecarError("Query context sidecar error")

    try:
        payload = response.json()
    except ValueError as ex:
        raise QueryContextSidecarError(
            "Query context sidecar returned invalid response"
        ) from ex

    query_context = payload.get("query_context")
    if not isinstance(query_context, dict):
        raise QueryContextSidecarError(
            "Query context sidecar returned invalid response"
        )

    return query_context
