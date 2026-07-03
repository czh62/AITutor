"""AgentLoop 核心数据类型。

参考 DeepTutor 的 AgentLoopState / DispatchOutcome / LoopOutcome / AskUserPayload，
大幅简化：只保留 chat 能力所需字段，去掉 label protocol、多工具注册表等。

这些类型是整个 loop 系统的基础，被 context.py / tools.py / loop.py 共同依赖。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ------------------------------------------------------------------
#  工具调用相关
# ------------------------------------------------------------------

@dataclass
class ToolCall:
    """LLM 发出的单个工具调用（对齐 OpenAI tool_call 结构）。"""

    id: str                            # OpenAI tool_call id
    name: str                          # "rag" | "web_search" | "ask_user"
    arguments: dict[str, Any]          # LLM 提供的参数（已解析为 dict）


@dataclass
class SourceItem:
    """工具返回的引用/来源项（rag 上下文片段或 web 搜索结果）。"""

    id: str = ""                       # 引用标识（RAG reference_id 或 web url）
    content: str = ""                  # 内容摘要
    file_path: str = ""                # RAG 文档路径（web 来源为空）
    type: str = "rag"                  # "rag" | "web"


@dataclass
class AskUserQuestion:
    """ask_user 工具向用户提出的单个问题。"""

    id: str                            # 问题标识（q1, q2 ...）
    text: str                          # 问题文本
    options: list[str] | None = None   # 可选选项列表（None=纯文本输入）


@dataclass
class AskUserPayload:
    """ask_user 工具的完整载荷（1-4 个问题 + 简短说明）。"""

    questions: list[AskUserQuestion]
    context: str = ""                  # 简短说明为何提问

    def to_dict(self) -> dict[str, Any]:
        return {
            "questions": [
                {
                    "id": q.id,
                    "text": q.text,
                    "options": q.options,
                }
                for q in self.questions
            ],
            "context": self.context,
        }


@dataclass
class ToolResult:
    """单个工具执行结果。"""

    tool_call_id: str
    name: str
    content: str                                     # 工具返回文本（喂回 LLM）
    sources: list[SourceItem] = field(default_factory=list)
    pause_for_user: AskUserPayload | None = None     # ask_user 专用：触发 loop 暂停
    terminate: bool = False                          # 工具请求终止循环（当前未用）


# ------------------------------------------------------------------
#  分发结果
# ------------------------------------------------------------------

@dataclass
class DispatchOutcome:
    """一轮工具调用分发的汇总结果（对齐 DeepTutor DispatchOutcome）。"""

    tool_messages: list[dict[str, Any]] = field(default_factory=list)  # OpenAI 格式 tool result messages
    sources: list[SourceItem] = field(default_factory=list)            # 本轮新增来源
    pause: bool = False                                                # ask_user 触发暂停
    pause_payload: AskUserPayload | None = None                        # 暂停时的 ask_user 载荷


# ------------------------------------------------------------------
#  Loop 状态与结果
# ------------------------------------------------------------------

class AgentLoopState:
    """可变状态追踪一次 loop 调用（对齐 DeepTutor AgentLoopState）。

    用普通类而非 dataclass，因为需要在 loop 各处原地修改。
    """

    def __init__(self) -> None:
        self.round: int = 0            # 已完成的轮次
        self.tool_steps: int = 0       # 累计工具调用次数
        self.nudged: bool = False      # 是否已注入过空 nudge（避免无限 nudge）
        self.finished: bool = False    # 是否已结束（自然回答或强制结束）
        self.paused: bool = False      # 是否因 ask_user 暂停


@dataclass
class LoopOutcome:
    """一次 loop 运行的最终结果（对齐 DeepTutor LoopOutcome）。"""

    answer: str = ""                                   # 最终回答文本
    sources: list[SourceItem] = field(default_factory=list)
    rounds: int = 0                                    # 实际执行轮次
    completed: bool = False                            # True: LLM 自然给出回答; False: ask_user 暂停或异常
    forced: bool = False                               # True: max_rounds 用尽后强制回答


__all__ = [
    "ToolCall",
    "SourceItem",
    "AskUserQuestion",
    "AskUserPayload",
    "ToolResult",
    "DispatchOutcome",
    "AgentLoopState",
    "LoopOutcome",
]
