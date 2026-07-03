"""出题路由 — QuizService 三阶段出题。

- POST /quiz/generate          非流式出题（内部运行 QuizService，收集 NDJSON 后返回 JSON）。
- POST /quiz/generate/stream    NDJSON 流式出题，逐行推送 QuizService 的 StreamEvent。

StreamEvent 类型沿用 AgentLoop 的 StreamEventType：
stage_start/progress/content/thinking/result/error/session/done。
出题相关的 content 事件 metadata 包含 call_kind="quiz_question"，
前端据此区分出题内容与普通聊天内容。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..schemas.quiz import QuizGenerateRequest, QuizGenerateResponse, QuizQuestionResponse
from ..services.quiz_service import QuizService
from ..services.quiz_types import QuizQuestion, quiz_question_to_dict
from ..core.logging import get_logger

logger = get_logger("aitutor.quiz")

router = APIRouter(tags=["quiz"])


def get_quiz_service(request: Request) -> QuizService:
    """从 app.state 获取 QuizService。"""
    return request.app.state.quiz_service


# ------------------------------------------------------------------
#  1. 非流式出题
# ------------------------------------------------------------------

@router.post("/quiz/generate", response_model=QuizGenerateResponse)
async def quiz_generate(
    request: QuizGenerateRequest,
    quiz: QuizService = Depends(get_quiz_service),
):
    """非流式出题：内部运行 QuizService，收集 NDJSON 后返回完整结果。"""
    questions: list[QuizQuestion] = []
    success = False
    requested = request.num_questions

    async for line in quiz.generate_stream(
        topic=request.topic,
        num_questions=request.num_questions,
        difficulty=request.difficulty,
        question_types=request.question_types,
    ):
        try:
            event = json.loads(line.strip())
        except json.JSONDecodeError:
            continue

        event_type = event.get("type", "")
        metadata = event.get("metadata", {})

        if event_type == "content" and metadata.get("call_kind") == "quiz_question":
            q_dict = metadata.get("question")
            if isinstance(q_dict, dict):
                questions.append(
                    QuizQuestion(
                        question_id=q_dict.get("question_id", ""),
                        question=q_dict.get("question", ""),
                        question_type=q_dict.get("question_type", ""),
                        correct_answer=q_dict.get("correct_answer", ""),
                        explanation=q_dict.get("explanation", ""),
                        options=q_dict.get("options"),
                        topic=q_dict.get("topic", ""),
                        difficulty=q_dict.get("difficulty", ""),
                    )
                )
        elif event_type == "result":
            success = metadata.get("success", False)
            # 也从 result metadata 中收集 questions（以防 content 事件未捕获）
            result_questions = metadata.get("questions")
            if isinstance(result_questions, list) and not questions:
                for q_dict in result_questions:
                    if isinstance(q_dict, dict):
                        questions.append(
                            QuizQuestion(
                                question_id=q_dict.get("question_id", ""),
                                question=q_dict.get("question", ""),
                                question_type=q_dict.get("question_type", ""),
                                correct_answer=q_dict.get("correct_answer", ""),
                                explanation=q_dict.get("explanation", ""),
                                options=q_dict.get("options"),
                                topic=q_dict.get("topic", ""),
                                difficulty=q_dict.get("difficulty", ""),
                            )
                        )

    return QuizGenerateResponse(
        questions=[QuizQuestionResponse(**quiz_question_to_dict(q)) for q in questions],
        mode="custom",
        success=success,
        requested=requested,
        completed=len(questions),
    )


# ------------------------------------------------------------------
#  2. 流式出题（NDJSON — QuizService events 逐行推送）
# ------------------------------------------------------------------

@router.post("/quiz/generate/stream")
async def quiz_generate_stream(
    request: QuizGenerateRequest,
    quiz: QuizService = Depends(get_quiz_service),
):
    """流式出题：QuizService 运行并逐行推送 NDJSON StreamEvent。"""
    return StreamingResponse(
        quiz.generate_stream(
            topic=request.topic,
            num_questions=request.num_questions,
            difficulty=request.difficulty,
            question_types=request.question_types,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
