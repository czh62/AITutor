"""MemoryManager — 简化两层记忆（L1 追踪 + L2 摘要）。

参考 DeepTutor 的三层记忆系统（L1 trace JSONL / L2 per-surface markdown / L3 跨会话综合），
因遵循「每次重启清空 SQLite」策略，L3 跨会话综合无实质意义，故只实现 L1+L2：

- L1（追踪）：每次 loop 的关键事件（用户消息、工具调用、回答）按 sequence 追加到 trace_events 表
- L2（摘要）：由 LLM 合并 L1 追踪而成的 markdown 摘要，存 memory_summaries 表，注入 system prompt

记忆是会话内（session-scoped）的——重启后随数据库清空而消失。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from ..db.models import ChatSession, MemorySummary, TraceEvent
from ..services.llm_client import LLMClient

logger = logging.getLogger("aitutor.agentloop.memory")


# L2 合并用的 LLM 提示词（单次调用，把 L1 追踪压缩为结构化事实）
_CONSOLIDATE_SYSTEM_PROMPT = """你是记忆合并器。给定一段对话追踪，提取值得长期记住的关键事实，输出简洁的 Markdown 摘要。

要求：
- 只提取事实性信息（用户身份/偏好、已确认的结论、关键决策、重复出现的话题）
- 忽略一次性寒暄、工具调用细节、过程性内容
- 每条事实一行，用「- 」开头
- 按主题分组（用「## 」二级标题）
- 全程使用中文
- 若无值得记住的内容，输出「（暂无关键事实）」"""

_CONSOLIDATE_USER_TEMPLATE = """已有记忆摘要：
{existing}

最新对话追踪：
{trace}

请把最新追踪合并进已有摘要，输出更新后的完整 Markdown 摘要。"""


class MemoryManager:
    """两层记忆管理器（L1 追踪 + L2 摘要）。SQLite 存储，随重启清空。"""

    def __init__(self, db: sessionmaker, llm: LLMClient) -> None:
        self._db = db
        self._llm = llm

    # ------------------------------------------------------------------
    #  会话管理
    # ------------------------------------------------------------------

    def create_session(self, session_id: str) -> None:
        """创建会话记录（若已存在则更新 last_active_at）。"""
        now = time.time()
        with self._db() as session:  # type: Session
            existing = session.get(ChatSession, session_id)
            if existing is None:
                session.add(
                    ChatSession(
                        id=session_id,
                        created_at=now,
                        last_active_at=now,
                    )
                )
            else:
                existing.last_active_at = now
            session.commit()

    def touch_session(self, session_id: str) -> None:
        """更新会话最后活跃时间。"""
        now = time.time()
        with self._db() as session:  # type: Session
            row = session.get(ChatSession, session_id)
            if row is not None:
                row.last_active_at = now
                session.commit()

    # ------------------------------------------------------------------
    #  ask_user 暂停态存储
    # ------------------------------------------------------------------

    def save_paused_context(
        self, session_id: str, snapshot: dict[str, Any], round_num: int
    ) -> None:
        """保存 ask_user 暂停时的 loop 上下文快照，供恢复用。"""
        with self._db() as session:  # type: Session
            row = session.get(ChatSession, session_id)
            if row is None:
                row = ChatSession(
                    id=session_id,
                    created_at=time.time(),
                    last_active_at=time.time(),
                )
                session.add(row)
            row.paused_context_json = json.dumps(snapshot, ensure_ascii=False)
            row.paused_at_round = round_num
            session.commit()

    def load_paused_context(self, session_id: str) -> tuple[dict[str, Any], int] | None:
        """读取暂停态快照，返回 (snapshot, round) 或 None。"""
        with self._db() as session:  # type: Session
            row = session.get(ChatSession, session_id)
            if row is None or not row.paused_context_json:
                return None
            try:
                snapshot = json.loads(row.paused_context_json)
            except json.JSONDecodeError:
                return None
            return snapshot, row.paused_at_round

    def clear_paused_context(self, session_id: str) -> None:
        """恢复后清除暂停态。"""
        with self._db() as session:  # type: Session
            row = session.get(ChatSession, session_id)
            if row is not None:
                row.paused_context_json = ""
                row.paused_at_round = 0
                session.commit()

    # ------------------------------------------------------------------
    #  L1 追踪
    # ------------------------------------------------------------------

    def append_trace(self, session_id: str, entry: dict[str, Any]) -> None:
        """追加一条 L1 追踪事件。

        entry 形如 {"kind": "user_message"|"tool_call"|"tool_result"|"answer", ...}
        """
        now = time.time()
        with self._db() as session:  # type: Session
            # 计算下一个 sequence
            last_seq = (
                session.query(TraceEvent)
                .filter(TraceEvent.session_id == session_id)
                .order_by(TraceEvent.sequence.desc())
                .first()
            )
            next_seq = (last_seq.sequence + 1) if last_seq else 0
            session.add(
                TraceEvent(
                    session_id=session_id,
                    sequence=next_seq,
                    entry_json=json.dumps(entry, ensure_ascii=False),
                    created_at=now,
                )
            )
            session.commit()

    def get_traces(self, session_id: str, since_seq: int = 0) -> list[dict[str, Any]]:
        """读取 L1 追踪（从 since_seq 起），返回 entry dict 列表（按 sequence 升序）。"""
        with self._db() as session:  # type: Session
            rows = (
                session.query(TraceEvent)
                .filter(
                    TraceEvent.session_id == session_id,
                    TraceEvent.sequence >= since_seq,
                )
                .order_by(TraceEvent.sequence.asc())
                .all()
            )
            result: list[dict[str, Any]] = []
            for r in rows:
                try:
                    result.append(json.loads(r.entry_json))
                except json.JSONDecodeError:
                    continue
            return result

    # ------------------------------------------------------------------
    #  L2 摘要
    # ------------------------------------------------------------------

    async def get_memory_context(self, session_id: str) -> str:
        """返回 L2 摘要文本（无则空串）。用于注入 system prompt 的 memory 块。"""
        with self._db() as session:  # type: Session
            row = session.get(MemorySummary, session_id)
            return row.summary_markdown if row is not None else ""

    async def consolidate(self, session_id: str) -> str:
        """LLM 合并 L1 追踪 → L2 摘要，写回 memory_summaries 表。

        采用增量合并：读取已有 L2 + 新增 L1（自上次合并点），LLM 合并后整体覆盖。
        失败时保留旧摘要不抛异常。
        """
        existing = await self.get_memory_context(session_id)
        traces = self.get_traces(session_id)
        if not traces:
            return existing

        # 把追踪渲染为文本
        trace_text = self._render_traces(traces)
        if not trace_text.strip():
            return existing

        try:
            updated = await self._llm.call(
                system_prompt=_CONSOLIDATE_SYSTEM_PROMPT,
                user_prompt=_CONSOLIDATE_USER_TEMPLATE.format(
                    existing=existing or "（无）",
                    trace=trace_text,
                ),
                temperature=0.2,
                max_tokens=1024,
            )
        except Exception as exc:
            logger.error("memory consolidate failed: %s", exc)
            return existing

        # 写回
        now = time.time()
        with self._db() as session:  # type: Session
            row = session.get(MemorySummary, session_id)
            if row is None:
                session.add(
                    MemorySummary(
                        session_id=session_id,
                        summary_markdown=updated,
                        consolidated_at=now,
                    )
                )
            else:
                row.summary_markdown = updated
                row.consolidated_at = now
            session.commit()
        return updated

    # ------------------------------------------------------------------
    #  辅助
    # ------------------------------------------------------------------

    @staticmethod
    def _render_traces(traces: list[dict[str, Any]]) -> str:
        """把 L1 追踪渲染为供 LLM 合并的文本。"""
        lines: list[str] = []
        for t in traces:
            kind = t.get("kind", "")
            if kind == "user_message":
                lines.append(f"用户: {t.get('content', '')}")
            elif kind == "answer":
                lines.append(f"AI: {t.get('content', '')}")
            elif kind == "tool_call":
                lines.append(f"[工具调用 {t.get('name', '')}] {t.get('summary', '')}")
            elif kind == "tool_result":
                lines.append(f"[工具结果 {t.get('name', '')}] {t.get('summary', '')}")
        return "\n".join(lines)


__all__ = ["MemoryManager"]
