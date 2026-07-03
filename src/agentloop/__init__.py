"""AgentLoop 模块 — tool-calling 循环 + 思维链流式输出。

完整移植 DeepTutor Chat AgentLoop 架构（简化版）：
- loop.py：tool-calling 主循环（LLM 自主调 rag/web_search/ask_user 或直接回答）
- bus.py：StreamBus 单消费者 NDJSON 事件总线
- context.py：UnifiedContext 对话上下文
- state.py：核心数据类型（ToolCall/DispatchOutcome/LoopOutcome/AskUserPayload）
- tools.py：3 个工具定义 + dispatch_tool_calls
- think_filter.py：InlineThinkFilter 流式 <think> 标签分离
- prompt_assembler.py：ChatPromptAssembler 块式系统提示词
- memory.py：MemoryManager 两层记忆（L1 追踪 + L2 摘要）
- stream.py：StreamEventType 事件类型
"""

from .bus import StreamBus
from .context import UnifiedContext
from .loop import AgentLoop
from .prompt_assembler import ChatPromptAssembler
from .state import (
    AgentLoopState,
    AskUserPayload,
    AskUserQuestion,
    DispatchOutcome,
    LoopOutcome,
    SourceItem,
    ToolCall,
    ToolResult,
)
from .stream import StreamEvent, StreamEventType
from .think_filter import InlineThinkFilter

__all__ = [
    "AgentLoop",
    "StreamBus",
    "UnifiedContext",
    "AgentLoopState",
    "LoopOutcome",
    "DispatchOutcome",
    "ToolCall",
    "ToolResult",
    "SourceItem",
    "AskUserPayload",
    "AskUserQuestion",
    "InlineThinkFilter",
    "ChatPromptAssembler",
    "StreamEventType",
    "StreamEvent",
]
