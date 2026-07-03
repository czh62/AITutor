"""知识问答路由 — AgentLoop 查询改写循环 + 联网搜索。

- POST /query        非流式查询（内部运行 AgentLoop，返回 JSON {response, references}）。
- POST /query/stream  NDJSON 流式查询，每行是 AgentLoop 的 StreamEvent JSON：
    {"type":"stage_start",...} / {"type":"thinking",...} / {"type":"observation",...}
    / {"type":"query_rewrite",...} / {"type":"progress",...}
    / {"type":"content",...} / {"type":"references",...} / {"type":"search",...}
    / {"type":"result",...} / {"type":"done"}
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..agentloop.loop import AgentLoop
from ..schemas.query import QueryRequest, QueryResponse, LoopTrace, LoopStep, ReferenceItem
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


# ------------------------------------------------------------------
#  1. 非流式查询（AgentLoop 内部运行，返回完整结果）
# ------------------------------------------------------------------

@router.post("/query", response_model=QueryResponse)
async def query(
    request: QueryRequest,
    lightrag: LightRAGClient = Depends(get_lightrag_client),
    llm: LLMClient = Depends(get_llm_client),
    search: SearchClient | None = Depends(get_search_client),
):
    """非流式查询：内部运行 AgentLoop，返回完整 response + references。"""
    loop = AgentLoop(llm_client=llm, lightrag_client=lightrag, search_client=search)
    response_text = ""
    references: list[dict[str, Any]] = []
    loop_steps: list[LoopStep] = []
    current_step: dict[str, Any] = {}
    rounds_done = 0
    completed = False

    async for line in loop.run_stream(
        query=request.query, mode=request.mode,
        force_web_search=request.force_web_search,
    ):
        try:
            event = json.loads(line.strip())
        except json.JSONDecodeError:
            continue

        event_type = event.get("type", "")
        round_num = event.get("round", 0)
        content = event.get("content", "")
        metadata = event.get("metadata", {})

        if event_type == "content":
            response_text += content
        elif event_type == "references":
            refs = metadata.get("references", [])
            for ref in refs:
                if not any(r.get("reference_id") == ref.get("reference_id") for r in references):
                    references.append(ref)
        elif event_type == "observation":
            if round_num >= 0:
                current_step = {
                    "round": round_num,
                    "query": metadata.get("query", request.query),
                    "original_query": request.query,
                    "context_summary": content,
                }
        elif event_type == "thinking":
            if current_step:
                current_step["thinking"] = content
                current_step["quality"] = metadata.get("quality", "")
                if metadata.get("need_web_search"):
                    current_step["need_web_search"] = metadata.get("need_web_search")
        elif event_type == "search":
            # 联网搜索事件
            search_meta = metadata
            if current_step and search_meta.get("status") == "complete":
                current_step["web_search_query"] = search_meta.get("query", "")
                current_step["web_search_results"] = search_meta.get("results", [])
        elif event_type == "query_rewrite":
            if current_step:
                current_step["rewritten_query"] = content
        elif event_type == "progress":
            quality = metadata.get("quality", "")
            if current_step and quality:
                current_step["quality"] = quality
                current_step["rewritten_query"] = metadata.get("rewritten_query")
                if metadata.get("need_web_search"):
                    current_step["need_web_search"] = metadata.get("need_web_search")
        elif event_type == "result":
            rounds_done = metadata.get("rounds", 0)
            completed = metadata.get("completed", False)
            # 保存当前步骤（如果有）
            if current_step and current_step.get("thinking"):
                loop_steps.append(LoopStep(**current_step))

    # 如果还有未保存的步骤
    if current_step and current_step.get("thinking") and current_step not in [s.model_dump() for s in loop_steps]:
        loop_steps.append(LoopStep(**current_step))

    # 构建 LoopTrace
    loop_trace = LoopTrace(
        rounds=rounds_done,
        steps=loop_steps,
        completed=completed,
        engine="agent_loop",
    )

    return QueryResponse(
        response=response_text,
        references=[ReferenceItem(**r) for r in references],
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
):
    """流式查询：AgentLoop 运行并逐行推送 NDJSON StreamEvent。"""
    loop = AgentLoop(llm_client=llm, lightrag_client=lightrag, search_client=search)
    return StreamingResponse(
        loop.run_stream(
            query=request.query, mode=request.mode,
            force_web_search=request.force_web_search,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
