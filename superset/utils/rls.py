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

from typing import Any, TYPE_CHECKING

from sqlalchemy import and_, or_

from superset import db
from superset.sql.parse import RLSMethod, Table

if TYPE_CHECKING:
    from superset.models.core import Database
    from superset.sql.parse import BaseSQLStatement


def apply_rls(
    database: Database,
    catalog: str | None,
    schema: str,
    parsed_statement: BaseSQLStatement[Any],
) -> bool:
    """
    Modify statement inplace to ensure RLS rules are applied.

    :returns: True if any RLS predicates were actually applied, False otherwise.
    """
    # There are three ways to insert RLS:
    #   - replace the table with a subquery containing the RLS (safest, but not
    #     supported in all databases)
    #   - append the RLS to the ``WHERE`` clause via AST transformation
    #   - splice the RLS into the original SQL string (preserves dialect-specific
    #     syntax that the sqlglot generator would otherwise transpile)
    method = database.db_engine_spec.get_rls_method()

    # In splice mode predicates stay as raw SQL strings and are inserted verbatim
    # into the source query — re-parsing them would force a generator round-trip
    # later and defeat the purpose.
    use_splice = method == RLSMethod.AS_PREDICATE_SPLICE
    predicates: dict[Table, list[Any]] = {}
    for table in parsed_statement.tables:
        table = table.qualify(catalog=catalog, schema=schema)
        raw_predicates = [
            predicate
            for predicate in get_predicates_for_table(
                table,
                database,
                database.get_default_catalog(),
            )
            if predicate
        ]
        predicates[table] = (
            raw_predicates
            if use_splice
            else [parsed_statement.parse_predicate(p) for p in raw_predicates]
        )

    has_predicates = any(predicates.values())
    parsed_statement.apply_rls(catalog, schema, predicates, method)
    return has_predicates


def get_predicates_for_table(
    table: Table,
    database: Database,
    default_catalog: str | None,
) -> list[str]:
    """
    Get the RLS predicates for a table.

    This is used to inject RLS rules into SQL statements run in SQL Lab. Note that the
    table must be fully qualified, with catalog (null if the DB doesn't support) and
    schema.
    """
    from superset.connectors.sqla.models import SqlaTable

    # if the dataset in the RLS has null catalog, match it when using the default
    # catalog
    catalog_predicate = SqlaTable.catalog == table.catalog
    if table.catalog and table.catalog == default_catalog:
        catalog_predicate = or_(
            catalog_predicate,
            SqlaTable.catalog.is_(None),
        )

    dataset = (
        db.session.query(SqlaTable)
        .filter(
            and_(
                SqlaTable.database_id == database.id,
                catalog_predicate,
                SqlaTable.schema == table.schema,
                SqlaTable.table_name == table.table,
            )
        )
        .one_or_none()
    )
    if not dataset:
        return []

    # Exclude global (unscoped) guest RLS to prevent double application in
    # virtual datasets. Global guest rules will be applied to the outer query
    # via get_sqla_row_level_filters() on the virtual dataset itself.
    # Dataset-scoped guest rules are still included here because they target
    # this specific physical dataset and won't match on the outer query.
    # Note: this path is also used by SQL Lab (sql_lab.py, executor.py) via
    # apply_rls(). Guest users with the default Public role cannot access SQL Lab
    # (PUBLIC_EXCLUDED_VIEW_MENUS in security/manager.py). If the guest role is
    # extended to include SQL Lab access, global guest RLS predicates for
    # underlying tables would be skipped here.
    return [
        str(
            predicate.compile(
                dialect=database.get_dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        for predicate in dataset.get_sqla_row_level_filters(
            include_global_guest_rls=False
        )
    ]


def collect_rls_predicates_for_sql(
    sql: str,
    database: Database,
    catalog: str | None,
    schema: str,
) -> list[str]:
    """
    Collect all RLS predicates that would be applied to tables in the given SQL.

    This is used for cache key generation for virtual datasets to ensure that
    different users with different RLS rules get different cache keys.

    :param sql: The SQL query to analyze
    :param database: The database the query runs against
    :param catalog: The default catalog for the query
    :param schema: The default schema for the query
    :return: List of RLS predicate strings that would be applied
    """
    from superset.sql.parse import SQLScript

    try:
        parsed_script = SQLScript(sql, engine=database.db_engine_spec.engine)
        tables = {
            table.qualify(catalog=catalog, schema=schema)
            for statement in parsed_script.statements
            for table in statement.tables
        }
        default_catalog = database.get_default_catalog()
        return sorted(
            {
                predicate
                for table in tables
                for predicate in get_predicates_for_table(
                    table,
                    database,
                    default_catalog,
                )
            }
        )
    except Exception:
        # If we can't parse the SQL, return empty list
        # This ensures RLS application failure doesn't break caching
        return []
