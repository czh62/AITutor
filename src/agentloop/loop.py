"""AgentLoop — tool-calling 循环核心。

完整移植 DeepTutor 的 AgentLoop._run_loop()（chat 能力版），机制：
- 每轮只有一个 LLM call（带 tool schemas）
- LLM 返回 tool_calls → 执行工具、追加结果、继续下一轮（narration）
- LLM 不返回 tool_calls 且有文本 → 该文本即最终回答（finish）
- LLM 不返回 tool_calls 且无文本 → 注入 nudge 继续下一轮
- max_rounds 用尽仍只有 tool_calls → forced_finish（一次不带 tool 的 LLM call）
- ask_user 触发 → 保存 context 到 DB、发射 wait_for_input、暂停 loop；resume_stream 恢复

与旧版（retrieve→evaluate→rewrite→answer 两阶段）的本质区别：LLM 自主通过 tool 调用
决定检索策略，不再有单独的「评估」和「回答」LLM call。

通过 async generator yield NDJSON 行，供 StreamingResponse 直接消费。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, AsyncIterator

from ..core.config import get_settings
from ..services.lightrag_client import LightRAGClient
from ..services.llm_client import LLMClient, LLMStreamChunk
from ..services.search_client import SearchClient
from .bus import StreamBus
from .context import UnifiedContext
from .prompt_assembler import ChatPromptAssembler
from .state import (
    AgentLoopState,
    AskUserPayload,
    LoopOutcome,
    SourceItem,
    ToolCall,
)
from .stream import StreamEventType
from .think_filter import InlineThinkFilter
from .tools import TOOL_DEFINITIONS, dispatch_tool_calls

logger = logging.getLogger("aitutor.agentloop.loop")

# 短查询阈值：低于此长度跳过 RAG，直接 LLM 作答（避免 LightRAG 对极短输入 422）
_SHORT_QUERY_THRESHOLD = 3


class AgentLoop:
    """Tool-calling agent loop（chat 能力）。"""

    def __init__(
        self,
        *,
        llm_client: LLMClient,
        lightrag_client: LightRAGClient,
        search_client: SearchClient | None,
        memory_manager: Any | None = None,
        max_rounds: int | None = None,
    ) -> None:
        self._llm = llm_client
        self._lightrag = lightrag_client
        self._search = search_client
        self._memory = memory_manager
        settings = get_settings()
        self._max_rounds = max_rounds if max_rounds is not None else settings.agent_loop_max_rounds
        self._temperature = settings.agent_loop_temperature
        self._max_tokens = settings.agent_loop_max_tokens

    # ------------------------------------------------------------------
    #  入口：新查询
    # ------------------------------------------------------------------

    async def run_stream(
        self,
        query: str,
        *,
        mode: str = "mix",
        force_web_search: bool = False,
        session_id: str | None = None,
    ) -> AsyncIterator[str]:
        """主入口：创建 bus/state/context → 运行 loop → 流式 yield NDJSON。

        关键改动：loop + finalize 在后台 asyncio.Task 中运行（并发往 bus emit 事件），
        同时前台 stream_lines() 并行消费 queue 并逐行 yield 给 StreamingResponse。
        这让前端在 loop 运行过程中实时收到每个事件，而不是攒完再发。
        """
        bus = StreamBus()
        sid = session_id or f"sess_{uuid.uuid4().hex[:16]}"

        self._ensure_session(sid)
        await bus.emit(
            StreamEventType.SESSION,
            metadata={"session_id": sid},
        )

        # 短查询快路径：直接 LLM 作答，不走 tool-calling
        if len(query.strip()) < _SHORT_QUERY_THRESHOLD:
            task = asyncio.create_task(
                self._run_short_query_inner(bus, query, sid, force_web_search)
            )
            async for line in bus.stream_lines():
                yield line
            try:
                await task
            except Exception:
                pass
            return

        # 组装 system prompt（含记忆块）
        memory_context = await self._get_memory_context(sid)
        system_prompt = ChatPromptAssembler.assemble(
            max_rounds=self._max_rounds,
            memory_context=memory_context,
            force_web_search=force_web_search,
        )

        # 记录用户消息到 L1 追踪
        self._trace(sid, {"kind": "user_message", "content": query})

        ctx = UnifiedContext(
            system_prompt=system_prompt,
            session_id=sid,
            original_query=query,
            mode=mode,
        )

        await bus.emit(
            StreamEventType.STAGE_START,
            metadata={
                "original_query": query,
                "mode": mode,
                "max_rounds": self._max_rounds,
                "call_id": "loop_start",
                "call_kind": "agent_loop",
            },
        )

        # 关键：把 loop + finalize 合为一个后台 task
        async def _run_and_finalize() -> None:
            try:
                outcome = await self._run_loop(ctx, bus)
                await self._finalize(bus, ctx, outcome)
            except Exception as exc:
                logger.error("loop task failed: %s", exc)
                await bus.emit_error(f"内部错误: {exc}")
                await bus.finish()

        loop_task = asyncio.create_task(_run_and_finalize())

        # 前台：边消费 bus queue 边 yield（loop_task 在后台并发 emit）
        async for line in bus.stream_lines():
            yield line

        # 确保 task 完成（防异常泄露）
        try:
            await loop_task
        except Exception:
            pass

    # ------------------------------------------------------------------
    #  入口：ask_user 恢复
    # ------------------------------------------------------------------

    async def resume_stream(
        self,
        session_id: str,
        answers: dict[str, str],
    ) -> AsyncIterator[str]:
        """ask_user 暂停恢复：从 DB 加载 context → 替换 tool message → 继续 loop。

        同 run_stream，loop + finalize 在后台 task 运行，前台并行消费 stream_lines。
        """
        bus = StreamBus()

        paused = self._load_paused(session_id)
        if paused is None:
            await bus.emit_error("没有可恢复的暂停会话（可能已超时或不存在）")
            await bus.finish()
            async for line in bus.stream_lines():
                yield line
            return

        snapshot, paused_round = paused

        memory_context = await self._get_memory_context(session_id)
        system_prompt = ChatPromptAssembler.assemble(
            max_rounds=self._max_rounds,
            memory_context=memory_context,
            force_web_search=False,
        )
        ctx = UnifiedContext.from_snapshot(snapshot, system_prompt)

        self._substitute_user_reply(ctx, answers)
        self._clear_paused(session_id)

        await bus.emit(
            StreamEventType.SESSION,
            metadata={"session_id": session_id, "resumed": True},
        )
        await bus.emit(
            StreamEventType.PROGRESS,
            round=paused_round,
            content="已收到用户回复，继续处理",
            metadata={
                "call_id": "user_reply",
                "call_kind": "agent_loop",
                "call_role": "narration",
                "ask_user_resolved": True,
            },
        )

        state = AgentLoopState()
        state.round = paused_round

        # 关键：把 continue_loop + finalize 合为一个后台 task
        async def _resume_and_finalize() -> None:
            try:
                outcome = await self._continue_loop(ctx, state, bus, start_round=paused_round)
                await self._finalize(bus, ctx, outcome)
            except Exception as exc:
                logger.error("resume task failed: %s", exc)
                await bus.emit_error(f"恢复失败: {exc}")
                await bus.finish()

        loop_task = asyncio.create_task(_resume_and_finalize())

        # 前台：边消费 bus queue 边 yield
        async for line in bus.stream_lines():
            yield line

        try:
            await loop_task
        except Exception:
            pass

    # ------------------------------------------------------------------
    #  核心：tool-calling 循环
    # ------------------------------------------------------------------

    async def _run_loop(
        self,
        ctx: UnifiedContext,
        bus: StreamBus,
    ) -> LoopOutcome:
        state = AgentLoopState()
        return await self._continue_loop(ctx, state, bus, start_round=0)

    async def _continue_loop(
        self,
        ctx: UnifiedContext,
        state: AgentLoopState,
        bus: StreamBus,
        *,
        start_round: int,
    ) -> LoopOutcome:
        """从 start_round 继续运行循环。被 _run_loop 和 resume_stream 共用。"""
        nudged_empty = False

        for round_idx in range(start_round, self._max_rounds):
            state.round = round_idx + 1

            # 一次流式 LLM 调用（带 tool schemas）
            text_parts, tool_calls = await self._call_llm_streaming(
                ctx, bus, round=state.round
            )
            full_text = "".join(text_parts).strip()

            # 无 tool_calls：检查是否 finish
            if not tool_calls:
                if not full_text and not nudged_empty:
                    # 空回答：注入 nudge 继续
                    nudged_empty = True
                    ctx.add_assistant(full_text)
                    ctx.add_nudge()
                    await bus.emit(
                        StreamEventType.PROGRESS,
                        round=state.round,
                        content="本轮无输出，已请求模型继续",
                        metadata={
                            "call_id": f"round_{state.round}",
                            "call_kind": "agent_loop_round",
                            "call_role": "narration",
                            "quality": "empty_nudge",
                        },
                    )
                    continue

                # 有文本（或已 nudge 过）：finish
                ctx.add_assistant(full_text)
                state.finished = True
                self._trace(
                    ctx.session_id, {"kind": "answer", "content": full_text}
                )
                await bus.emit(
                    StreamEventType.PROGRESS,
                    round=state.round,
                    metadata={
                        "call_id": f"round_{state.round}",
                        "call_kind": "agent_loop_round",
                        "call_role": "finish",
                        "quality": "sufficient",
                    },
                )
                return LoopOutcome(
                    answer=full_text,
                    sources=list(ctx.sources),
                    rounds=state.round,
                    completed=True,
                    forced=False,
                )

            # 有 tool_calls：narration，执行工具
            ctx.add_assistant(full_text, tool_calls=tool_calls)
            outcome = await dispatch_tool_calls(
                tool_calls,
                bus=bus,
                lightrag=self._lightrag,
                search=self._search,
                state=state,
                round=state.round,
                mode=ctx.mode,
            )
            for tm in outcome.tool_messages:
                ctx.add_tool_result(tm["tool_call_id"], tm["name"], tm["content"])
            ctx.extend_sources(outcome.sources)

            for tc in tool_calls:
                self._trace(
                    ctx.session_id,
                    {
                        "kind": "tool_call",
                        "name": tc.name,
                        "summary": _summarize_tool_args(tc),
                    },
                )

            await bus.emit(
                StreamEventType.PROGRESS,
                round=state.round,
                metadata={
                    "call_id": f"round_{state.round}",
                    "call_kind": "agent_loop_round",
                    "call_role": "narration",
                    "quality": "narration",
                    "tools": [tc.name for tc in tool_calls],
                },
            )

            # ask_user 暂停
            if outcome.pause and outcome.pause_payload is not None:
                state.paused = True
                await self._pause_for_user(
                    ctx, bus, outcome.pause_payload, round=state.round
                )
                return LoopOutcome(
                    answer="",
                    sources=list(ctx.sources),
                    rounds=state.round,
                    completed=False,
                    forced=False,
                )

        # max_rounds 用尽：forced finish
        return await self._forced_finish(ctx, bus, state)

    async def _forced_finish(
        self,
        ctx: UnifiedContext,
        bus: StreamBus,
        state: AgentLoopState,
    ) -> LoopOutcome:
        """预算耗尽：注入 force nudge，再调一次不带 tool 的 LLM。"""
        await bus.emit(
            StreamEventType.PROGRESS,
            round=state.round,
            content="已达最大轮次，强制作答",
            metadata={
                "call_id": f"round_{state.round}",
                "call_kind": "agent_loop_round",
                "call_role": "narration",
                "quality": "forced",
            },
        )
        ctx.add_nudge(force=True)
        text_parts, _ = await self._call_llm_streaming(
            ctx, bus, round=state.round + 1, with_tools=False
        )
        full_text = "".join(text_parts).strip()
        ctx.add_assistant(full_text)
        state.finished = True
        self._trace(ctx.session_id, {"kind": "answer", "content": full_text})
        await bus.emit(
            StreamEventType.PROGRESS,
            round=state.round + 1,
            metadata={
                "call_id": f"round_{state.round}",
                "call_kind": "agent_loop_round",
                "call_role": "finish",
                "quality": "forced",
            },
        )
        return LoopOutcome(
            answer=full_text,
            sources=list(ctx.sources),
            rounds=state.round + 1,
            completed=True,
            forced=True,
        )

    # ------------------------------------------------------------------
    #  LLM 流式调用（带 InlineThinkFilter）
    # ------------------------------------------------------------------

    async def _call_llm_streaming(
        self,
        ctx: UnifiedContext,
        bus: StreamBus,
        *,
        round: int,
        with_tools: bool = True,
    ) -> tuple[list[str], list[ToolCall]]:
        """一次流式 LLM 调用，发射 thinking/content 事件，返回 (text_parts, tool_calls)。"""
        think_filter = InlineThinkFilter()
        text_parts: list[str] = []
        tool_acc: dict[int, dict[str, Any]] = {}

        tools = TOOL_DEFINITIONS if with_tools else None

        await bus.emit(
            StreamEventType.PROGRESS,
            round=round,
            metadata={
                "call_state": "running",
                "call_id": f"round_{round}",
                "call_kind": "agent_loop_round",
            },
        )

        async for chunk in self._llm.stream_with_tools(
            ctx.system_prompt,
            ctx.messages,
            tools=tools,
            temperature=self._temperature,
            max_tokens=self._max_tokens,
        ):
            chunk: LLMStreamChunk
            if chunk.type == "reasoning":
                await bus.emit(
                    StreamEventType.THINKING,
                    round=round,
                    content=chunk.content,
                    metadata={
                        "call_id": f"round_{round}",
                        "call_kind": "agent_loop_round",
                        "call_role": "thought",
                    },
                )
            elif chunk.type == "content":
                for kind, text in think_filter.feed(chunk.content):
                    if kind == "thinking":
                        await bus.emit(
                            StreamEventType.THINKING,
                            round=round,
                            content=text,
                            metadata={
                                "call_id": f"round_{round}",
                                "call_kind": "agent_loop_round",
                                "call_role": "thought",
                            },
                        )
                    else:
                        text_parts.append(text)
                        await bus.emit(
                            StreamEventType.CONTENT,
                            round=round,
                            content=text,
                            metadata={
                                "call_id": f"round_{round}",
                                "call_kind": "agent_loop_round",
                                "call_role": "narration",
                                "streaming": True,
                            },
                        )
            elif chunk.type == "tool_call_delta" and chunk.tool_call_delta:
                _accumulate_tool_delta(tool_acc, chunk.tool_call_delta)

        for kind, text in think_filter.flush():
            if kind == "thinking":
                await bus.emit(
                    StreamEventType.THINKING,
                    round=round,
                    content=text,
                    metadata={
                        "call_id": f"round_{round}",
                        "call_kind": "agent_loop_round",
                        "call_role": "thought",
                    },
                )
            else:
                text_parts.append(text)
                await bus.emit(
                    StreamEventType.CONTENT,
                    round=round,
                    content=text,
                    metadata={
                        "call_id": f"round_{round}",
                        "call_kind": "agent_loop_round",
                        "call_role": "narration",
                        "streaming": True,
                    },
                )

        tool_calls = _materialize_tool_calls(tool_acc)

        await bus.emit(
            StreamEventType.PROGRESS,
            round=round,
            metadata={
                "call_state": "complete",
                "call_id": f"round_{round}",
                "call_kind": "agent_loop_round",
                "call_role": "finish" if not tool_calls else "narration",
                "has_tool_calls": bool(tool_calls),
                "tool_names": [tc.name for tc in tool_calls],
            },
        )

        return text_parts, tool_calls

    # ------------------------------------------------------------------
    #  ask_user 暂停
    # ------------------------------------------------------------------

    async def _pause_for_user(
        self,
        ctx: UnifiedContext,
        bus: StreamBus,
        payload: AskUserPayload,
        *,
        round: int,
    ) -> None:
        """发射 wait_for_input 事件，保存 context 快照到 DB，结束本次流。"""
        self._save_paused(ctx, round)
        await bus.emit(
            StreamEventType.WAIT_FOR_INPUT,
            round=round,
            content=payload.context or "需要更多信息",
            metadata={
                "ask_user": payload.to_dict(),
                "call_id": f"ask_user_{round}",
                "call_kind": "tool_call",
                "call_role": "narration",
            },
        )

    def _substitute_user_reply(
        self, ctx: UnifiedContext, answers: dict[str, str]
    ) -> None:
        """恢复时把 ask_user 的占位 tool message 替换为用户答案 directive。"""
        directive_lines = ["[ask_user 已解决，用户回复如下，请据此继续完成原始请求：]"]
        for qid, ans in answers.items():
            directive_lines.append(f"- {qid}: {ans}")
        directive_lines.append("[请基于以上回复继续，不要只回执确认。]")
        directive = "\n".join(directive_lines)

        for msg in reversed(ctx.messages):
            if msg.get("role") == "tool" and msg.get("name") == "ask_user":
                msg["content"] = directive
                break

    # ------------------------------------------------------------------
    #  短查询快路径
    # ------------------------------------------------------------------

    async def _run_short_query_inner(
        self,
        bus: StreamBus,
        query: str,
        session_id: str,
        force_web_search: bool,
    ) -> None:
        """短查询（<3 字符）内部逻辑：emit SESSION+PROGRESS+content，然后 finish。
        不消费 stream_lines（由 run_stream 前台消费）。
        """
        self._trace(session_id, {"kind": "user_message", "content": query})
        await bus.emit(
            StreamEventType.PROGRESS,
            metadata={
                "call_id": "short_query",
                "call_kind": "agent_loop",
                "call_role": "finish",
                "quality": "short_query",
            },
        )

        system_prompt = ChatPromptAssembler.assemble(max_rounds=self._max_rounds)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query},
        ]
        async for chunk in self._llm.stream_with_tools(
            system_prompt, messages[1:], tools=None,
            temperature=self._temperature, max_tokens=self._max_tokens,
        ):
            if chunk.type == "content":
                await bus.emit(StreamEventType.CONTENT, content=chunk.content, metadata={
                    "call_id": "short_query", "call_kind": "agent_loop", "call_role": "finish",
                })

        await bus.finish(result_metadata={
            "rounds": 0, "completed": True, "engine": "agent_loop",
            "short_query": True,
        })

    # ------------------------------------------------------------------
    #  收尾
    # ------------------------------------------------------------------

    async def _finalize(
        self, bus: StreamBus, ctx: UnifiedContext, outcome: LoopOutcome
    ) -> None:
        """发射 sources + references + result + done。"""
        if ctx.sources:
            await bus.emit(
                StreamEventType.SOURCES,
                metadata={
                    "sources": [_source_to_dict(s) for s in ctx.sources],
                    "call_id": "loop_summary",
                    "call_kind": "agent_loop",
                },
            )
            await bus.emit(
                StreamEventType.REFERENCES,
                metadata={
                    "references": [_source_to_reference(s) for s in ctx.sources],
                    "call_id": "loop_summary",
                    "call_kind": "agent_loop",
                },
            )

        await bus.finish(
            result_metadata={
                "rounds": outcome.rounds,
                "completed": outcome.completed,
                "forced": outcome.forced,
                "engine": "agent_loop",
                "call_id": "loop_summary",
                "call_kind": "agent_loop",
            }
        )

        # 异步触发记忆合并（completed 时才合并）
        if outcome.completed and self._memory is not None:
            try:
                await self._memory.consolidate(ctx.session_id)
            except Exception as exc:
                logger.warning("memory consolidate skipped: %s", exc)

    # ------------------------------------------------------------------
    #  记忆/会话辅助
    # ------------------------------------------------------------------

    def _ensure_session(self, session_id: str) -> None:
        if self._memory is not None:
            try:
                self._memory.create_session(session_id)
            except Exception as exc:
                logger.warning("create_session failed: %s", exc)

    async def _get_memory_context(self, session_id: str) -> str:
        if self._memory is None:
            return ""
        try:
            return await self._memory.get_memory_context(session_id)
        except Exception as exc:
            logger.warning("get_memory_context failed: %s", exc)
            return ""

    def _trace(self, session_id: str, entry: dict[str, Any]) -> None:
        if self._memory is None:
            return
        try:
            self._memory.append_trace(session_id, entry)
        except Exception as exc:
            logger.warning("append_trace failed: %s", exc)

    def _save_paused(self, ctx: UnifiedContext, round_num: int) -> None:
        if self._memory is None:
            return
        try:
            self._memory.save_paused_context(ctx.session_id, ctx.to_snapshot(), round_num)
        except Exception as exc:
            logger.warning("save_paused_context failed: %s", exc)

    def _load_paused(self, session_id: str) -> tuple[dict[str, Any], int] | None:
        if self._memory is None:
            return None
        try:
            return self._memory.load_paused_context(session_id)
        except Exception as exc:
            logger.warning("load_paused_context failed: %s", exc)
            return None

    def _clear_paused(self, session_id: str) -> None:
        if self._memory is None:
            return
        try:
            self._memory.clear_paused_context(session_id)
        except Exception as exc:
            logger.warning("clear_paused_context failed: %s", exc)


# ------------------------------------------------------------------
#  模块级辅助函数
# ------------------------------------------------------------------

def _accumulate_tool_delta(acc: dict[int, dict[str, Any]], delta: dict[str, Any]) -> None:
    """累积流式 tool_call delta（按 index 聚合 id/name/arguments）。"""
    idx = delta.get("index", 0)
    slot = acc.setdefault(idx, {"arguments": ""})
    if "id" in delta:
        slot["id"] = delta["id"]
    if "name" in delta:
        slot["name"] = delta["name"]
    if "arguments_delta" in delta:
        slot["arguments"] += delta["arguments_delta"]


def _materialize_tool_calls(acc: dict[int, dict[str, Any]]) -> list[ToolCall]:
    """把累积的 tool_call delta 转为 ToolCall 列表。"""
    result: list[ToolCall] = []
    for idx in sorted(acc.keys()):
        slot = acc[idx]
        tid = slot.get("id") or f"call_{idx}"
        name = slot.get("name", "")
        if not name:
            continue
        raw_args = slot.get("arguments", "")
        try:
            arguments = json.loads(raw_args) if raw_args else {}
        except json.JSONDecodeError:
            arguments = {}
        result.append(ToolCall(id=tid, name=name, arguments=arguments))
    return result


def _summarize_tool_args(tc: ToolCall) -> str:
    """生成工具调用的简短摘要（用于 trace 展示）。"""
    if tc.name == "rag":
        return f"query={tc.arguments.get('query', '')[:80]}"
    if tc.name == "web_search":
        return f"query={tc.arguments.get('query', '')[:80]}"
    if tc.name == "ask_user":
        qs = tc.arguments.get("questions", [])
        return f"{len(qs)} 个问题"
    return json.dumps(tc.arguments, ensure_ascii=False)[:80]


def _source_to_dict(s: SourceItem) -> dict[str, Any]:
    return {"id": s.id, "content": s.content[:200], "file_path": s.file_path, "type": s.type}


def _source_to_reference(s: SourceItem) -> dict[str, Any]:
    """转成旧前端兼容的 ReferenceItem 形态。"""
    if s.type == "web":
        return {"reference_id": s.id, "file_path": s.id, "content": [s.content]}
    return {"reference_id": s.id, "file_path": s.file_path, "content": [s.content]}


__all__ = ["AgentLoop"]
