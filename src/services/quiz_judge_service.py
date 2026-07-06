"""QuizJudgeService — AI 判题 + 追问讲解流式服务。

使用 StreamBus + LLMClient 推送 NDJSON 事件，与 QuizService 模式一致。
采用 asyncio.create_task + yield 模式，确保客户端能实时接收流式事件。

两个核心方法：
- judge_stream(): 流式 AI 判题
- followup_stream(): 流式追问讲解
"""

from __future__ import annotations

import asyncio
import logging

from ..agentloop.bus import StreamBus
from ..agentloop.stream import StreamEventType
from ..services.llm_client import LLMClient
from .quiz_judge_prompts import (
    JUDGE_SYSTEM_PROMPT_ZH,
    JUDGE_SYSTEM_PROMPT_EN,
    build_judge_user_prompt,
    FOLLOWUP_SYSTEM_PROMPT_ZH,
    FOLLOWUP_SYSTEM_PROMPT_EN,
    build_followup_user_prompt,
)

logger = logging.getLogger("aitutor.quiz_judge_service")


class QuizJudgeService:
    """AI 判题 + 追问讲解服务，复用已有的 LLMClient。"""

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def judge_stream(
        self,
        *,
        question: str,
        question_type: str,
        options: dict | None,
        correct_answer: str,
        explanation: str,
        user_answer: str,
        language: str = "en",
    ):
        """流式 AI 判题，async generator 逐行 yield NDJSON。

        与 QuizService.generate_stream() 同模式：
        后台 asyncio.Task 运行判题，前台 stream_lines() 并行消费 queue 并逐行 yield。
        """
        bus = StreamBus()

        # 验证输入
        if not question.strip():
            await bus.emit_error("题目不能为空")
            await bus.finish()
            # 空生成器：直接 yield 空行后结束
            async for line in bus.stream_lines():
                yield line
            return

        if not user_answer.strip():
            await bus.emit_error("作答不能为空——请先提交答案再请求 AI 判题")
            await bus.finish()
            async for line in bus.stream_lines():
                yield line
            return

        # 选择语言对应系统提示词
        system_prompt = JUDGE_SYSTEM_PROMPT_ZH if language == "zh" else JUDGE_SYSTEM_PROMPT_EN

        # 构造用户提示词
        user_prompt = build_judge_user_prompt(
            language=language,
            question=question,
            question_type=question_type,
            options=options,
            correct_answer=correct_answer,
            explanation=explanation,
            user_answer=user_answer,
        )

        # 启动判题阶段
        await bus.emit(
            StreamEventType.STAGE_START,
            content="AI 判题",
            metadata={"call_kind": "quiz_judge"},
        )

        async def _run() -> None:
            """后台 Task：流式 LLM 调用 → 逐 chunk 推送 content 事件。"""
            full_text = ""
            try:
                async for chunk in self._llm.stream(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=0.3,
                    max_tokens=4096,
                ):
                    if not chunk:
                        continue
                    full_text += chunk
                    await bus.emit(
                        StreamEventType.CONTENT,
                        content=chunk,
                        metadata={"call_kind": "quiz_judge"},
                    )
            except Exception as exc:
                logger.error("AI 判题流失败: %s", exc)
                await bus.emit_error("AI 判题流失败")
                await bus.finish()
                return

            # 完成：推送 result + done
            await bus.finish(
                result_metadata={
                    "call_kind": "quiz_judge",
                    "judgment": full_text,
                    "success": True,
                }
            )

        task = asyncio.create_task(_run())
        async for line in bus.stream_lines():
            yield line

        try:
            await task
        except Exception:
            pass

    async def followup_stream(
        self,
        *,
        followup_question: str,
        question: str,
        question_type: str,
        options: dict | None,
        correct_answer: str,
        explanation: str,
        user_answer: str,
        ai_judgment: str | None,
        language: str = "en",
    ):
        """流式追问讲解，async generator 逐行 yield NDJSON。

        与 QuizService.generate_stream() 同模式：
        后台 asyncio.Task 运行追问，前台 stream_lines() 并行消费 queue 并逐行 yield。
        """
        bus = StreamBus()

        # 验证输入
        if not followup_question.strip():
            await bus.emit_error("追问不能为空")
            await bus.finish()
            async for line in bus.stream_lines():
                yield line
            return

        # 选择语言对应系统提示词
        system_prompt = FOLLOWUP_SYSTEM_PROMPT_ZH if language == "zh" else FOLLOWUP_SYSTEM_PROMPT_EN

        # 构造用户提示词
        user_prompt = build_followup_user_prompt(
            language=language,
            followup_question=followup_question,
            question=question,
            question_type=question_type,
            options=options,
            correct_answer=correct_answer,
            explanation=explanation,
            user_answer=user_answer,
            ai_judgment=ai_judgment,
        )

        # 启动追问阶段
        await bus.emit(
            StreamEventType.STAGE_START,
            content="追问讲解",
            metadata={"call_kind": "quiz_followup"},
        )

        async def _run() -> None:
            """后台 Task：流式 LLM 调用 → 逐 chunk 推送 content 事件。"""
            full_text = ""
            try:
                async for chunk in self._llm.stream(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=0.3,
                    max_tokens=4096,
                ):
                    if not chunk:
                        continue
                    full_text += chunk
                    await bus.emit(
                        StreamEventType.CONTENT,
                        content=chunk,
                        metadata={"call_kind": "quiz_followup"},
                    )
            except Exception as exc:
                logger.error("追问讲解流失败: %s", exc)
                await bus.emit_error("追问讲解流失败")
                await bus.finish()
                return

            # 完成：推送 result + done
            await bus.finish(
                result_metadata={
                    "call_kind": "quiz_followup",
                    "followup_answer": full_text,
                    "success": True,
                }
            )

        task = asyncio.create_task(_run())
        async for line in bus.stream_lines():
            yield line

        try:
            await task
        except Exception:
            pass


__all__ = ["QuizJudgeService"]
