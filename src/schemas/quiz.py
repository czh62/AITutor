"""出题相关 Pydantic schema。

对齐前端 QuizQuestion / QuizGenerateRequest 类型，所有 model 用 ConfigDict(extra="ignore")。
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class QuizGenerateRequest(BaseModel):
    """出题请求体。"""

    model_config = ConfigDict(extra="ignore")

    topic: str
    num_questions: int = 3
    difficulty: Literal["easy", "medium", "hard", "auto"] = "auto"
    question_types: list[str] = []  # 空=任意题型


class QuizQuestionResponse(BaseModel):
    """单道题目的响应结构。"""

    model_config = ConfigDict(extra="ignore")

    question_id: str
    question: str
    question_type: str
    correct_answer: str
    explanation: str
    options: Optional[dict[str, str]] = None
    topic: str = ""
    difficulty: str = ""


class QuizGenerateResponse(BaseModel):
    """非流式出题的完整响应。"""

    model_config = ConfigDict(extra="ignore")

    questions: list[QuizQuestionResponse]
    mode: str = "custom"
    success: bool = True
    requested: int = 0
    completed: int = 0


class QuizJudgeRequest(BaseModel):
    """AI 判题请求体。"""

    model_config = ConfigDict(extra="ignore")

    question: str
    question_type: str
    options: Optional[dict[str, str]] = None
    correct_answer: str
    explanation: str
    user_answer: str
    language: str = "en"


class QuizFollowupRequest(BaseModel):
    """追问讲解请求体。"""

    model_config = ConfigDict(extra="ignore")

    followup_question: str
    question: str
    question_type: str
    options: Optional[dict[str, str]] = None
    correct_answer: str
    explanation: str
    user_answer: str
    ai_judgment: Optional[str] = None
    language: str = "en"


__all__ = [
    "QuizGenerateRequest",
    "QuizQuestionResponse",
    "QuizGenerateResponse",
    "QuizJudgeRequest",
    "QuizFollowupRequest",
]
