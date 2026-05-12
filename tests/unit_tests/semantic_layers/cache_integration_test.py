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

"""End-to-end test that exercises ``mapper.get_results`` with a live cache."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pyarrow as pa
import pytest
from pytest_mock import MockerFixture
from superset_core.semantic_layers.types import (
    Dimension,
    Metric,
    SemanticRequest,
    SemanticResult,
)

from superset.semantic_layers import cache as cache_module
from superset.semantic_layers.mapper import get_results, ValidatedQueryObject


class _InMemoryCache:
    """Minimal flask-caching compatible cache used to isolate tests."""

    def __init__(self) -> None:
        self._store: dict[str, Any] = {}

    def get(self, key: str) -> Any:
        return self._store.get(key)

    def set(self, key: str, value: Any, timeout: int | None = None) -> bool:
        self._store[key] = value
        return True

    def delete(self, key: str) -> bool:
        return self._store.pop(key, None) is not None


@pytest.fixture
def fake_cache(mocker: MockerFixture) -> _InMemoryCache:
    fake = _InMemoryCache()
    mocker.patch.object(
        type(cache_module.cache_manager),
        "data_cache",
        property(lambda self: fake),
    )
    return fake


@pytest.fixture
def view_implementation() -> Any:
    """SemanticView implementation stub with one metric and one dimension."""
    dim_a = Dimension(id="t.a", name="a", type=pa.int64())
    metric_x = Metric(id="t.x", name="x", type=pa.float64(), definition="sum(x)")

    impl = MagicMock()
    impl.metrics = {metric_x}
    impl.dimensions = {dim_a}
    impl.features = frozenset()
    impl.get_metrics = MagicMock(return_value={metric_x})
    impl.get_dimensions = MagicMock(return_value={dim_a})
    return impl


@pytest.fixture
def datasource(view_implementation: Any) -> MagicMock:
    ds = MagicMock()
    ds.implementation = view_implementation
    ds.uuid = "view-uuid-stable"
    ds.changed_on = datetime(2026, 1, 1, 12, 0, 0)
    ds.cache_timeout = 60
    ds.fetch_values_predicate = None
    return ds


def _result(rows: list[tuple[int, float]]) -> SemanticResult:
    df = pd.DataFrame(rows, columns=["a", "x"])
    return SemanticResult(
        requests=[SemanticRequest(type="SQL", definition="select a, x")],
        results=pa.Table.from_pandas(df, preserve_index=False),
    )


def _qo(
    datasource: MagicMock,
    filter_op: str | None = None,
    filter_val: Any = None,
    limit: int | None = None,
) -> ValidatedQueryObject:
    qo_filters: list[dict[str, Any]] = (
        [{"col": "a", "op": filter_op, "val": filter_val}] if filter_op else []
    )
    return ValidatedQueryObject(
        datasource=datasource,
        metrics=["x"],
        columns=["a"],
        filters=qo_filters,  # type: ignore[arg-type]
        row_limit=limit,
    )


def test_narrower_filter_reuses_cache(
    fake_cache: _InMemoryCache,
    view_implementation: Any,
    datasource: MagicMock,
) -> None:
    # The dispatcher returns rows already filtered by `a > 1` (in production it
    # would; here we hand-feed the result). The second query (a > 2) is a subset
    # and must be served from the cached DataFrame.
    cached = _result([(2, 2.0), (3, 3.0), (5, 5.0)])
    view_implementation.get_table = MagicMock(return_value=cached)

    first = get_results(_qo(datasource, ">", 1))
    assert view_implementation.get_table.call_count == 1
    assert sorted(first.df["a"].tolist()) == [2, 3, 5]

    second = get_results(_qo(datasource, ">", 2))
    assert view_implementation.get_table.call_count == 1  # cache hit
    assert sorted(second.df["a"].tolist()) == [3, 5]


def test_smaller_limit_reuses_cache(
    fake_cache: _InMemoryCache,
    view_implementation: Any,
    datasource: MagicMock,
) -> None:
    # First call has no limit; second asks for 2 rows — should be served from cache.
    full = _result([(0, 1.0), (1, 2.0), (2, 3.0), (3, 4.0)])
    view_implementation.get_table = MagicMock(return_value=full)

    get_results(_qo(datasource, limit=None))
    assert view_implementation.get_table.call_count == 1

    result = get_results(_qo(datasource, limit=2))
    assert view_implementation.get_table.call_count == 1  # cache hit
    assert len(result.df) == 2


def test_broader_filter_misses_cache(
    fake_cache: _InMemoryCache,
    view_implementation: Any,
    datasource: MagicMock,
) -> None:
    view_implementation.get_table = MagicMock(
        side_effect=[
            _result([(2, 1.0), (3, 2.0)]),
            _result([(0, 1.0), (2, 2.0), (3, 3.0)]),
        ]
    )

    get_results(_qo(datasource, ">", 1))
    assert view_implementation.get_table.call_count == 1

    # Broader filter — must re-execute.
    get_results(_qo(datasource, ">", 0))
    assert view_implementation.get_table.call_count == 2


def test_changed_on_invalidates_cache(
    fake_cache: _InMemoryCache,
    view_implementation: Any,
    datasource: MagicMock,
) -> None:
    view_implementation.get_table = MagicMock(return_value=_result([(2, 1.0)]))

    get_results(_qo(datasource, ">", 1))
    assert view_implementation.get_table.call_count == 1

    # Bumping changed_on yields a different shape key — cache misses.
    datasource.changed_on = datetime(2026, 2, 1, 0, 0, 0)
    get_results(_qo(datasource, ">", 1))
    assert view_implementation.get_table.call_count == 2
