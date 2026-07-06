"""UnifiedContext — 一次 loop 调用的对话上下文。

参考 DeepTutor 的 UnifiedContext（dataclass，承载 session/history/tools/KB 等），
简化为只管理对话消息列表 + 累积来源 + 系统提示词，替代旧 loop.py 里散落的
accumulated_context / current_query / accumulated_references。

消息采用 OpenAI Chat Completions 格式，直接喂给 LLMClient.stream_with_tools。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .state import SourceItem, ToolCall


# 空回答 nudge：当一轮既无工具调用又无文本时注入，推动 LLM 继续行动
_NUDGE_USER_MESSAGE = (
    "你上一轮没有调用任何工具，也没有输出回答内容。请现在继续："
    "要么调用工具（rag/web_search/ask_user）收集信息，要么直接给出最终回答。"
)

# 强制结束 nudge：max_rounds 用尽时注入，要求 LLM 基于现有信息作答
_FORCE_FINISH_NUDGE = (
    "已达到最大轮次。请基于目前已收集到的信息，直接给出最终回答，"
    "并简要说明哪些方面仍不确定。不要再调用任何工具。"
)


@dataclass
class UnifiedContext:
    """一次 loop 调用的对话上下文。

    messages 始终以 system 开头（系统提示词），后续是 user/assistant/tool 序列。
    OpenAI 格式要求 assistant 带 tool_calls 时，紧随其后的 tool 消息按 tool_call_id 对齐。
    """

    system_prompt: str
    session_id: str
    original_query: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    sources: list[SourceItem] = field(default_factory=list)
    mode: str = "mix"
    web_search_available: bool = True

    def __post_init__(self) -> None:
        # 首条永远是 system
        if not self.messages:
            self.messages = [{"role": "system", "content": self.system_prompt}]
        # 追加原始用户消息
        self.messages.append({"role": "user", "content": self.original_query})

    # ------------------------------------------------------------------
    #  消息追加
    # ------------------------------------------------------------------

    def add_assistant(
        self,
        content: str,
        tool_calls: list[ToolCall] | None = None,
    ) -> None:
        """追加 assistant 消息（可能带 tool_calls）。

        带 tool_calls 时 content 可为空字符串（OpenAI 允许 assistant 消息 content=null）。
        """
        msg: dict[str, Any] = {"role": "assistant", "content": content}
        if tool_calls:
            msg["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": _json_dumps(tc.arguments),
                    },
                }
                for tc in tool_calls
            ]
        self.messages.append(msg)

    def add_tool_result(
        self,
        tool_call_id: str,
        name: str,
        content: str,
    ) -> None:
        """追加 tool result 消息（必须紧跟在带 tool_calls 的 assistant 之后）。"""
        self.messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": name,
                "content": content,
            }
        )

    def add_nudge(self, *, force: bool = False) -> None:
        """注入 nudge user 消息（空回答或强制结束）。"""
        text = _FORCE_FINISH_NUDGE if force else _NUDGE_USER_MESSAGE
        self.messages.append({"role": "user", "content": text})

    def add_user_reply(self, content: str) -> None:
        """追加普通 user 消息（如 ask_user 恢复时用户答案的 directive）。"""
        self.messages.append({"role": "user", "content": content})

    # ------------------------------------------------------------------
    #  来源管理
    # ------------------------------------------------------------------

    def extend_sources(self, sources: list[SourceItem]) -> None:
        """合并新来源，按 id 去重。空 id 的来源不可追踪，直接跳过。"""
        existing_ids = {s.id for s in self.sources if s.id}
        for s in sources:
            if not s.id:
                continue
            if s.id in existing_ids:
                continue
            self.sources.append(s)
            existing_ids.add(s.id)

    # ------------------------------------------------------------------
    #  序列化（ask_user 暂停恢复用）
    # ------------------------------------------------------------------

    def to_snapshot(self) -> dict[str, Any]:
        """序列化为可存 DB 的快照（不含 system_prompt，恢复时重组装）。"""
        return {
            "session_id": self.session_id,
            "original_query": self.original_query,
            "mode": self.mode,
            "web_search_available": self.web_search_available,
            "messages": self.messages,
            "sources": [
                {
                    "id": s.id,
                    "content": s.content,
                    "file_path": s.file_path,
                    "type": s.type,
                }
                for s in self.sources
            ],
        }

    @classmethod
    def from_snapshot(
        cls, snapshot: dict[str, Any], system_prompt: str
    ) -> "UnifiedContext":
        """从 DB 快照恢复（重新绑定当前 system_prompt）。"""
        ctx = cls.__new__(cls)
        ctx.system_prompt = system_prompt
        ctx.session_id = snapshot["session_id"]
        ctx.original_query = snapshot["original_query"]
        ctx.mode = snapshot.get("mode", "mix")
        ctx.web_search_available = snapshot.get("web_search_available", True)
        ctx.messages = list(snapshot.get("messages", []))
        ctx.sources = [
            SourceItem(
                id=s.get("id", ""),
                content=s.get("content", ""),
                file_path=s.get("file_path", ""),
                type=s.get("type", "rag"),
            )
            for s in snapshot.get("sources", [])
        ]
        return ctx


def _json_dumps(obj: Any) -> str:
    """JSON 序列化，容忍非 ASCII（确保中文不被转义）。"""
    import json

    return json.dumps(obj, ensure_ascii=False)


__all__ = ["UnifiedContext"]
