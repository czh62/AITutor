"""数据库 engine 与会话工厂。

沿用同步 SQLAlchemy，与旧 backend/models/database.py 一致，便于平滑迁移模型。
URL 等配置从 core.config 读取，不再硬编码。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator
from urllib.parse import urlparse, unquote

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import get_settings
from ..core.logging import get_logger

logger = get_logger("aitutor.db")

_settings = get_settings()

_connect_args = (
    {"check_same_thread": False}
    if _settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(_settings.database_url, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _sqlite_db_path() -> Path | None:
    """从 database_url 解析出 SQLite 数据库文件路径；非 SQLite 返回 None。"""
    url = _settings.database_url
    if not url.startswith("sqlite"):
        return None
    parsed = urlparse(url)
    # sqlite:///./data/aitutor.db -> path "/./data/aitutor.db"
    # sqlite:////abs/path.db     -> path "/abs/path.db"
    raw = unquote(parsed.path)
    # 去掉前导的 "/" 前面那一段相对路径标记（如 "/./" -> "./"）
    if raw.startswith("/./"):
        raw = raw[1:]
    elif raw.startswith("/") and not raw.startswith("//") and os.path.isabs(raw):
        pass  # 绝对路径保留
    else:
        raw = raw.lstrip("/")
    return Path(raw)


def reset_database() -> None:
    """删除现有数据库文件，保证下次启动是全新库。

    仅对 SQLite 文件型数据库生效；非 SQLite（如 PostgreSQL）跳过，
    避免误删共享库。同时清理 SQLite 的 -wal / -shm 附属文件。
    """
    db_path = _sqlite_db_path()
    if db_path is None:
        logger.info("reset_database skipped (non-sqlite database)")
        return

    # 先释放当前 engine 对文件的持有（Windows 下未关闭句柄会删除失败）
    engine.dispose()

    for suffix in ("", "-wal", "-shm", "-journal"):
        target = db_path.parent / (db_path.name + suffix)
        if target.exists():
            try:
                target.unlink()
                logger.info("removed existing database file", extra={"path": str(target)})
            except OSError as exc:
                logger.warning(
                    "failed to remove database file",
                    extra={"path": str(target), "error": str(exc)},
                )


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖：提供数据库会话并在请求结束时关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """建表。在 app lifespan 启动时调用。

    当前无业务模型，此处仅确保 engine 可用；后续添加模型时在下方 import 即可。
    """
    from ..db.base import Base

    Base.metadata.create_all(bind=engine)
