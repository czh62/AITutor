from __future__ import annotations

import time
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeType(str, Enum):
    MEMORY = "memory"
    CONCEPT = "concept"
    PROCEDURE = "procedure"
    DESIGN = "design"


class ErrorType(str, Enum):
    BLANK = "blank"
    INCORRECT = "incorrect"


class NextAction(str, Enum):
    GRADE = "grade"
    REVIEW = "review"
    PROBE = "probe"
    COMPLETE = "complete"


class KnowledgePoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    type: KnowledgeType
    module_id: str
    description: str = ""
    dependencies: list[str] = Field(default_factory=list)


class LearningModule(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    order: int
    description: str = ""
    pass_threshold: float = 0.7
    knowledge_points: list[KnowledgePoint] = Field(default_factory=list)


class RetryAttempt(BaseModel):
    model_config = ConfigDict(extra="ignore")

    attempted_at: float = Field(default_factory=time.time)
    user_answer: str = ""
    correct: bool = False


class QuizAttempt(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledge_point_id: str = ""
    question_type: str = "short"
    user_answer: str = ""
    expected_answer: str = ""
    correct: bool = False
    attempted_at: float = Field(default_factory=time.time)
    error_type: ErrorType | None = None
    retry_attempts: list[RetryAttempt] = Field(default_factory=list)


class ErrorRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledge_point_id: str
    error_type: ErrorType = ErrorType.INCORRECT
    active: bool = True
    retrying: bool = False
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class PendingQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledge_point_id: str
    question_type: str = "short"
    prompt: str = ""
    expected_answer: str = ""
    created_at: float = Field(default_factory=time.time)


class RepetitionState(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledge_type: KnowledgeType
    interval_index: int = 0
    next_review_at: float = Field(default_factory=time.time)
    last_review_at: float | None = None
    streak: int = 0


class ReviewTask(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledge_point_id: str
    knowledge_type: KnowledgeType
    due_at: float
    priority: int


class NextStep(BaseModel):
    model_config = ConfigDict(extra="ignore")

    action: NextAction
    knowledge_point_id: str | None = None


class LearningProgress(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    title: str = ""
    source_file: str = ""
    rag_status: str = "pending"
    build_status: Literal["not_started", "queued", "building", "ready", "build_failed", "rag_failed"] = "not_started"
    build_error: str = ""
    build_warnings: list[str] = Field(default_factory=list)
    modules: list[LearningModule] = Field(default_factory=list)
    mastery_levels: dict[str, float] = Field(default_factory=dict)
    qualitative_mastery: dict[str, bool] = Field(default_factory=dict)
    knowledge_types: dict[str, KnowledgeType] = Field(default_factory=dict)
    quiz_attempts: list[QuizAttempt] = Field(default_factory=list)
    error_records: list[ErrorRecord] = Field(default_factory=list)
    repetition_states: dict[str, RepetitionState] = Field(default_factory=dict)
    review_queue: list[ReviewTask] = Field(default_factory=list)
    pending_question: PendingQuestion | None = None
    feynman_explanations: dict[str, str] = Field(default_factory=dict)
    version: int = 0
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
