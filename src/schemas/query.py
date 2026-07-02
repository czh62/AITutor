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
    """

    model_config = ConfigDict(extra="ignore")

    query: str
    mode: Literal["naive", "local", "global", "hybrid", "mix", "bypass"] = "mix"
    stream: bool = True
    conversation_history: Optional[List[Dict[str, Any]]] = None


class ReferenceItem(BaseModel):
    """RAG 引用来源项（对齐 LightRAG ReferenceItem）。"""

    model_config = ConfigDict(extra="ignore")

    reference_id: Optional[str] = None
    file_path: Optional[str] = None
    content: Optional[List[Any]] = None


class QueryResponse(BaseModel):
    """非流式查询响应（对齐 LightRAG POST /query 返回）。"""

    model_config = ConfigDict(extra="ignore")

    response: str = ""
    references: Optional[List[ReferenceItem]] = None
