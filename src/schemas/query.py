"""知识问答相关 Pydantic schema。

对齐 LightRAG QueryRequest / QueryResponse。前端只发 query/mode/stream 三字段，
其余参数（top_k、chunk_top_k、max_*_tokens、enable_rerank 等）不定义，由 LightRAG
服务端默认值生效。所有 response model 用 ConfigDict(extra="ignore")，容忍 LightRAG
返回未知字段。
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict


class QueryRequest(BaseModel):
    """查询请求体（对齐 LightRAG POST /query 与 /query/stream）。

    mode 取值：naive / local / global / hybrid / mix / bypass，默认 mix。
    conversation_history 预留（当前遵循 history_turns=0，不传多轮上下文）。
    force_web_search 用于用户手动勾选联网搜索时传入。
    session_id 用于 ask_user 暂停恢复的会话标识（可选）。
    """

    model_config = ConfigDict(extra="ignore")

    query: str
    mode: Literal["naive", "local", "global", "hybrid", "mix", "bypass"] = "mix"
    stream: bool = True
    force_web_search: bool = False
    session_id: Optional[str] = None
    conversation_history: Optional[List[Dict[str, Any]]] = None


class AskUserQuestionSchema(BaseModel):
    """ask_user 单个问题。"""

    model_config = ConfigDict(extra="ignore")

    id: str
    text: str
    options: Optional[List[str]] = None


class AskUserPayloadSchema(BaseModel):
    """ask_user 完整载荷。"""

    model_config = ConfigDict(extra="ignore")

    questions: List[AskUserQuestionSchema]
    context: str = ""


class ResumeRequest(BaseModel):
    """ask_user 恢复请求体。answers 是 question_id -> 用户回答。"""

    model_config = ConfigDict(extra="ignore")

    session_id: str
    answers: Dict[str, str]


class ReferenceItem(BaseModel):
    """RAG 引用来源项（对齐 LightRAG ReferenceItem）。"""

    model_config = ConfigDict(extra="ignore")

    reference_id: Optional[str] = None
    file_path: Optional[str] = None
    content: Optional[List[Any]] = None


class QueryResponse(BaseModel):
    """非流式查询响应（对齐 LightRAG POST /query 返回）。

    loop_trace 字段包含 AgentLoop 思维链追踪（非流式端点收集后返回）。
    """

    model_config = ConfigDict(extra="ignore")

    response: str = ""
    references: Optional[List[ReferenceItem]] = None
    loop_trace: Optional[LoopTrace] = None


# ------------------------------------------------------------------
#  AgentLoop 思维链追踪
# ------------------------------------------------------------------

class LoopStep(BaseModel):
    """AgentLoop 单轮步骤。"""

    model_config = ConfigDict(extra="ignore")

    round: int
    query: str                    # 本轮使用的查询（可能是改写后的）
    original_query: str           # 原始用户查询
    thinking: str                 # 评估思考内容
    quality: str                  # "sufficient" / "insufficient" / "forced" / "short_query"
    rewritten_query: Optional[str] = None  # 如果 insufficient，建议的改写查询
    context_summary: str          # 本轮检索到的上下文摘要
    need_web_search: Optional[bool] = None  # LLM 评估是否需要联网搜索
    web_search_query: Optional[str] = None  # 联网搜索使用的查询
    web_search_results: Optional[List[Dict[str, str]]] = None  # 搜索结果摘要列表


class LoopTrace(BaseModel):
    """AgentLoop 思维链追踪（每轮的查询改写和评估结果）。"""

    model_config = ConfigDict(extra="ignore")

    rounds: int
    steps: List[LoopStep] = []
    completed: bool = False
    engine: str = "agent_loop"
