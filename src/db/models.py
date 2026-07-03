"""SQLAlchemy 业务模型。

ChatSession / TraceEvent / MemorySummary 三表支撑 chat agent loop 的
会话管理、L1 追踪存储、L2 记忆摘要。随 main.py 的 reset_database() 策略
每次重启清空（SQLite 文件被删除后重建）。

使用 SQLAlchemy 2.0 风格的 Mapped 注解，与 declarative_base() 兼容。
"""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ChatSession(Base):
    """Chat 会话。

    用于 ask_user 暂停恢复：paused_context_json 存储暂停时的 UnifiedContext
    序列化状态，恢复时反序列化继续 loop。
    """

    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[float] = mapped_column(Float)
    last_active_at: Mapped[float] = mapped_column(Float)
    # ask_user 暂停时存：暂停态的 loop 上下文（messages + sources + 原始查询 + 暂停轮次）
    paused_context_json: Mapped[str] = mapped_column(Text, default="")
    paused_at_round: Mapped[int] = mapped_column(Integer, default=0)


class TraceEvent(Base):
    """L1 追踪事件（append-only）。

    每次 loop 的关键事件（用户消息、工具调用、工具结果、回答）按 sequence 顺序追加，
    供 L2 记忆摘要合并使用。
    """

    __tablename__ = "trace_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), ForeignKey("chat_sessions.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    entry_json: Mapped[str] = mapped_column(Text)  # JSONL 条目（dict 序列化）
    created_at: Mapped[float] = mapped_column(Float)


class MemorySummary(Base):
    """L2 记忆摘要（每会话一条）。

    由 LLM 合并 L1 追踪而成，作为 system prompt 的记忆块注入下一轮 loop。
    """

    __tablename__ = "memory_summaries"

    session_id: Mapped[str] = mapped_column(String(64), ForeignKey("chat_sessions.id"), primary_key=True)
    summary_markdown: Mapped[str] = mapped_column(Text, default="")
    consolidated_at: Mapped[float] = mapped_column(Float)


__all__ = ["ChatSession", "TraceEvent", "MemorySummary"]
