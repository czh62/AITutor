from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class MasteryDocumentSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    title: str = ""
    source_file: str = ""
    rag_status: str = "unknown"
    build_status: str = "not_started"
    build_error: str = ""
    counts: dict[str, int] | None = None
    due_reviews: int | None = None


class MasteryDocumentListResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    documents: list[MasteryDocumentSummary]


class MasteryDocumentDetailResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    title: str = ""
    source_file: str = ""
    rag_status: str = "unknown"
    build_status: str = "not_started"
    build_error: str = ""
    map: dict[str, Any]
    next: dict[str, Any]


class StudyResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    knowledge_point_id: str
    title: str
    description: str
    explanation: str
    dependencies: list[str] = []


class QuizRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question_type: str = "short"


class QuizResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question_id: str
    knowledge_point_id: str
    prompt: str
    question_type: str = "short"
    options: list[str] = []


class GradeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    answer: str


class GradeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_correct: bool
    mastery: float
    mastered: bool
    next: dict[str, Any]
    map: dict[str, Any]


class AssessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    knowledge_point_id: str = ""
    passed: bool
    feedback: str = ""


class AssessResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    passed: bool
    next: dict[str, Any]
    map: dict[str, Any]
