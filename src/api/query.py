"""知识问答路由 — AgentLoop tool-calling 循环。

- POST /query          非流式查询（内部运行 AgentLoop，收集 NDJSON 后返回 JSON）。
- POST /query/stream    NDJSON 流式查询，逐行推送 AgentLoop 的 StreamEvent。
- POST /query/resume   ask_user 恢复：用户回复后继续暂停的 loop。

StreamEvent 类型详见 src/agentloop/stream.py 的 StreamEventType：
stage_start/stage_end/thinking/observation/progress/content/tool_call/
tool_result/references/search/sources/result/error/wait_for_input/
session/session_meta/done
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..agentloop.loop import AgentLoop
from ..schemas.query import QueryRequest, QueryResponse, LoopTrace, LoopStep, ReferenceItem, ResumeRequest
from ..services.lightrag_client import LightRAGClient
from ..services.llm_client import LLMClient
from ..services.search_client import SearchClient
from ..core.logging import get_logger

logger = get_logger("aitutor.query")

router = APIRouter(tags=["query"])


def get_lightrag_client(request: Request) -> LightRAGClient:
    """从 app.state 获取 LightRAGClient。"""
    return request.app.state.lightrag_client


def get_llm_client(request: Request) -> LLMClient:
    """从 app.state 获取 LLMClient。"""
    return request.app.state.llm_client


def get_search_client(request: Request) -> SearchClient | None:
    """从 app.state 获取 SearchClient（可能为 None）。"""
    return getattr(request.app.state, 'search_client', None)


def get_memory_manager(request: Request) -> Any:
    """从 app.state 获取 MemoryManager（可能为 None）。"""
    return getattr(request.app.state, 'memory_manager', None)


# ------------------------------------------------------------------
#  1. 非流式查询（AgentLoop 内部运行，返回完整结果）
# ------------------------------------------------------------------

@router.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
    memory: Any = Depends(get_memory_manager),
):
    """非流式查询：内部运行 AgentLoop，收集 NDJSON 后返回完整 response + references。"""
    loop = AgentLoop(
        llm_client=llm, lightrag_client=lightrag, search_client=search,
        memory_manager=memory,
    )
    response_text = ""
    references: list[dict[str, Any]] = []
    rounds_done = 0
    completed = False

    async for line in loop.run_stream(
        query=request.query, mode=request.mode,
        force_web_search=request.force_web_search,
        session_id=request.session_id,
    ):
        try:
            event = json.loads(line.strip())
        except json.JSONDecodeError:
            continue

        event_type = event.get("type", "")
        content = event.get("content", "")
        metadata = event.get("metadata", {})

        if event_type == "content":
            # 跳过 narration 阶段的 streaming 块，只收 finish 角色的内容
            if metadata.get("call_role") != "narration" or not metadata.get("streaming"):
                response_text += content
            else:
                response_text += content  # tool-calling loop 中正文即最终回答
        elif event_type in ("references", "sources"):
            refs = metadata.get("references") or metadata.get("sources") or []
            for ref in refs:
                rid = ref.get("reference_id") or ref.get("id")
                if not any((r.get("reference_id") or r.get("id")) == rid for r in references):
                    references.append(ref)
        elif event_type == "result":
            rounds_done = metadata.get("rounds", 0)
            completed = metadata.get("completed", False)

    # 去掉重复 reference_id 的标准字段缺失项
    norm_refs = [_normalize_reference(r) for r in references]

    loop_trace = LoopTrace(
        rounds=rounds_done,
        steps=[],  # 新 loop 无 per-round LoopStep 概念，留空兼容旧前端
        completed=completed,
        engine="agent_loop",
    )

    return QueryResponse(
        response=response_text,
        references=[ReferenceItem(**r) for r in norm_refs if r],
        loop_trace=loop_trace,
    )


# ------------------------------------------------------------------
#  2. 流式查询（NDJSON — AgentLoop events 逐行推送）
# ------------------------------------------------------------------

@router.post("/query/stream")
async def query_stream(
    request: QueryRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
    memory: Any = Depends(get_memory_manager),
):
    """流式查询：AgentLoop 运行并逐行推送 NDJSON StreamEvent。"""
    loop = AgentLoop(
        llm_client=llm, lightrag_client=lightrag, search_client=search,
        memory_manager=memory,
    )
    return StreamingResponse(
        loop.run_stream(
            query=request.query, mode=request.mode,
            force_web_search=request.force_web_search,
            session_id=request.session_id,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ------------------------------------------------------------------
#  3. ask_user 恢复（用户回复后继续暂停的 loop）
# ------------------------------------------------------------------

@router.post("/query/resume")
async def query_resume(
    request: ResumeRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
    memory: Any = Depends(get_memory_manager),
):
    """ask_user 恢复：从 DB 加载暂停态 context，注入用户答案后继续 loop。"""
    loop = AgentLoop(
        llm_client=llm, lightrag_client=lightrag, search_client=search,
        memory_manager=memory,
    )
    return StreamingResponse(
        loop.resume_stream(
            session_id=request.session_id, answers=request.answers,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _normalize_reference(ref: dict[str, Any]) -> dict[str, Any] | None:
    """把 sources/references 项归一化为 ReferenceItem 兼容字段。"""
    if not isinstance(ref, dict):
        return None
    rid = ref.get("reference_id") or ref.get("id")
    fpath = ref.get("file_path")
    content = ref.get("content")
    if content is None:
        content = [ref.get("snippet", "")] if ref.get("snippet") else None
    elif isinstance(content, str):
        content = [content]
    return {"reference_id": rid, "file_path": fpath, "content": content}
