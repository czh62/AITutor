"""StreamEvent — AgentLoop 流式事件数据模型。

参考 DeepTutor 的 StreamEvent/StreamEventType，大幅简化：
- 不需要 source/stage/session_id/turn_id/seq/timestamp 等字段
- 只保留 type/content/metadata 三个核心字段 + round
- NDJSON 协议：每行一个 JSON 对象
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import json


class StreamEventType(str, Enum):
    """AgentLoop NDJSON 流式事件类型。

    对齐 DeepTutor 的 StreamEventType，按 tool-calling loop 机制补齐事件类型。
    query_rewrite / search 为兼容旧前端保留，新 loop 不再发射。
    """

    STAGE_START = "stage_start"        # Loop/轮次开始
    STAGE_END = "stage_end"            # Loop/轮次结束
    THINKING = "thinking"              # LLM 推理思考过程（<think> 标签内或 reasoning_content）
    QUERY_REWRITE = "query_rewrite"    # 改写后的查询（兼容旧前端，新 loop 不发射）
    OBSERVATION = "observation"        # 检索到的上下文摘要（兼容旧前端）
    PROGRESS = "progress"              # 状态变更/轮次进度
    CONTENT = "content"                # 最终回答（流式 chunk）
    TOOL_CALL = "tool_call"            # LLM 发出工具调用
    TOOL_RESULT = "tool_result"        # 工具返回结果
    REFERENCES = "references"          # 引用来源（按轮次或合并）
    SEARCH = "search"                  # 联网搜索状态/结果（兼容旧前端）
    SOURCES = "sources"                # 所有轮次合并的来源
    RESULT = "result"                  # Loop 结果摘要
    ERROR = "error"                    # 错误
    WAIT_FOR_INPUT = "wait_for_input"  # ask_user 触发，loop 暂停等待用户回复
    SESSION = "session"                # 会话 ID 分配
    SESSION_META = "session_meta"      # 会话元数据
    DONE = "done"                      # 流结束


@dataclass
class StreamEvent:
    """AgentLoop 单个流式事件。"""

    type: StreamEventType
    round: int = 0
    content: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_ndjson(self) -> str:
        """序列化为 NDJSON 单行（含尾部换行）。"""
        obj: dict[str, Any] = {
            "type": self.type.value,
            "round": self.round,
            "content": self.content,
            "metadata": self.metadata,
        }
        return json.dumps(obj, ensure_ascii=False) + "\n"


def make_event(
    type: StreamEventType,
    *,
    round: int = 0,
    content: str = "",
    metadata: dict[str, Any] | None = None,
) -> StreamEvent:
    """便捷构造 StreamEvent。"""
    return StreamEvent(
        type=type,
        round=round,
        content=content,
        metadata=metadata or {},
    )
