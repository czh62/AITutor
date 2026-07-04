from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..core.exceptions import ConflictError, NotFoundError, ValidationError
from ..mastery.models import KnowledgeType
from ..mastery.policy import find_knowledge_point
from ..mastery.service import MasteryService
from ..schemas.mastery import (
    AssessRequest,
    AssessResponse,
    GradeRequest,
    GradeResponse,
    MasteryDocumentDetailResponse,
    MasteryDocumentListResponse,
    QuizRequest,
    QuizResponse,
    StudyResponse,
)

router = APIRouter(prefix="/mastery", tags=["mastery"])


def get_mastery_service(request: Request) -> MasteryService:
    return request.app.state.mastery_service


def _require_progress(service: MasteryService, doc_id: str):
    progress = service.get_document(doc_id)
    if progress is None:
        raise NotFoundError("Mastery document not found")
    return progress


@router.get("/documents", response_model=MasteryDocumentListResponse)
async def list_mastery_documents(
    service: MasteryService = Depends(get_mastery_service),
):
    return MasteryDocumentListResponse(documents=service.list_documents())


@router.get("/documents/{doc_id}", response_model=MasteryDocumentDetailResponse)
async def get_mastery_document(
    doc_id: str,
    service: MasteryService = Depends(get_mastery_service),
):
    _require_progress(service, doc_id)
    return service.get_document_payload(doc_id)


@router.post("/documents/{doc_id}/build", response_model=MasteryDocumentDetailResponse)
async def build_mastery_document(
    doc_id: str,
    service: MasteryService = Depends(get_mastery_service),
):
    progress = _require_progress(service, doc_id)
    if progress.rag_status != "processed":
        raise ValidationError("LightRAG 文档尚未处理完成，不能构建知识树")
    service.build_document(doc_id)
    return service.get_document_payload(doc_id)


@router.post("/documents/{doc_id}/study/{kp_id}", response_model=StudyResponse)
async def study_knowledge_point(
    doc_id: str,
    kp_id: str,
    service: MasteryService = Depends(get_mastery_service),
):
    _require_progress(service, doc_id)
    return service.study_knowledge_point(doc_id, kp_id)


@router.post("/documents/{doc_id}/quiz/{kp_id}", response_model=QuizResponse)
async def create_mastery_quiz(
    doc_id: str,
    kp_id: str,
    request: QuizRequest | None = None,
    service: MasteryService = Depends(get_mastery_service),
):
    progress = _require_progress(service, doc_id)
    if progress.pending_question is not None:
        raise ConflictError("已有待回答题目，请先提交答案")
    return service.create_quiz(doc_id, kp_id, question_type=(request.question_type if request else "short"))


@router.post("/documents/{doc_id}/grade", response_model=GradeResponse)
async def grade_mastery_answer(
    doc_id: str,
    request: GradeRequest,
    service: MasteryService = Depends(get_mastery_service),
):
    _require_progress(service, doc_id)
    if not request.answer.strip():
        raise ValidationError("答案不能为空")
    return service.grade_answer(doc_id, request.answer)


@router.post("/documents/{doc_id}/assess/{kp_id}", response_model=AssessResponse)
async def assess_knowledge_point(
    doc_id: str,
    kp_id: str,
    request: AssessRequest,
    service: MasteryService = Depends(get_mastery_service),
):
    progress = _require_progress(service, doc_id)
    kp, _, _ = find_knowledge_point(progress, kp_id)
    if kp is None:
        raise NotFoundError("Knowledge point not found")
    if kp.type in {KnowledgeType.MEMORY, KnowledgeType.PROCEDURE}:
        raise ValidationError("记忆型和程序型知识点不能使用定性评估")
    return service.assess(doc_id, kp_id, passed=request.passed, feedback=request.feedback)


@router.post("/documents/{doc_id}/assess", response_model=AssessResponse)
async def assess_knowledge_point_from_body(
    doc_id: str,
    request: AssessRequest,
    service: MasteryService = Depends(get_mastery_service),
):
    if not request.knowledge_point_id:
        raise ValidationError("knowledge_point_id 不能为空")
    return await assess_knowledge_point(
        doc_id=doc_id,
        kp_id=request.knowledge_point_id,
        request=request,
        service=service,
    )


@router.post("/documents/{doc_id}/reset", response_model=MasteryDocumentDetailResponse)
async def reset_mastery_progress(
    doc_id: str,
    service: MasteryService = Depends(get_mastery_service),
):
    _require_progress(service, doc_id)
    service.reset_progress(doc_id)
    return service.get_document_payload(doc_id)


@router.delete("/documents/{doc_id}")
async def delete_mastery_document(
    doc_id: str,
    service: MasteryService = Depends(get_mastery_service),
):
    _require_progress(service, doc_id)
    service.delete_document(doc_id)
    return {"status": "success", "message": "Mastery document deleted"}
