from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

_EXPECTED_SCHEMA_REVISION = "0004_artifact_conflict_details"


class Database:
    def __init__(self, database_url: str) -> None:
        self.engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False, "timeout": 5},
            poolclass=NullPool,
        )
        self._session_factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        event.listen(self.engine, "connect", _configure_sqlite_connection)

    @contextmanager
    def session(self) -> Iterator[Session]:
        with self._session_factory() as session:
            yield session

    def close(self) -> None:
        self.engine.dispose()


def _configure_sqlite_connection(dbapi_connection: object, _connection_record: object) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def run_migrations(database_url: str) -> None:
    if _has_expected_schema_revision(database_url):
        return
    _upgrade_database(database_url)


def _upgrade_database(database_url: str) -> None:
    from alembic.config import Config

    from alembic import command

    server_root = Path(__file__).resolve().parents[3]
    config = Config(str(server_root / "alembic.ini"))
    config.set_main_option("script_location", str(server_root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")


def _has_expected_schema_revision(database_url: str) -> bool:
    database_name = make_url(database_url).database
    if database_name is None:
        return False
    database_path = Path(database_name)
    if not database_path.is_file():
        return False
    try:
        with sqlite3.connect(
            f"file:{database_path.resolve().as_posix()}?mode=ro",
            uri=True,
        ) as connection:
            row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.Error:
        return False
    return row is not None and row[0] == _EXPECTED_SCHEMA_REVISION


def ping_database(engine: Engine) -> bool:
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
        return True
    except Exception:
        return False
