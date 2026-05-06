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
# pylint: disable=unused-argument, import-outside-toplevel, invalid-name

from sqlalchemy.orm.session import Session

from superset import db
from superset.constants import PASSWORD_MASK


def test_v0_import_from_dict_masks_password(session: Session) -> None:
    """
    The legacy YAML import (used by ``superset import_datasources``) must
    extract and encrypt the password from ``sqlalchemy_uri`` rather than
    storing it as clear text. See GH#31983.
    """
    from superset.commands.dataset.importers.v0 import import_from_dict
    from superset.models.core import Database

    engine = db.session.get_bind()
    Database.metadata.create_all(engine)  # pylint: disable=no-member

    data = {
        "databases": [
            {
                "database_name": "Example",
                "sqlalchemy_uri": (
                    "postgresql://user:secret-password"
                    "@db.example.org:5432/superset_data"
                ),
                "cache_timeout": None,
                "expose_in_sqllab": True,
                "allow_run_async": False,
                "allow_ctas": True,
                "allow_cvas": True,
                "allow_dml": True,
                "extra": "{}",
            }
        ]
    }

    import_from_dict(data)

    database = (
        db.session.query(Database).filter_by(database_name="Example").one()
    )
    # The stored URI must have the password masked, not the clear-text value.
    assert "secret-password" not in database.sqlalchemy_uri
    assert PASSWORD_MASK in database.sqlalchemy_uri
    # The actual password is stored separately in the encrypted column.
    assert database.password == "secret-password"  # noqa: S105


def test_v0_import_from_dict_no_password(session: Session) -> None:
    """
    A URI without a password is imported unchanged.
    """
    from superset.commands.dataset.importers.v0 import import_from_dict
    from superset.models.core import Database

    engine = db.session.get_bind()
    Database.metadata.create_all(engine)  # pylint: disable=no-member

    data = {
        "databases": [
            {
                "database_name": "NoPassword",
                "sqlalchemy_uri": "sqlite:///example.db",
                "extra": "{}",
            }
        ]
    }

    import_from_dict(data)

    database = (
        db.session.query(Database).filter_by(database_name="NoPassword").one()
    )
    assert database.sqlalchemy_uri == "sqlite:///example.db"
    assert database.password is None
