"""文档管理路由。

每个端点：接收前端请求 → 调用 LightRAGClient → 解析响应为 Pydantic schema → 返回。
路径与前端期望完全一致（无 /api 前缀），对齐 LightRAG 的路由结构。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile

from ..core.exceptions import ValidationError
from ..schemas.documents import (
    CancelPipelineResult,
    ClearCacheResult,
    ClearDocumentsResult,
    DeleteDocumentsRequest,
    DeleteDocumentsResult,
    DocumentsPaginatedResponse,
    DocumentsRequest,
    PipelineStatus,
    ScanResult,
    UploadResult,
)
from ..services.lightrag_client import LightRAGClient

router = APIRouter(tags=["documents"])

SUPPORTED_MASTERY_EXTENSIONS = frozenset({".txt", ".md", ".pdf", ".docx"})
SUPPORTED_MASTERY_CONTENT_TYPES = {
    ".txt": {"text/plain", "application/octet-stream"},
    ".md": {"text/markdown", "text/plain", "application/octet-stream"},
    ".pdf": {"application/pdf", "application/octet-stream"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    },
}


def get_lightrag_client(request: Request) -> LightRAGClient:
    """从 app.state 获取 LightRAGClient（lifespan 中创建并存储）。"""
    return request.app.state.lightrag_client


def get_mastery_service(request: Request) -> Any:
    return getattr(request.app.state, "mastery_service", None)


def validate_mastery_upload_file(filename: str, content_type: str | None) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in SUPPORTED_MASTERY_EXTENSIONS:
        raise ValidationError("仅支持上传 TXT、MD、PDF、DOCX 文件")
    allowed = SUPPORTED_MASTERY_CONTENT_TYPES[suffix]
    if content_type and content_type not in allowed:
        raise ValidationError("文件类型与扩展名不匹配")


# ------------------------------------------------------------------
#  1. 分页查询文档列表
# ------------------------------------------------------------------

@router.post("/documents/paginated", response_model=DocumentsPaginatedResponse)
async def get_documents_paginated(
    request: DocumentsRequest,
    client: LightRAGClient = Depends(get_lightrag_client),
):
    raw = await client.get_documents_paginated(
        page=request.page,
        page_size=request.page_size,
        status_filter=request.status_filter,
        status_filters=request.status_filters,
        sort_field=request.sort_field,
        sort_direction=request.sort_direction,
    )
    return DocumentsPaginatedResponse(**raw)


# ------------------------------------------------------------------
#  2. 扫描/重试
# ------------------------------------------------------------------

@router.post("/documents/scan", response_model=ScanResult)
async def scan_documents(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.scan_documents()
    return ScanResult(**raw)


# ------------------------------------------------------------------
#  3. 上传文档
# ------------------------------------------------------------------

@router.post("/documents/upload", response_model=UploadResult)
async def upload_document(
    file: UploadFile = File(...),
    client: LightRAGClient = Depends(get_lightrag_client),
    mastery: Any = Depends(get_mastery_service),
):
    validate_mastery_upload_file(file.filename or "", file.content_type)
    content = await file.read()
    raw = await client.upload_document(
        file_name=file.filename or "unknown",
        file_content=content,
        content_type=file.content_type,
    )
    track_id = raw.get("track_id")
    if mastery is not None and raw.get("status") == "success" and track_id:
        mastery.register_upload(track_id=track_id, file_name=file.filename or "unknown")
    return UploadResult(**raw)


# ------------------------------------------------------------------
#  4. 删除指定文档
# ------------------------------------------------------------------

@router.delete("/documents/delete_document", response_model=DeleteDocumentsResult)
async def delete_documents(
    request: DeleteDocumentsRequest,
    client: LightRAGClient = Depends(get_lightrag_client),
):
    raw = await client.delete_documents(
        doc_ids=request.doc_ids,
        delete_file=request.delete_file,
        delete_llm_cache=request.delete_llm_cache,
    )
    return DeleteDocumentsResult(**raw)


# ------------------------------------------------------------------
#  5. 清空所有文档
# ------------------------------------------------------------------

@router.delete("/documents", response_model=ClearDocumentsResult)
async def clear_documents(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.clear_documents()
    return ClearDocumentsResult(**raw)


# ------------------------------------------------------------------
#  6. 清空 LLM 缓存
# ------------------------------------------------------------------

@router.post("/documents/clear_cache", response_model=ClearCacheResult)
async def clear_cache(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.clear_cache()
    return ClearCacheResult(**raw)


# ------------------------------------------------------------------
#  7. 流水线状态
# ------------------------------------------------------------------

@router.get("/documents/pipeline_status", response_model=PipelineStatus)
async def get_pipeline_status(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.get_pipeline_status()
    return PipelineStatus(**raw)


# ------------------------------------------------------------------
#  8. 取消流水线
# ------------------------------------------------------------------

@router.post("/documents/cancel_pipeline", response_model=CancelPipelineResult)
async def cancel_pipeline(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.cancel_pipeline()
    return CancelPipelineResult(**raw)


# ------------------------------------------------------------------
#  9. 状态计数
# ------------------------------------------------------------------

@router.get("/documents/status_counts")
async def get_status_counts(client: LightRAGClient = Depends(get_lightrag_client)):
    raw = await client.get_status_counts()
    return raw
