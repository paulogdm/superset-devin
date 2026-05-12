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

from datetime import datetime
from typing import Any

import pandas as pd
import pyarrow as pa
import pytest
from superset_core.semantic_layers.types import (
    Dimension,
    Filter,
    Metric,
    Operator,
    OrderDirection,
    PredicateType,
    SemanticQuery,
    SemanticRequest,
    SemanticResult,
)

from superset.semantic_layers.cache import (
    _apply_post_processing,
    _implies,
    CachedEntry,
    can_satisfy,
    shape_key,
    value_key,
    ViewMeta,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def dim(id_: str, name: str | None = None) -> Dimension:
    return Dimension(id=id_, name=name or id_, type=pa.utf8())


def met(id_: str, name: str | None = None) -> Metric:
    return Metric(id=id_, name=name or id_, type=pa.float64(), definition="x")


COL_A = dim("col.a", "a")
COL_B = dim("col.b", "b")
M_X = met("met.x", "x")
M_Y = met("met.y", "y")

VIEW = ViewMeta(uuid="view-1", changed_on_iso="2026-05-01T00:00:00", cache_timeout=None)


def where(column: Dimension | Metric | None, op: Operator, value: Any) -> Filter:
    return Filter(type=PredicateType.WHERE, column=column, operator=op, value=value)


def having(column: Metric, op: Operator, value: Any) -> Filter:
    return Filter(type=PredicateType.HAVING, column=column, operator=op, value=value)


def adhoc(definition: str, type_: PredicateType = PredicateType.WHERE) -> Filter:
    return Filter(type=type_, column=None, operator=Operator.ADHOC, value=definition)


def query(
    filters: set[Filter] | None = None,
    limit: int | None = None,
    order: Any = None,
    dimensions: list[Dimension] | None = None,
    metrics: list[Metric] | None = None,
) -> SemanticQuery:
    return SemanticQuery(
        metrics=metrics if metrics is not None else [M_X],
        dimensions=dimensions if dimensions is not None else [COL_A, COL_B],
        filters=filters,
        order=order,
        limit=limit,
    )


def entry_from(q: SemanticQuery, value_key_: str = "vk") -> CachedEntry:
    from superset.semantic_layers.cache import _group_limit_key, _order_key

    return CachedEntry(
        filters=frozenset(q.filters or set()),
        limit=q.limit,
        offset=q.offset or 0,
        order_key=_order_key(q.order),
        group_limit_key=_group_limit_key(q.group_limit),
        value_key=value_key_,
    )


# ---------------------------------------------------------------------------
# _implies: scalar range pairs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "new_op,new_val,cached_op,cached_val,expected",
    [
        # narrower lower bound
        (Operator.GREATER_THAN, 20, Operator.GREATER_THAN, 10, True),
        (Operator.GREATER_THAN, 10, Operator.GREATER_THAN, 20, False),
        (Operator.GREATER_THAN_OR_EQUAL, 11, Operator.GREATER_THAN, 10, True),
        (Operator.GREATER_THAN_OR_EQUAL, 10, Operator.GREATER_THAN, 10, False),
        (Operator.GREATER_THAN, 10, Operator.GREATER_THAN_OR_EQUAL, 10, True),
        (Operator.GREATER_THAN, 9, Operator.GREATER_THAN_OR_EQUAL, 10, False),
        # narrower upper bound
        (Operator.LESS_THAN, 5, Operator.LESS_THAN, 10, True),
        (Operator.LESS_THAN_OR_EQUAL, 9, Operator.LESS_THAN, 10, True),
        (Operator.LESS_THAN_OR_EQUAL, 10, Operator.LESS_THAN, 10, False),
        # cross-direction — never implies
        (Operator.LESS_THAN, 5, Operator.GREATER_THAN, 10, False),
        (Operator.GREATER_THAN, 5, Operator.LESS_THAN, 10, False),
        # equals fits in range
        (Operator.EQUALS, 15, Operator.GREATER_THAN, 10, True),
        (Operator.EQUALS, 10, Operator.GREATER_THAN, 10, False),
        (Operator.EQUALS, 10, Operator.GREATER_THAN_OR_EQUAL, 10, True),
    ],
)
def test_implies_range(
    new_op: Operator,
    new_val: Any,
    cached_op: Operator,
    cached_val: Any,
    expected: bool,
) -> None:
    assert (
        _implies(where(COL_A, new_op, new_val), where(COL_A, cached_op, cached_val))
        is expected
    )


def test_implies_in_subset() -> None:
    cached = where(COL_A, Operator.IN, frozenset({"a", "b", "c"}))
    assert _implies(where(COL_A, Operator.IN, frozenset({"a", "b"})), cached) is True
    assert _implies(where(COL_A, Operator.IN, frozenset({"a", "d"})), cached) is False
    # equals to a value in the cached IN set
    assert _implies(where(COL_A, Operator.EQUALS, "b"), cached) is True
    assert _implies(where(COL_A, Operator.EQUALS, "z"), cached) is False


def test_implies_in_all_in_range() -> None:
    cached = where(COL_A, Operator.GREATER_THAN, 10)
    assert _implies(where(COL_A, Operator.IN, frozenset({11, 12})), cached) is True
    assert _implies(where(COL_A, Operator.IN, frozenset({10, 12})), cached) is False


def test_implies_equals_exact() -> None:
    cached = where(COL_A, Operator.EQUALS, 5)
    assert _implies(where(COL_A, Operator.EQUALS, 5), cached) is True
    assert _implies(where(COL_A, Operator.EQUALS, 6), cached) is False


def test_implies_is_not_null() -> None:
    cached = where(COL_A, Operator.IS_NOT_NULL, None)
    assert _implies(where(COL_A, Operator.GREATER_THAN, 0), cached) is True
    assert _implies(where(COL_A, Operator.IS_NOT_NULL, None), cached) is True
    assert _implies(where(COL_A, Operator.IS_NULL, None), cached) is False


def test_implies_like_exact_match_only() -> None:
    a = where(COL_A, Operator.LIKE, "foo%")
    b = where(COL_A, Operator.LIKE, "foo%")
    c = where(COL_A, Operator.LIKE, "bar%")
    assert _implies(a, b) is True
    assert _implies(c, b) is False
    assert _implies(where(COL_A, Operator.EQUALS, "fooz"), b) is False


# ---------------------------------------------------------------------------
# can_satisfy
# ---------------------------------------------------------------------------


def test_can_satisfy_empty_cached_returns_all_as_leftovers() -> None:
    cached_q = query(filters=None)
    new_q = query(filters={where(COL_A, Operator.GREATER_THAN, 5)})
    ok, leftovers = can_satisfy(entry_from(cached_q), new_q)
    assert ok is True
    assert leftovers == {where(COL_A, Operator.GREATER_THAN, 5)}


def test_can_satisfy_narrower_filter() -> None:
    cached_q = query(filters={where(COL_A, Operator.GREATER_THAN, 1)})
    new_q = query(filters={where(COL_A, Operator.GREATER_THAN, 2)})
    ok, leftovers = can_satisfy(entry_from(cached_q), new_q)
    assert ok is True
    assert leftovers == {where(COL_A, Operator.GREATER_THAN, 2)}


def test_can_satisfy_broader_filter_fails() -> None:
    cached_q = query(filters={where(COL_A, Operator.GREATER_THAN, 2)})
    new_q = query(filters={where(COL_A, Operator.GREATER_THAN, 1)})
    ok, leftovers = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False
    assert leftovers == set()


def test_can_satisfy_missing_constraint_fails() -> None:
    cached_q = query(filters={where(COL_A, Operator.GREATER_THAN, 1)})
    new_q = query(filters=None)
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False


def test_can_satisfy_new_filter_on_extra_column() -> None:
    cached_q = query(filters={where(COL_A, Operator.GREATER_THAN, 1)})
    new_q = query(
        filters={
            where(COL_A, Operator.GREATER_THAN, 2),
            where(COL_B, Operator.EQUALS, "x"),
        }
    )
    ok, leftovers = can_satisfy(entry_from(cached_q), new_q)
    assert ok is True
    assert leftovers == {
        where(COL_A, Operator.GREATER_THAN, 2),
        where(COL_B, Operator.EQUALS, "x"),
    }


def test_can_satisfy_leftover_on_non_projected_column_fails() -> None:
    other = dim("col.other", "other")
    cached_q = query(filters=None)
    new_q = query(
        filters={where(other, Operator.EQUALS, "x")},
        dimensions=[COL_A, COL_B],
    )
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False


def test_can_satisfy_having_requires_exact_set() -> None:
    cached_q = query(filters={having(M_X, Operator.GREATER_THAN, 100)})
    same = query(filters={having(M_X, Operator.GREATER_THAN, 100)})
    tighter = query(filters={having(M_X, Operator.GREATER_THAN, 200)})
    ok_same, _ = can_satisfy(entry_from(cached_q), same)
    ok_tight, _ = can_satisfy(entry_from(cached_q), tighter)
    assert ok_same is True
    assert ok_tight is False


def test_can_satisfy_adhoc_requires_exact_set() -> None:
    cached_q = query(filters={adhoc("col_a > 1")})
    same = query(filters={adhoc("col_a > 1")})
    different = query(filters={adhoc("col_a > 2")})
    ok_same, _ = can_satisfy(entry_from(cached_q), same)
    ok_diff, _ = can_satisfy(entry_from(cached_q), different)
    assert ok_same is True
    assert ok_diff is False


# ---------------------------------------------------------------------------
# Limit / order / offset
# ---------------------------------------------------------------------------


def test_can_satisfy_unlimited_cached_satisfies_any_limit() -> None:
    cached_q = query(filters=None, limit=None)
    new_q = query(filters=None, limit=10)
    ok, leftovers = can_satisfy(entry_from(cached_q), new_q)
    assert ok is True
    assert leftovers == set()


def test_can_satisfy_smaller_limit_with_matching_order() -> None:
    order = [(M_X, OrderDirection.DESC)]
    cached_q = query(filters=None, limit=100, order=order)
    new_q = query(filters=None, limit=10, order=order)
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is True


def test_can_satisfy_smaller_limit_different_order_fails() -> None:
    cached_q = query(filters=None, limit=100, order=[(M_X, OrderDirection.DESC)])
    new_q = query(filters=None, limit=10, order=[(M_X, OrderDirection.ASC)])
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False


def test_can_satisfy_larger_limit_fails() -> None:
    cached_q = query(filters=None, limit=10)
    new_q = query(filters=None, limit=100)
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False


def test_can_satisfy_no_new_limit_when_cached_has_one_fails() -> None:
    cached_q = query(filters=None, limit=100)
    new_q = query(filters=None, limit=None)
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False


def test_can_satisfy_offset_never_reused() -> None:
    cached_q = SemanticQuery(metrics=[M_X], dimensions=[COL_A], offset=5)
    new_q = SemanticQuery(metrics=[M_X], dimensions=[COL_A], offset=5)
    ok, _ = can_satisfy(entry_from(cached_q), new_q)
    assert ok is False


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------


def test_apply_post_processing_filters_and_limits() -> None:
    df = pd.DataFrame({"a": [1, 3, 5, 7, 9], "x": [10, 20, 30, 40, 50]})
    cached = SemanticResult(
        requests=[SemanticRequest(type="SQL", definition="select ...")],
        results=pa.Table.from_pandas(df, preserve_index=False),
    )
    new_q = query(
        filters={where(COL_A, Operator.GREATER_THAN, 2)},
        limit=2,
    )
    result = _apply_post_processing(
        cached, new_q, {where(COL_A, Operator.GREATER_THAN, 2)}
    )
    result_df = result.results.to_pandas()
    assert list(result_df["a"]) == [3, 5]
    # the cache annotates the requests with a marker
    assert any(req.type == "cache" for req in result.requests)


def test_apply_post_processing_no_leftovers_no_limit_returns_original() -> None:
    df = pd.DataFrame({"a": [1, 2]})
    cached = SemanticResult(
        requests=[], results=pa.Table.from_pandas(df, preserve_index=False)
    )
    new_q = query(filters=None, limit=None)
    out = _apply_post_processing(cached, new_q, set())
    # same object reference is OK; we explicitly return the input
    assert out is cached


# ---------------------------------------------------------------------------
# Hash stability
# ---------------------------------------------------------------------------


def test_value_key_stable_across_metric_order() -> None:
    q1 = SemanticQuery(metrics=[M_X, M_Y], dimensions=[COL_A])
    q2 = SemanticQuery(metrics=[M_Y, M_X], dimensions=[COL_A])
    assert value_key(VIEW, q1) == value_key(VIEW, q2)


def test_shape_key_stable_across_dimension_order() -> None:
    q1 = SemanticQuery(metrics=[M_X], dimensions=[COL_A, COL_B])
    q2 = SemanticQuery(metrics=[M_X], dimensions=[COL_B, COL_A])
    assert shape_key(VIEW, q1) == shape_key(VIEW, q2)


def test_shape_key_changes_with_changed_on() -> None:
    q = SemanticQuery(metrics=[M_X], dimensions=[COL_A])
    other = ViewMeta(uuid=VIEW.uuid, changed_on_iso="2099-01-01", cache_timeout=None)
    assert shape_key(VIEW, q) != shape_key(other, q)


def test_value_key_changes_with_filter_value() -> None:
    q1 = SemanticQuery(
        metrics=[M_X],
        dimensions=[COL_A],
        filters={where(COL_A, Operator.GREATER_THAN, 1)},
    )
    q2 = SemanticQuery(
        metrics=[M_X],
        dimensions=[COL_A],
        filters={where(COL_A, Operator.GREATER_THAN, 2)},
    )
    assert value_key(VIEW, q1) != value_key(VIEW, q2)


def test_value_key_with_datetime_filter() -> None:
    f = where(COL_A, Operator.GREATER_THAN_OR_EQUAL, datetime(2025, 1, 1))
    q = SemanticQuery(metrics=[M_X], dimensions=[COL_A], filters={f})
    # should not raise
    assert value_key(VIEW, q).startswith("sv:val:")
