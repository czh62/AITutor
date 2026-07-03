"""AgentLoop — 查询改写循环核心 + 联网搜索 + 短查询兜底。

参考 DeepTutor 的 AgentLoop._run_loop()，大幅简化：
- 无 tool calling、无 label protocol、无 WebSocket
- 循环结构：retrieve → evaluate → (search if needed) → rewrite or finish → synthesize answer
- 短查询（< 3字符）直接走 LLM 回答，不走 LightRAG 检索（避免 422）
- 联网搜索双重触发：LLM 自动判断 need_web_search + 用户手动 force_web_search
- 通过 async generator yield NDJSON StreamEvent lines

上下文 vs 展示门控（对齐 DeepTutor）：
- 每个 StreamEvent 的 metadata 包含 call_id / call_kind / call_role 标记
- call_kind 区分调用类型：agent_loop_round / rag_retrieval / web_search / llm_evaluation / llm_final_response
- call_role 区分前端归属：retrieve / observe / thought / narration / finish
- 前端根据这些标记决定：哪些内容出现在思维链 trace、哪些出现在回答气泡
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from ..services.llm_client import LLMClient
from ..services.lightrag_client import LightRAGClient
from ..services.search_client import SearchClient
from ..services.search_types import SearchResponse
from ..core.config import get_settings
from .stream import StreamEventType, make_event
from .prompts import (
    EVALUATE_SYSTEM_PROMPT, EVALUATE_USER_TEMPLATE,
    ANSWER_SYSTEM_PROMPT, ANSWER_USER_TEMPLATE,
    CONVERSATIONAL_SYSTEM_PROMPT, CONVERSATIONAL_USER_TEMPLATE,
)

logger = logging.getLogger("aitutor.agentloop")

# 上下文截断上限（评估和回答时截断过长上下文）
EVALUATE_CONTEXT_MAX_CHARS = 4000
ANSWER_CONTEXT_MAX_CHARS = 8000

# 短查询阈值（低于此长度直接走 LLM 回答，不走 LightRAG）
MIN_LIGHTRAG_QUERY_LENGTH = 3


class EvalResult:
    """LLM 评估结果。"""

    quality: str          # "sufficient" / "insufficient"
    reason: str           # 评估理由
    rewritten_query: str  # 改写后的查询（仅 insufficient 时有值）
    missing_aspects: list[str]  # 缺少的关键方面
    need_web_search: bool  # 是否需要联网搜索

    def __init__(
        self,
        quality: str,
        reason: str = "",
        rewritten_query: str = "",
        missing_aspects: list[str] | None = None,
        need_web_search: bool = False,
    ):
        self.quality = quality
        self.reason = reason
        self.rewritten_query = rewritten_query
        self.missing_aspects = missing_aspects or []
        self.need_web_search = need_web_search


def _truncate(text: str, max_chars: int) -> str:
    """截断过长文本，保留前 max_chars 字符 + 截断提示。"""
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n\n...[上下文过长，已截断]"


def _parse_eval_json(raw: str) -> EvalResult:
    """解析 LLM 返回的评估 JSON，容错处理非标准输出。"""
    # 尝试直接解析
    try:
        obj = json.loads(raw.strip())
        return EvalResult(
            quality=obj.get("quality", "insufficient"),
            reason=obj.get("reason", ""),
            rewritten_query=obj.get("rewritten_query", ""),
            missing_aspects=obj.get("missing_aspects", []),
            need_web_search=obj.get("need_web_search", False),
        )
    except json.JSONDecodeError:
        pass

    # 尝试从文本中提取 JSON（模型可能包裹了额外文本）
    import re
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if json_match:
        try:
            obj = json.loads(json_match.group())
            return EvalResult(
                quality=obj.get("quality", "insufficient"),
                reason=obj.get("reason", ""),
                rewritten_query=obj.get("rewritten_query", ""),
                missing_aspects=obj.get("missing_aspects", []),
                need_web_search=obj.get("need_web_search", False),
            )
        except json.JSONDecodeError:
            pass

    # 无法解析，默认 insufficient + 建议联网搜索
    logger.warning("无法解析 LLM 评估 JSON: %s", raw[:200])
    return EvalResult(
        quality="insufficient",
        reason="LLM 评估结果无法解析",
        rewritten_query="",
        missing_aspects=["LLM 评估失败"],
        need_web_search=True,
    )


def _format_search_context(resp: SearchResponse) -> str:
    """将 DuckDuckGo 搜索结果格式化为 LLM 可读文本。"""
    if not resp.search_results:
        return ""
    lines = [f"【联网搜索结果（来源: {resp.provider}）】"]
    for r in resp.search_results:
        lines.append(f"- {r.title}: {r.snippet} (来源: {r.url})")
    return "\n".join(lines)


class AgentLoop:
    """查询改写循环 — 不断优化检索查询直到上下文充分，再综合生成回答。

    支持：
    - 短查询兜底（< 3字符直接走 LLM 回答，避免 LightRAG 422）
    - 联网搜索双重触发（LLM 自动判断 need_web_search + 用户手动 force_web_search）
    - DuckDuckGo 零配置搜索补充
    - call_id / call_kind / call_role 门控标记（对齐 DeepTutor 的上下文 vs 展示分离）
    """

    def __init__(
        self,
        llm_client: LLMClient,
        lightrag_client: LightRAGClient,
        search_client: SearchClient | None = None,
        max_rounds: int | None = None,
    ):
        settings = get_settings()
        self.llm = llm_client
        self.lightrag = lightrag_client
        self.search = search_client  # DuckDuckGo 搜索客户端（可选）
        self.max_rounds = max_rounds or settings.agent_loop_max_rounds
        self.temperature = settings.agent_loop_temperature
        self.max_tokens = settings.agent_loop_max_tokens

    async def run_stream(
        self,
        query: str,
        mode: str = "mix",
        force_web_search: bool = False,
    ) -> AsyncIterator[str]:
        """运行 AgentLoop 并 yield NDJSON 行（每行含尾部换行）。

        参数:
            query: 用户查询
            mode: LightRAG 查询模式
            force_web_search: 用户手动勾选联网搜索
        """
        # ---- 短查询兜底（< 3字符直接走 LLM 回答） ----
        if len(query.strip()) < MIN_LIGHTRAG_QUERY_LENGTH:
            async for line in self._stream_short_query(query, mode, force_web_search):
                yield line
            return

        # ---- 正常流程：检索 → 评估 → 搜索 → 改写 → 回答 ----
        accumulated_context = ""
        accumulated_web_context = ""
        accumulated_references: list[dict[str, Any]] = []
        current_query = query
        rounds_done = 0
        completed = False

        # 1. Loop 开始
        yield make_event(
            StreamEventType.STAGE_START,
            round=0,
            metadata={
                "original_query": query, "mode": mode, "max_rounds": self.max_rounds,
                "call_id": "loop_start", "call_kind": "agent_loop",
            },
        ).to_ndjson()

        # 2. 循环：检索 → 评估 → (搜索) → 改写
        for round_num in range(self.max_rounds):
            rounds_done = round_num + 1

            # 每轮循环共享同一个 call_id
            round_call_id = f"agent_loop_round_{round_num}"
            # 评估 LLM 调用有自己的 call_id
            eval_call_id = f"eval_round_{round_num}"
            # 搜索调用有自己的 call_id
            search_call_id = f"search_round_{round_num}"

            # 2a. 检索上下文
            yield make_event(
                StreamEventType.OBSERVATION,
                round=round_num,
                content=f"正在检索（第 {round_num + 1} 轮）...",
                metadata={
                    "query": current_query, "mode": mode,
                    "call_id": round_call_id, "call_kind": "agent_loop_round", "call_role": "retrieve",
                },
            ).to_ndjson()

            try:
                context_result = await self.lightrag.query_context({
                    "query": current_query,
                    "mode": mode,
                })
            except Exception as exc:
                # LightRAG 检索失败，如果可联网搜索则降级到搜索模式
                if self.search is not None:
                    yield make_event(
                        StreamEventType.PROGRESS,
                        round=round_num,
                        content=f"知识库检索失败，尝试联网搜索补充: {exc}",
                        metadata={
                            "quality": "rag_failed", "fallback": "web_search",
                            "call_id": round_call_id, "call_kind": "agent_loop_round", "call_role": "narration",
                        },
                    ).to_ndjson()
                    # 尝试联网搜索
                    try:
                        search_resp = await self.search.search(current_query)
                        web_context = _format_search_context(search_resp)
                        if web_context:
                            accumulated_context += web_context + "\n\n"
                            yield make_event(
                                StreamEventType.SEARCH,
                                round=round_num,
                                content=f"找到 {len(search_resp.search_results)} 条网络结果",
                                metadata={
                                    "query": current_query, "provider": "duckduckgo",
                                    "status": "complete",
                                    "results": [{"title": r.title, "url": r.url, "snippet": r.snippet} for r in search_resp.search_results],
                                    "call_id": search_call_id, "call_kind": "web_search",
                                },
                            ).to_ndjson()
                            for cit in search_resp.citations:
                                accumulated_references.append({
                                    "reference_id": f"web_{cit.id}",
                                    "file_path": cit.url,
                                    "content": [{"text": cit.snippet}],
                                })
                    except Exception:
                        pass  # 搜索也失败，静默继续
                else:
                    yield make_event(
                        StreamEventType.ERROR,
                        round=round_num,
                        content=f"检索失败: {exc}",
                        metadata={"call_id": round_call_id, "call_kind": "agent_loop_round"},
                    ).to_ndjson()
                    yield make_event(StreamEventType.DONE).to_ndjson()
                    return

            raw_context = context_result.get("response", "")
            refs = context_result.get("references") or []

            # 累积上下文和引用（去重引用）
            accumulated_context += raw_context + "\n\n"
            for ref in refs:
                if not any(r.get("reference_id") == ref.get("reference_id") for r in accumulated_references):
                    accumulated_references.append(ref)

            # 发送检索结果摘要
            context_preview = _truncate(raw_context, 500)
            yield make_event(
                StreamEventType.OBSERVATION,
                round=round_num,
                content=context_preview,
                metadata={
                    "query": current_query, "full_length": len(raw_context), "refs_count": len(refs),
                    "call_id": round_call_id, "call_kind": "agent_loop_round", "call_role": "observe",
                },
            ).to_ndjson()

            # 发送本轮引用
            if refs:
                yield make_event(
                    StreamEventType.REFERENCES,
                    round=round_num,
                    metadata={
                        "references": refs,
                        "call_id": round_call_id, "call_kind": "agent_loop_round",
                    },
                ).to_ndjson()

            # 2b. 评估上下文质量
            eval_context = _truncate(accumulated_context, EVALUATE_CONTEXT_MAX_CHARS)
            eval_user = EVALUATE_USER_TEMPLATE.format(query=query, context=eval_context)

            yield make_event(
                StreamEventType.THINKING,
                round=round_num,
                content="正在评估检索到的上下文质量...",
                metadata={
                    "call_id": eval_call_id, "call_kind": "llm_evaluation", "call_role": "thought",
                },
            ).to_ndjson()

            try:
                eval_raw = await self.llm.call(
                    system_prompt=EVALUATE_SYSTEM_PROMPT,
                    user_prompt=eval_user,
                    response_format={"type": "json_object"},
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                )
            except Exception as exc:
                yield make_event(
                    StreamEventType.ERROR,
                    round=round_num,
                    content=f"LLM 评估调用失败: {exc}",
                    metadata={"call_id": eval_call_id, "call_kind": "llm_evaluation"},
                ).to_ndjson()
                yield make_event(StreamEventType.DONE).to_ndjson()
                return

            eval_result = _parse_eval_json(eval_raw)

            # 发送评估思考
            yield make_event(
                StreamEventType.THINKING,
                round=round_num,
                content=eval_result.reason,
                metadata={
                    "quality": eval_result.quality, "need_web_search": eval_result.need_web_search,
                    "call_id": eval_call_id, "call_kind": "llm_evaluation", "call_role": "thought",
                },
            ).to_ndjson()

            # 2c. 联网搜索（双重触发：LLM 自动判断 + 用户手动勾选）
            need_search = eval_result.need_web_search or force_web_search
            if need_search and self.search is not None:
                yield make_event(
                    StreamEventType.SEARCH,
                    round=round_num,
                    content=f"正在联网搜索「{current_query}」...",
                    metadata={
                        "query": current_query, "provider": "duckduckgo", "status": "searching",
                        "call_id": search_call_id, "call_kind": "web_search",
                    },
                ).to_ndjson()

                try:
                    search_resp = await self.search.search(current_query)
                    web_context = _format_search_context(search_resp)
                    accumulated_web_context += web_context + "\n\n"
                    accumulated_context += web_context + "\n\n"

                    yield make_event(
                        StreamEventType.SEARCH,
                        round=round_num,
                        content=f"找到 {len(search_resp.search_results)} 条网络结果",
                        metadata={
                            "query": current_query, "provider": "duckduckgo",
                            "status": "complete",
                            "results": [{"title": r.title, "url": r.url, "snippet": r.snippet} for r in search_resp.search_results],
                            "call_id": search_call_id, "call_kind": "web_search",
                        },
                    ).to_ndjson()

                    # 搜索引用合并到 references
                    for cit in search_resp.citations:
                        if not any(r.get("reference_id") == f"web_{cit.id}" for r in accumulated_references):
                            accumulated_references.append({
                                "reference_id": f"web_{cit.id}",
                                "file_path": cit.url,
                                "content": [{"text": cit.snippet}],
                            })
                except Exception as exc:
                    yield make_event(
                        StreamEventType.SEARCH,
                        round=round_num,
                        content=f"联网搜索失败: {exc}",
                        metadata={
                            "status": "failed",
                            "call_id": search_call_id, "call_kind": "web_search",
                        },
                    ).to_ndjson()

            # 发送评估进度
            progress_content = "上下文充分，准备生成回答" if eval_result.quality == "sufficient" else "上下文不充分，需要改写查询"
            yield make_event(
                StreamEventType.PROGRESS,
                round=round_num,
                content=progress_content,
                metadata={
                    "quality": eval_result.quality,
                    "rewritten_query": eval_result.rewritten_query if eval_result.quality == "insufficient" else "",
                    "missing_aspects": eval_result.missing_aspects,
                    "need_web_search": eval_result.need_web_search,
                    "call_id": round_call_id, "call_kind": "agent_loop_round",
                    # 门控：sufficient 轮次的 progress 属于 finish（不再循环），
                    # insufficient 轮次属于 narration（中间步骤说明）
                    "call_role": "finish" if eval_result.quality == "sufficient" else "narration",
                },
            ).to_ndjson()

            if eval_result.quality == "sufficient":
                completed = True
                break

            # 2d. 改写查询
            if not eval_result.rewritten_query:
                eval_result.rewritten_query = f"{query} {', '.join(eval_result.missing_aspects)}"

            yield make_event(
                StreamEventType.QUERY_REWRITE,
                round=round_num + 1,
                content=eval_result.rewritten_query,
                metadata={
                    "original_query": query,
                    "call_id": round_call_id, "call_kind": "agent_loop_round", "call_role": "narration",
                },
            ).to_ndjson()

            current_query = eval_result.rewritten_query

        # 3. 如果循环结束仍未 sufficient，标记为强制完成
        if not completed:
            yield make_event(
                StreamEventType.PROGRESS,
                round=rounds_done,
                content=f"达到最大轮数 ({self.max_rounds})，强制综合回答",
                metadata={
                    "quality": "forced",
                    "call_id": "loop_summary", "call_kind": "agent_loop_round", "call_role": "narration",
                },
            ).to_ndjson()

        # 4. 综合回答（流式）— call_kind="llm_final_response" + call_role="finish"
        answer_call_id = "answer"
        answer_context = _truncate(accumulated_context, ANSWER_CONTEXT_MAX_CHARS)
        web_context_str = _truncate(accumulated_web_context, 2000) if accumulated_web_context else "无联网搜索结果"
        answer_user = ANSWER_USER_TEMPLATE.format(
            query=query,
            accumulated_context=answer_context,
            web_search_context=web_context_str,
        )

        try:
            async for chunk in self.llm.stream(
                system_prompt=ANSWER_SYSTEM_PROMPT,
                user_prompt=answer_user,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            ):
                yield make_event(
                    StreamEventType.CONTENT,
                    round=0,
                    content=chunk,
                    metadata={
                        "call_id": answer_call_id, "call_kind": "llm_final_response", "call_role": "finish",
                    },
                ).to_ndjson()
        except Exception as exc:
            yield make_event(
                StreamEventType.ERROR,
                content=f"综合回答生成失败: {exc}",
                metadata={"call_id": answer_call_id, "call_kind": "llm_final_response"},
            ).to_ndjson()
            yield make_event(StreamEventType.DONE).to_ndjson()
            return

        # 5. 发送合并引用
        if accumulated_references:
            yield make_event(
                StreamEventType.REFERENCES,
                metadata={
                    "references": accumulated_references,
                    "call_id": answer_call_id, "call_kind": "llm_final_response",
                },
            ).to_ndjson()

        # 6. 结果摘要
        yield make_event(
            StreamEventType.RESULT,
            metadata={
                "rounds": rounds_done, "completed": completed, "engine": "agent_loop",
                "call_id": "loop_summary",
            },
        ).to_ndjson()

        # 7. 流结束
        yield make_event(StreamEventType.DONE).to_ndjson()

    async def _stream_short_query(
        self,
        query: str,
        mode: str = "mix",
        force_web_search: bool = False,
    ) -> AsyncIterator[str]:
        """短查询（< 3字符）直接走 LLM 回答，不走 LightRAG 检索。

        避免 LightRAG 的 422 "String should have at least 3 characters" 错误。
        """
        yield make_event(
            StreamEventType.STAGE_START,
            round=0,
            metadata={
                "original_query": query, "mode": mode, "short_query": True, "max_rounds": 0,
                "call_id": "short_query", "call_kind": "agent_loop_round",
            },
        ).to_ndjson()

        yield make_event(
            StreamEventType.PROGRESS,
            round=0,
            content="短查询，直接生成回答",
            metadata={
                "quality": "short_query",
                "call_id": "short_query", "call_kind": "agent_loop_round", "call_role": "narration",
            },
        ).to_ndjson()

        # 联网搜索（如果用户手动勾选）
        web_context_str = "无联网搜索结果"
        search_call_id = "short_query_search"
        if force_web_search and self.search is not None:
            yield make_event(
                StreamEventType.SEARCH,
                round=0,
                content=f"正在联网搜索「{query}」...",
                metadata={
                    "query": query, "provider": "duckduckgo", "status": "searching",
                    "call_id": search_call_id, "call_kind": "web_search",
                },
            ).to_ndjson()
            try:
                search_resp = await self.search.search(query)
                web_context = _format_search_context(search_resp)
                web_context_str = _truncate(web_context, 2000) if web_context else "无联网搜索结果"
                yield make_event(
                    StreamEventType.SEARCH,
                    round=0,
                    content=f"找到 {len(search_resp.search_results)} 条网络结果",
                    metadata={
                        "query": query, "provider": "duckduckgo",
                        "status": "complete",
                        "results": [{"title": r.title, "url": r.url, "snippet": r.snippet} for r in search_resp.search_results],
                        "call_id": search_call_id, "call_kind": "web_search",
                    },
                ).to_ndjson()
                # 搜索引用
                refs = []
                for cit in search_resp.citations:
                    refs.append({
                        "reference_id": f"web_{cit.id}",
                        "file_path": cit.url,
                        "content": [{"text": cit.snippet}],
                    })
                if refs:
                    yield make_event(
                        StreamEventType.REFERENCES,
                        metadata={
                            "references": refs,
                            "call_id": search_call_id, "call_kind": "web_search",
                        },
                    ).to_ndjson()
            except Exception:
                yield make_event(
                    StreamEventType.SEARCH,
                    round=0,
                    content="联网搜索失败",
                    metadata={
                        "status": "failed",
                        "call_id": search_call_id, "call_kind": "web_search",
                    },
                ).to_ndjson()

        # LLM 直接回答
        answer_call_id = "short_query_answer"
        answer_user = CONVERSATIONAL_USER_TEMPLATE.format(query=query)
        if web_context_str != "无联网搜索结果":
            answer_user += f"\n\n联网搜索补充内容：\n{web_context_str}"

        try:
            async for chunk in self.llm.stream(
                system_prompt=CONVERSATIONAL_SYSTEM_PROMPT,
                user_prompt=answer_user,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            ):
                yield make_event(
                    StreamEventType.CONTENT,
                    round=0,
                    content=chunk,
                    metadata={
                        "call_id": answer_call_id, "call_kind": "llm_final_response", "call_role": "finish",
                    },
                ).to_ndjson()
        except Exception as exc:
            yield make_event(
                StreamEventType.ERROR,
                content=f"回答生成失败: {exc}",
                metadata={"call_id": answer_call_id, "call_kind": "llm_final_response"},
            ).to_ndjson()
            yield make_event(StreamEventType.DONE).to_ndjson()
            return

        # 结果摘要
        yield make_event(
            StreamEventType.RESULT,
            metadata={
                "rounds": 0, "completed": True, "engine": "agent_loop", "short_query": True,
                "call_id": "loop_summary",
            },
        ).to_ndjson()

        # 流结束
        yield make_event(StreamEventType.DONE).to_ndjson()
