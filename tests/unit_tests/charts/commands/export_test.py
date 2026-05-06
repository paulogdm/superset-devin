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
# pylint: disable=import-outside-toplevel, unused-argument, unused-import

from typing import Any, Optional

from sqlalchemy.orm.session import Session

from superset import db
from superset.utils import json


def _build_chart(
    name: str,
    params: dict[str, Any],
    query_context: Optional[dict[str, Any]] = None,
) -> Any:
    from superset.connectors.sqla.models import SqlaTable, TableColumn
    from superset.models.core import Database
    from superset.models.slice import Slice

    database = Database(database_name=f"db_{name}", sqlalchemy_uri="sqlite://")
    db.session.add(database)
    db.session.flush()
    table = SqlaTable(
        table_name=f"tbl_{name}",
        columns=[TableColumn(column_name="ds", is_dttm=1, type="TIMESTAMP")],
        database=database,
    )
    db.session.add(table)
    db.session.flush()
    chart = Slice(
        slice_name=name,
        viz_type="table",
        datasource_id=table.id,
        datasource_type="table",
        datasource_name=table.table_name,
        params=json.dumps(params),
        query_context=json.dumps(query_context) if query_context else None,
    )
    db.session.add(chart)
    db.session.flush()
    return chart


def test_export_strips_instance_specific_params(session: Session) -> None:
    """Chart export should strip instance-specific keys from params."""
    from superset.commands.chart.export import ExportChartsCommand
    from superset.connectors.sqla.models import SqlaTable

    engine = db.session.get_bind()
    SqlaTable.metadata.create_all(engine)  # pylint: disable=no-member

    chart = _build_chart(
        "leaky_chart",
        params={
            "datasource": "1__table",
            "slice_id": 42,
            "dashboards": [1, 2, 3],
            "url_params": {"foo": "bar"},
            "metric": "count",
            "row_limit": 1000,
        },
    )

    file_name, content_fn = next(
        ExportChartsCommand._export(  # pylint: disable=protected-access
            chart, export_related=False
        )
    )
    import yaml

    payload = yaml.safe_load(content_fn())
    assert payload["params"] == {"metric": "count", "row_limit": 1000}


def test_export_strips_query_context_datasource(session: Session) -> None:
    """Chart export should strip datasource refs from query_context."""
    from superset.commands.chart.export import ExportChartsCommand
    from superset.connectors.sqla.models import SqlaTable

    engine = db.session.get_bind()
    SqlaTable.metadata.create_all(engine)  # pylint: disable=no-member

    chart = _build_chart(
        "qc_chart",
        params={"viz_type": "table"},
        query_context={
            "datasource": {"id": 1, "type": "table"},
            "form_data": {
                "datasource": "1__table",
                "slice_id": 42,
                "viz_type": "table",
            },
            "queries": [
                {"datasource": {"id": 1, "type": "table"}, "metrics": ["count"]},
            ],
        },
    )

    file_name, content_fn = next(
        ExportChartsCommand._export(  # pylint: disable=protected-access
            chart, export_related=False
        )
    )
    import yaml

    payload = yaml.safe_load(content_fn())
    qc = json.loads(payload["query_context"])
    assert "datasource" not in qc
    assert "datasource" not in qc["form_data"]
    assert "slice_id" not in qc["form_data"]
    assert qc["form_data"]["viz_type"] == "table"
    assert "datasource" not in qc["queries"][0]
    assert qc["queries"][0]["metrics"] == ["count"]


def test_export_preserves_non_dict_params(session: Session) -> None:
    """Non-dict params (e.g. legacy strings) should round-trip unchanged."""
    from superset.commands.chart.export import _strip_query_context_datasource

    # _strip_query_context_datasource should be a no-op on falsy / undecodable input.
    assert _strip_query_context_datasource(None) is None
    assert _strip_query_context_datasource("") == ""
    assert _strip_query_context_datasource("not-json") == "not-json"
