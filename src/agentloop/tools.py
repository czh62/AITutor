"""工具定义与分发。

参考 DeepTutor 的 dispatch_tool_calls() + ToolRegistry，简化为 3 个硬编码工具：
- rag：从 LightRAG 检索上下文（query_context，only_need_context=True）
- web_search：DuckDuckGo 搜索
- ask_user：向用户提问并暂停 loop 等待回复

dispatch_tool_calls 负责执行工具、发射 tool_call/tool_result 事件、汇总 DispatchOutcome。
多个工具并行执行（asyncio.gather）；ask_user 不实际执行，仅设置 pause_for_user。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from ..services.lightrag_client import LightRAGClient
from ..services.search_client import SearchClient
from ..services.search_types import SearchResponse
from .bus import StreamBus
from .state import (
    AgentLoopState,
    AskUserPayload,
    AskUserQuestion,
    DispatchOutcome,
    SourceItem,
    ToolCall,
    ToolResult,
)
from .stream import StreamEventType

logger = logging.getLogger("aitutor.agentloop.tools")


# ------------------------------------------------------------------
#  OpenAI function-calling schemas
# ------------------------------------------------------------------

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "rag",
            "description": (
                "从知识库检索与查询相关的上下文片段。当需要专业知识、定义、概念解释、"
                "文档内容或已知事实时调用。每次用最精确的查询词，必要时多次调用不同角度的查询。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "检索查询文本（聚焦于一个具体问题）",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "联网搜索最新信息、实时数据、新闻动态或知识库未覆盖的内容。"
                "当问题涉及时效性信息、最新技术、当前事件时调用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询文本",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": (
                "向用户提问以澄清需求、确认方向或获取偏好。仅当缺少关键信息导致无法合理推进时调用，"
                "且一次性问完所有问题（最多 4 个）；否则基于合理假设继续作答并在回答中说明假设。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {
                                    "type": "string",
                                    "description": "问题标识，如 q1、q2",
                                },
                                "text": {
                                    "type": "string",
                                    "description": "问题文本",
                                },
                                "options": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "可选选项列表（可省略，表示纯文本输入）",
                                },
                            },
                            "required": ["id", "text"],
                        },
                        "minItems": 1,
                        "maxItems": 4,
                        "description": "向用户提出的问题列表（1-4 个）",
                    },
                    "context": {
                        "type": "string",
                        "description": "简短说明为什么要问这些问题",
                    },
                },
                "required": ["questions"],
            },
        },
    },
]


# ------------------------------------------------------------------
#  分发
# ------------------------------------------------------------------

async def dispatch_tool_calls(
    tool_calls: list[ToolCall],
    *,
    bus: StreamBus,
    lightrag: LightRAGClient,
    search: SearchClient | None,
    state: AgentLoopState,
    round: int,
    mode: str = "mix",
) -> DispatchOutcome:
    """执行一轮工具调用，发射事件，返回 DispatchOutcome。

    流程：
    1. 发射每个 tool_call 事件（带 id/name/arguments）
    2. 并行执行非 ask_user 工具；ask_user 特殊处理（设 pause）
    3. 发射 tool_result 事件
    4. 汇总 tool_messages（喂回 LLM）+ sources + pause 状态
    """
    outcome = DispatchOutcome()
    state.tool_steps += len(tool_calls)

    # ask_user 单独拎出（同一轮若 LLM 同时调了 ask_user 和其他工具，
    # 先执行其他工具，再处理 ask_user 暂停）
    normal_calls = [tc for tc in tool_calls if tc.name != "ask_user"]
    ask_calls = [tc for tc in tool_calls if tc.name == "ask_user"]

    # 发射所有 tool_call 事件
    for tc in tool_calls:
        await bus.emit(
            StreamEventType.TOOL_CALL,
            round=round,
            content=tc.name,
            metadata={
                "tool_call_id": tc.id,
                "tool_name": tc.name,
                "arguments": tc.arguments,
                "call_id": f"tool_{tc.id}",
                "call_kind": "tool_call",
                "call_role": "narration",
            },
        )

    # 并行执行普通工具
    results: list[ToolResult] = []
    if normal_calls:
        executed = await asyncio.gather(
            *[
                _execute_single(tc, lightrag=lightrag, search=search, mode=mode)
                for tc in normal_calls
            ],
            return_exceptions=True,
        )
        for tc, res in zip(normal_calls, executed):
            if isinstance(res, Exception):
                logger.error("tool %s failed: %s", tc.name, res)
                results.append(
                    ToolResult(
                        tool_call_id=tc.id,
                        name=tc.name,
                        content=f"工具执行失败：{res}",
                    )
                )
            else:
                results.append(res)

    # 发射普通工具的 tool_result 事件 + 汇总 messages/sources
    for r in results:
        await _emit_tool_result(bus, r, round)
        outcome.tool_messages.append(
            {
                "role": "tool",
                "tool_call_id": r.tool_call_id,
                "name": r.name,
                "content": r.content,
            }
        )
        outcome.sources.extend(r.sources)

    # 处理 ask_user（取第一个；同轮多个 ask_user 只认首个，其余给 stub）
    for i, ac in enumerate(ask_calls):
        if i == 0:
            payload = _build_ask_user_payload(ac)
            if payload is None:
                # 参数非法，给 LLM 错误反馈
                outcome.tool_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": ac.id,
                        "name": "ask_user",
                        "content": "ask_user 参数无效：questions 不能为空。",
                    }
                )
                continue
            outcome.pause = True
            outcome.pause_payload = payload
            # ask_user 的 tool result 内容（暂停期间作为占位，恢复时替换为用户答案）
            placeholder = "[等待用户回复中…]"
            await bus.emit(
                StreamEventType.TOOL_RESULT,
                round=round,
                content="ask_user",
                metadata={
                    "tool_call_id": ac.id,
                    "tool_name": "ask_user",
                    "ask_user": payload.to_dict(),
                    "paused": True,
                    "call_id": f"tool_{ac.id}",
                    "call_kind": "tool_call",
                    "call_role": "narration",
                },
            )
            outcome.tool_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": ac.id,
                    "name": "ask_user",
                    "content": placeholder,
                }
            )
        else:
            # 同轮多余的 ask_user 给 stub
            outcome.tool_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": ac.id,
                    "name": "ask_user",
                    "content": "同轮只能有一个 ask_user 调用。请把所有问题合并到一个 ask_user 的 questions 列表中。",
                }
            )

    return outcome


# ------------------------------------------------------------------
#  单工具执行
# ------------------------------------------------------------------

async def _execute_single(
    tc: ToolCall,
    *,
    lightrag: LightRAGClient,
    search: SearchClient | None,
    mode: str,
) -> ToolResult:
    """执行单个普通工具（rag / web_search）。ask_user 不走这里。"""
    if tc.name == "rag":
        return await _exec_rag(tc, lightrag=lightrag, mode=mode)
    if tc.name == "web_search":
        return await _exec_web_search(tc, search=search)
    # 未知工具
    return ToolResult(
        tool_call_id=tc.id,
        name=tc.name,
        content=f"未知工具：{tc.name}。可用工具：rag、web_search、ask_user。",
    )


async def _exec_rag(
    tc: ToolCall, *, lightrag: LightRAGClient, mode: str
) -> ToolResult:
    """执行 rag：调用 LightRAG query_context 获取上下文片段。"""
    query = str(tc.arguments.get("query", "")).strip()
    query_mode = tc.arguments.get("mode", mode) or mode
    if not query:
        return ToolResult(
            tool_call_id=tc.id,
            name="rag",
            content="rag 工具的 query 参数不能为空。",
        )
    try:
        body = {"query": query, "query_mode": query_mode, "history_turns": 0}
        data = await lightrag.query_context(body)
    except Exception as exc:
        logger.error("rag query_context failed: %s", exc)
        return ToolResult(
            tool_call_id=tc.id,
            name="rag",
            content=f"知识库检索失败：{exc}",
        )

    # data 通常是 LightRAG 的 only_need_context 响应：可能直接是 str 或 {response, references}
    content_text, sources = _extract_rag(data)
    return ToolResult(
        tool_call_id=tc.id,
        name="rag",
        content=content_text or "知识库未检索到相关内容。",
        sources=sources,
    )


async def _exec_web_search(
    tc: ToolCall, *, search: SearchClient | None
) -> ToolResult:
    """执行 web_search：调用 DuckDuckGo。"""
    query = str(tc.arguments.get("query", "")).strip()
    if not query:
        return ToolResult(
            tool_call_id=tc.id,
            name="web_search",
            content="web_search 工具的 query 参数不能为空。",
        )
    if search is None:
        return ToolResult(
            tool_call_id=tc.id,
            name="web_search",
            content="联网搜索未启用（search_enabled=False）。",
        )
    try:
        resp: SearchResponse = await search.search(query)
    except Exception as exc:
        logger.error("web_search failed: %s", exc)
        return ToolResult(
            tool_call_id=tc.id,
            name="web_search",
            content=f"联网搜索失败：{exc}",
        )

    content_parts: list[str] = []
    sources: list[SourceItem] = []
    for i, sr in enumerate(resp.search_results, 1):
        content_parts.append(f"[{i}] {sr.title}\nURL: {sr.url}\n{sr.snippet}")
        sources.append(
            SourceItem(
                id=sr.url,
                content=sr.snippet,
                file_path="",
                type="web",
            )
        )
    content = "\n\n".join(content_parts) if content_parts else "未搜索到相关结果。"
    return ToolResult(
        tool_call_id=tc.id,
        name="web_search",
        content=content,
        sources=sources,
    )


# ------------------------------------------------------------------
#  ask_user 载荷构建
# ------------------------------------------------------------------

def _build_ask_user_payload(tc: ToolCall) -> AskUserPayload | None:
    """从 ToolCall 参数构建 AskUserPayload，非法返回 None。"""
    raw_questions = tc.arguments.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        return None
    questions: list[AskUserQuestion] = []
    for idx, rq in enumerate(raw_questions[:4]):
        if not isinstance(rq, dict):
            continue
        qid = str(rq.get("id") or f"q{idx + 1}")
        text = str(rq.get("text") or rq.get("question") or "").strip()
        if not text:
            continue
        opts = rq.get("options")
        if opts is not None:
            opts = [str(o) for o in opts] if isinstance(opts, list) else None
        questions.append(AskUserQuestion(id=qid, text=text, options=opts))
    if not questions:
        return None
    context = str(tc.arguments.get("context") or "")
    return AskUserPayload(questions=questions, context=context)


# ------------------------------------------------------------------
#  辅助
# ------------------------------------------------------------------

def _extract_rag(data: Any) -> tuple[str, list[SourceItem]]:
    """从 LightRAG query_context 响应提取正文文本与来源。

    LightRAG only_need_context 响应形态：{response: str, references: [...]} 或纯 str。
    references 项含 reference_id / file_path / content。
    """
    content = ""
    sources: list[SourceItem] = []
    if isinstance(data, str):
        content = data
    elif isinstance(data, dict):
        content = str(data.get("response") or data.get("content") or "")
        refs = data.get("references") or []
        if isinstance(refs, list):
            for ref in refs:
                if not isinstance(ref, dict):
                    continue
                rid = str(ref.get("reference_id") or ref.get("id") or "")
                fpath = str(ref.get("file_path") or "")
                cparts = ref.get("content")
                ctext = ""
                if isinstance(cparts, list):
                    ctext = " ".join(str(c) for c in cparts)
                elif isinstance(cparts, str):
                    ctext = cparts
                sources.append(
                    SourceItem(
                        id=rid or fpath,
                        content=ctext,
                        file_path=fpath,
                        type="rag",
                    )
                )
    return content, sources


async def _emit_tool_result(bus: StreamBus, r: ToolResult, round: int) -> None:
    """发射普通工具的 tool_result 事件。"""
    # 截断超长结果用于事件展示（完整内容仍通过 tool_message 喂回 LLM）
    preview = r.content if len(r.content) <= 500 else r.content[:500] + "…"
    await bus.emit(
        StreamEventType.TOOL_RESULT,
        round=round,
        content=preview,
        metadata={
            "tool_call_id": r.tool_call_id,
            "tool_name": r.name,
            "full_content": r.content,
            "sources_count": len(r.sources),
            "call_id": f"tool_{r.tool_call_id}",
            "call_kind": "tool_call",
            "call_role": "narration",
        },
    )


__all__ = ["TOOL_DEFINITIONS", "dispatch_tool_calls"]
