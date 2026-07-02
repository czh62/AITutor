"""结构化日志。

基于 stdlib logging，自定义 JsonFormatter 输出 JSON 行，便于采集检索。
请求 ID 通过 contextvars 关联到每条日志（由 middleware 设置）。
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

# 当前请求 ID 上下文（由 RequestIdMiddleware 写入）
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# 上下文默认透传给日志的额外字段（如 user_id 等，后续可扩展）
_LOGGING_CONTEXT: dict = {}


def set_logging_context(**kwargs) -> None:
    """追加/覆盖日志上下文字段。"""
    _LOGGING_CONTEXT.update(kwargs)


def clear_logging_context() -> None:
    _LOGGING_CONTEXT.clear()


class JsonFormatter(logging.Formatter):
    """单行 JSON 日志格式化器。"""

    _RESERVED = set(
        {
            "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
            "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
            "created", "msecs", "relativeCreated", "thread", "threadName",
            "processName", "process", "message",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        payload.update(_LOGGING_CONTEXT)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        # record.extra 字段透传
        for key, value in record.__dict__.items():
            if key not in self._RESERVED and not key.startswith("_"):
                payload[key] = value

        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = "INFO") -> None:
    """配置根日志：输出到 stdout，JSON 格式。幂等。"""
    root = logging.getLogger()
    if getattr(root, "_aitutor_configured", False):
        return

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level)
    root._aitutor_configured = True  # type: ignore[attr-defined]

    # 收敛常见第三方库噪音
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
