"""QuizService — 三阶段出题核心逻辑。

简化版 DeepTutor QuestionPipeline：
- Phase 1: RAG 检索（直接调用 LightRAG query_context，非 agentic loop）
- Phase 2: 规划（单次 LLM call 生成题目模板 JSON）
- Phase 3: 出题（逐题单次 LLM call 生成结构化 JSON，带 repair）

通过 StreamBus 推送 NDJSON 事件，前端逐题看到题目卡片。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, AsyncIterator

from ..agentloop.bus import StreamBus
from ..agentloop.stream import StreamEventType
from ..core.config import get_settings
from ..services.lightrag_client import LightRAGClient
from ..services.llm_client import LLMClient
from .quiz_prompts import (
    EMPTY_CONTEXT,
    EMPTY_PREVIOUS_QUESTIONS,
    PLAN_SYSTEM_PROMPT,
    PLAN_USER_TEMPLATE,
    QUIZ_SYSTEM_PROMPT,
    QUIZ_USER_TEMPLATE,
    REPAIR_SYSTEM_PROMPT,
    REPAIR_USER_TEMPLATE,
)
from .quiz_types import (
    QuizPlan,
    QuizQuestion,
    QuizTemplate,
    collect_quiz_issues,
    format_allowed_types,
    format_difficulty,
    normalize_quiz_payload,
    normalize_type_list,
    normalize_difficulty,
    parse_plan,
    parse_quiz_payload,
    quiz_question_to_dict,
)

logger = logging.getLogger("aitutor.quiz_service")

# 默认配置
_DEFAULT_NUM_QUESTIONS = 3
_DEFAULT_TEMPERATURE = 0.4
_PLAN_MAX_TOKENS = 2000
_QUIZ_MAX_TOKENS = 3000
_REPAIR_MAX_TOKENS = 2500


class QuizService:
    """三阶段出题服务。依赖注入 LLMClient + LightRAGClient。"""

    def __init__(self, llm: LLMClient, lightrag: LightRAGClient) -> None:
        self._llm = llm
        self._lightrag = lightrag
        settings = get_settings()
        self._temperature = settings.agent_loop_temperature or _DEFAULT_TEMPERATURE

    # ------------------------------------------------------------------
    #  流式出题入口
    # ------------------------------------------------------------------

    async def generate_stream(
        self,
        topic: str,
        num_questions: int = _DEFAULT_NUM_QUESTIONS,
        difficulty: str = "auto",
        question_types: list[str] | None = None,
    ) -> AsyncIterator[str]:
        """主入口：创建 bus → 运行三阶段 → 流式 yield NDJSON 行。

        与 AgentLoop.run_stream() 同模式：后台 asyncio.Task 运行出题，
        前台 stream_lines() 并行消费 queue 并逐行 yield。
        """
        bus = StreamBus()
        sid = f"quiz_{uuid.uuid4().hex[:16]}"
        requested = max(1, int(num_questions or _DEFAULT_NUM_QUESTIONS))
        allowed_types = normalize_type_list(question_types)
        diff = normalize_difficulty(difficulty)

        await bus.emit(StreamEventType.SESSION, metadata={"session_id": sid})

        async def _run() -> None:
            try:
                await self._run_inner(bus, topic, requested, diff, allowed_types)
            except Exception as exc:
                logger.error("quiz generation failed: %s", exc)
                await bus.emit_error(f"出题失败: {exc}")
                await bus.finish()

        task = asyncio.create_task(_run())
        async for line in bus.stream_lines():
            yield line

        try:
            await task
        except Exception:
            pass

    # ------------------------------------------------------------------
    #  内部三阶段逻辑
    # ------------------------------------------------------------------

    async def _run_inner(
        self,
        bus: StreamBus,
        topic: str,
        num_questions: int,
        difficulty: str,
        allowed_types: list[str],
    ) -> None:
        """Phase 1 → 2 → 3，逐阶段 emit 事件。"""

        # Phase 1: RAG retrieval
        context_text = await self._retrieve_context(topic, bus)

        # Phase 2: Plan
        plan = await self._plan(topic, num_questions, difficulty, allowed_types, context_text, bus)

        if not plan.templates:
            await bus.emit(
                StreamEventType.PROGRESS,
                content="规划未返回任何题目模板，出题终止",
                metadata={"call_kind": "quiz_planning", "call_role": "warning"},
            )
            await bus.finish(result_metadata={"questions": [], "mode": "custom", "success": False})
            return

        # Phase 3: Per-question generation
        questions: list[QuizQuestion] = []
        total = len(plan.templates)

        await bus.emit(
            StreamEventType.STAGE_START,
            metadata={"phase": "quizzing", "call_kind": "quiz_generation", "total_questions": total},
        )

        for index, template in enumerate(plan.templates):
            await bus.emit(
                StreamEventType.PROGRESS,
                content=f"正在生成第 {index + 1}/{total} 题…",
                metadata={
                    "call_kind": "quiz_generation",
                    "call_role": "progress",
                    "question_index": index,
                    "total_questions": total,
                },
            )

            q = await self._generate_one(template, index, total, context_text, plan, questions, bus)
            questions.append(q)

            # 发射题目事件（前端据此渲染 QuizCard）
            await bus.emit(
                StreamEventType.CONTENT,
                content=f"第 {index + 1} 道题已生成",
                metadata={
                    "call_kind": "quiz_question",
                    "call_role": "quiz",
                    "question_index": index,
                    "question": quiz_question_to_dict(q),
                },
            )

            await bus.emit(
                StreamEventType.PROGRESS,
                content=f"第 {index + 1}/{total} 道题已生成",
                metadata={
                    "call_kind": "quiz_generation",
                    "call_role": "progress",
                    "question_index": index,
                    "total_questions": total,
                },
            )

        # Result envelope
        questions_dicts = [quiz_question_to_dict(q) for q in questions]
        await bus.finish(
            result_metadata={
                "questions": questions_dicts,
                "mode": "custom",
                "success": True,
                "requested": num_questions,
                "completed": len(questions),
                "call_kind": "quiz_result",
            }
        )

    # ------------------------------------------------------------------
    #  Phase 1: RAG 检索
    # ------------------------------------------------------------------

    async def _retrieve_context(self, topic: str, bus: StreamBus) -> str:
        """调用 LightRAG query_context 获取相关上下文。

        失败时或上下文与主题明显无关时返回 EMPTY_CONTEXT（不阻断出题，让 LLM 基于通用知识出题）。
        """

        await bus.emit(
            StreamEventType.STAGE_START,
            metadata={"phase": "retrieving", "call_kind": "quiz_retrieval"},
        )
        await bus.emit(
            StreamEventType.PROGRESS,
            content="正在检索相关知识…",
            metadata={"call_kind": "quiz_retrieval", "call_role": "progress"},
        )

        try:
            body = {"query": topic, "query_mode": "mix", "history_turns": 0}
            data = await self._lightrag.query_context(body)

            # 提取文本
            if isinstance(data, str):
                context_text = data.strip()
            elif isinstance(data, dict):
                context_text = str(data.get("response") or data.get("content") or "").strip()
            else:
                context_text = ""

            if context_text:
                # 评估上下文与主题的相关性
                relevance = await self._assess_relevance(topic, context_text)
                if relevance == "irrelevant":
                    logger.warning("RAG context irrelevant to topic '%s', falling back to general knowledge", topic)
                    await bus.emit(
                        StreamEventType.PROGRESS,
                        content=f"检索到的上下文与主题「{topic}」无关，将基于通用知识出题",
                        metadata={"call_kind": "quiz_retrieval", "call_role": "fallback", "reason": "context_irrelevant"},
                    )
                    return EMPTY_CONTEXT

                preview = context_text[:100] + "…" if len(context_text) > 100 else context_text
                await bus.emit(
                    StreamEventType.PROGRESS,
                    content=f"检索完成，获取到相关上下文（{len(context_text)} 字符）",
                    metadata={"call_kind": "quiz_retrieval", "call_role": "complete", "preview": preview},
                )
                return context_text
            else:
                await bus.emit(
                    StreamEventType.PROGRESS,
                    content="知识库未检索到相关内容，将基于通用知识出题",
                    metadata={"call_kind": "quiz_retrieval", "call_role": "complete"},
                )
                return EMPTY_CONTEXT

        except Exception as exc:
            logger.warning("RAG retrieval failed: %s", exc)
            await bus.emit(
                StreamEventType.PROGRESS,
                content=f"知识库检索失败，将基于通用知识出题",
                metadata={"call_kind": "quiz_retrieval", "call_role": "fallback", "error": str(exc)},
            )
            return EMPTY_CONTEXT

    # ------------------------------------------------------------------
    #  Phase 2: 规划
    # ------------------------------------------------------------------

    async def _plan(
        self,
        topic: str,
        num_questions: int,
        difficulty: str,
        allowed_types: list[str],
        context_text: str,
        bus: StreamBus,
    ) -> QuizPlan:
        """单次 LLM call 生成题目规划 JSON。"""

        await bus.emit(
            StreamEventType.STAGE_START,
            metadata={"phase": "planning", "call_kind": "quiz_planning"},
        )
        await bus.emit(
            StreamEventType.PROGRESS,
            content="正在规划题目结构…",
            metadata={"call_kind": "quiz_planning", "call_role": "progress"},
        )

        system_prompt = PLAN_SYSTEM_PROMPT.format(num_questions=num_questions)
        user_prompt = PLAN_USER_TEMPLATE.format(
            context_text=context_text,
            user_message=topic,
            num_questions=num_questions,
            allowed_types=format_allowed_types(allowed_types),
            difficulty=format_difficulty(difficulty),
        )

        raw = await self._llm.call(
            system_prompt,
            user_prompt,
            temperature=self._temperature,
            max_tokens=_PLAN_MAX_TOKENS,
        )

        plan = parse_plan(raw, requested=num_questions, allowed_types=allowed_types, target_difficulty=difficulty)

        if plan.templates:
            summary_lines = [f"规划完成：{len(plan.templates)} 道题"]
            for t in plan.templates:
                summary_lines.append(f"  - [{t.question_id}] ({t.question_type}/{t.difficulty}) {t.topic}")
            await bus.emit(
                StreamEventType.PROGRESS,
                content="\n".join(summary_lines),
                metadata={"call_kind": "quiz_planning", "call_role": "complete"},
            )
        else:
            await bus.emit(
                StreamEventType.PROGRESS,
                content="规划未返回有效的题目模板",
                metadata={"call_kind": "quiz_planning", "call_role": "warning"},
            )

        return plan

    # ------------------------------------------------------------------
    #  Phase 3: 生成单题
    # ------------------------------------------------------------------

    async def _generate_one(
        self,
        template: QuizTemplate,
        question_number: int,
        total_questions: int,
        context_text: str,
        plan: QuizPlan,
        previous_questions: list[QuizQuestion],
        bus: StreamBus,
    ) -> QuizQuestion:
        """单次 LLM call 生成一道题，带 parse + normalize + repair。"""

        system_prompt = QUIZ_SYSTEM_PROMPT.format(
            question_number=question_number + 1,
            total_questions=total_questions,
        )
        user_prompt = QUIZ_USER_TEMPLATE.format(
            question_id=template.question_id,
            topic=template.topic,
            question_type=template.question_type,
            difficulty=template.difficulty,
            context_text=context_text,
            plan_summary=self._render_plan_summary(plan),
            previous_questions=self._render_previous_questions(previous_questions) if previous_questions else EMPTY_PREVIOUS_QUESTIONS,
        )

        raw = await self._llm.call(
            system_prompt,
            user_prompt,
            temperature=self._temperature,
            max_tokens=_QUIZ_MAX_TOKENS,
        )

        payload = parse_quiz_payload(raw)
        normalized = normalize_quiz_payload(template, payload)
        issues = collect_quiz_issues(template, normalized)

        # Repair: 最多 1 次
        if issues:
            await bus.emit(
                StreamEventType.PROGRESS,
                content="题目 JSON 不合规，正在修复…",
                metadata={
                    "call_kind": "quiz_generation",
                    "call_role": "repair",
                    "question_id": template.question_id,
                    "issues": issues,
                },
            )
            repaired = await self._repair(template, normalized, issues, bus)
            if repaired:
                normalized = normalize_quiz_payload(template, repaired)
                issues = collect_quiz_issues(template, normalized)
            if issues:
                await bus.emit(
                    StreamEventType.PROGRESS,
                    content="修复未能完全修正题目",
                    metadata={
                        "call_kind": "quiz_generation",
                        "call_role": "warning",
                        "question_id": template.question_id,
                        "remaining_issues": issues,
                    },
                )

        return self._payload_to_question(template, normalized, issues=issues)

    async def _repair(
        self,
        template: QuizTemplate,
        payload: dict[str, Any],
        issues: list[str],
        bus: StreamBus,
    ) -> dict[str, Any] | None:
        """单次 LLM call 修复不合规的题目 JSON。返回修复后的 dict 或 None。"""

        system_prompt = REPAIR_SYSTEM_PROMPT
        user_prompt = REPAIR_USER_TEMPLATE.format(
            question_id=template.question_id,
            topic=template.topic,
            question_type=template.question_type,
            difficulty=template.difficulty,
            invalid_payload=json.dumps(payload, ensure_ascii=False, indent=2),
            issues=json.dumps(issues, ensure_ascii=False),
        )

        try:
            raw = await self._llm.call(
                system_prompt,
                user_prompt,
                temperature=self._temperature,
                max_tokens=_REPAIR_MAX_TOKENS,
            )
            return parse_quiz_payload(raw)
        except Exception as exc:
            logger.warning("repair call failed: %s", exc)
            return None

    # ------------------------------------------------------------------
    #  辅助渲染方法
    # ------------------------------------------------------------------

    async def _assess_relevance(self, topic: str, context_text: str) -> str:
        """用 LLM 快速评估检索到的上下文与主题的相关性。

        返回 "relevant" / "irrelevant"。
        使用小 max_tokens + 低温度，减少延迟。
        """
        # 简短上下文直接放全文，长上下文只放前 800 字符做快速判断
        sample = context_text[:800] if len(context_text) > 800 else context_text

        system = "你是一个相关性判断器。判断给定的文本内容是否与指定主题相关。只输出 'relevant' 或 'irrelevant'，不要输出其他内容。"
        user = f"主题：{topic}\n\n文本内容：{sample}\n\n这段文本是否与主题「{topic}」相关？只输出 relevant 或 irrelevant。"

        try:
            raw = await self._llm.call(system, user, temperature=0.0, max_tokens=10)
            result = raw.strip().lower()
            if "irrelevant" in result:
                return "irrelevant"
            return "relevant"
        except Exception as exc:
            logger.warning("relevance assessment failed: %s, assuming relevant", exc)
            return "relevant"

    def _payload_to_question(
        self,
        template: QuizTemplate,
        payload: dict[str, Any],
        *,
        issues: list[str],
    ) -> QuizQuestion:
        """把归一化后的 payload + template → QuizQuestion。"""
        question = str(payload.get("question") or "").strip()
        if not question:
            question = f"[生成失败] {template.topic}"
        return QuizQuestion(
            question_id=template.question_id,
            question=question,
            question_type=template.question_type,
            correct_answer=str(payload.get("correct_answer") or "").strip() or "N/A",
            explanation=str(payload.get("explanation") or "").strip() or "N/A",
            options=payload.get("options") if isinstance(payload.get("options"), dict) else None,
            topic=template.topic,
            difficulty=template.difficulty,
            metadata={"issues": issues} if issues else {},
        )

    @staticmethod
    def _render_plan_summary(plan: QuizPlan) -> str:
        """渲染规划摘要给出题 prompt 使用。"""
        if not plan.templates:
            return "(空规划)"
        lines = []
        if plan.analysis:
            lines.append(f"分析: {plan.analysis}")
        for t in plan.templates:
            lines.append(f"  - [{t.question_id}] ({t.question_type}/{t.difficulty}) {t.topic}")
        return "\n".join(lines)

    @staticmethod
    def _render_previous_questions(qa_pairs: list[QuizQuestion]) -> str:
        """渲染已生成的题目列表给出题 prompt 使用（防重复）。"""
        return "\n".join(f"{i}. {qa.question}" for i, qa in enumerate(qa_pairs, 1))


__all__ = ["QuizService"]
