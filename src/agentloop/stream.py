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
    """AgentLoop NDJSON 流式事件类型。"""

    STAGE_START = "stage_start"       # Loop/轮次开始
    THINKING = "thinking"             # LLM 评估思考过程
    QUERY_REWRITE = "query_rewrite"   # 改写后的查询
    OBSERVATION = "observation"       # 检索到的上下文摘要
    PROGRESS = "progress"             # 评估结果/状态变更
    CONTENT = "content"               # 最终回答（流式 chunk）
    REFERENCES = "references"         # 引用来源（所有轮次合并）
    SEARCH = "search"                 # 联网搜索状态/结果
    RESULT = "result"                 # Loop 结果摘要
    ERROR = "error"                   # 错误
    DONE = "done"                     # 流结束


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
