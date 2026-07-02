"""文档管理相关 Pydantic schema。

与前端 frontend/src/api/types.ts 对齐，确保后端返回结构与前端期望一致。
所有 response model 使用 ConfigDict(extra="ignore")，避免 LightRAG 返回未知字段导致解析失败。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class DocStatus(str, Enum):
    """文档处理状态（对齐前端 DocStatus type）。"""

    processed = "processed"
    preprocessed = "preprocessed"
    parsing = "parsing"
    analyzing = "analyzing"
    processing = "processing"
    pending = "pending"
    failed = "failed"


class DocStatusResponse(BaseModel):
    """单个文档的状态记录（对齐前端 DocStatusResponse）。"""

    model_config = ConfigDict(extra="ignore")

    id: str
    file_path: str
    content_summary: Optional[str] = None
    content_length: Optional[int] = None
    chunks_count: Optional[int] = None
    status: DocStatus
    created_at: str
    updated_at: str
    track_id: Optional[str] = None
    error_msg: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class PaginationInfo(BaseModel):
    """分页信息（对齐前端 PaginationInfo）。"""

    model_config = ConfigDict(extra="ignore")

    page: int
    page_size: int
    total_count: int
    total_pages: int
    has_next: bool
    has_prev: bool


class DocumentsRequest(BaseModel):
    """分页查询请求体（对齐前端 DocumentsRequest，LightRAG POST body）。"""

    page: int = 1
    page_size: int = 10
    status_filter: Optional[str] = None
    status_filters: Optional[List[str]] = None
    sort_field: str = "updated_at"
    sort_direction: str = "desc"


class DocumentsPaginatedResponse(BaseModel):
    """分页查询响应（对齐前端 DocumentsPaginatedResponse）。"""

    model_config = ConfigDict(extra="ignore")

    documents: List[DocStatusResponse]
    pagination: PaginationInfo
    status_counts: Dict[str, int]


class UploadResult(BaseModel):
    """文档上传结果（对齐前端 UploadResult）。"""

    model_config = ConfigDict(extra="ignore")

    status: str  # "success" | "partial_success" | "failure"
    message: str


class ScanResult(BaseModel):
    """扫描/重试结果（对齐前端 ScanResult）。"""

    model_config = ConfigDict(extra="ignore")

    status: str  # "scanning_started" | "scanning_skipped_pipeline_busy" | "scanning_no_new_documents"
    message: str


class DeleteDocumentsRequest(BaseModel):
    """删除指定文档请求体（对齐前端 deleteDocuments 参数）。"""

    doc_ids: List[str]
    delete_file: bool = False
    delete_llm_cache: bool = False


class DeleteDocumentsResult(BaseModel):
    """删除文档结果（对齐前端 DeleteDocumentsResult）。"""

    model_config = ConfigDict(extra="ignore")

    status: str  # "success" | "failure"
    message: str


class ClearDocumentsResult(BaseModel):
    """清空所有文档结果（对齐前端 ClearDocumentsResult）。"""

    model_config = ConfigDict(extra="ignore")

    status: str  # "success" | "failure"
    message: str


class ClearCacheResult(BaseModel):
    """清空 LLM 缓存结果（对齐前端 clearCache 返回）。"""

    model_config = ConfigDict(extra="ignore")

    status: str  # "success" | "fail"
    message: Optional[str] = None


class PipelineStatus(BaseModel):
    """流水线状态（对齐前端 PipelineStatus，LightRAG GET /documents/pipeline_status）。"""

    model_config = ConfigDict(extra="ignore")

    autoscanned: bool = False
    busy: bool = False
    job_name: str = ""
    job_start: Optional[str] = None  # ISO 8601 字符串，无任务时为空
    docs: int = 0
    batchs: int = 0
    cur_batch: int = 0
    request_pending: bool = False
    cancellation_requested: Optional[bool] = None
    latest_message: str = ""
    history_messages: Optional[List[str]] = None
    update_status: Optional[Dict[str, Any]] = None


class CancelPipelineResult(BaseModel):
    """取消流水线结果（对齐前端 CancelPipelineResult）。"""

    model_config = ConfigDict(extra="ignore")

    status: str  # "cancellation_requested" | "not_busy"
    message: Optional[str] = None


class HealthStatus(BaseModel):
    """聚合健康状态（后端自身 + LightRAG）。对齐前端 HealthStatus。"""

    model_config = ConfigDict(extra="ignore")

    status: str = "healthy"  # "healthy" | "error"
    pipeline_busy: bool = False
    auth_mode: Optional[str] = None  # "enabled" | "disabled"
    configuration: Optional[Dict[str, Any]] = None
    message: Optional[str] = None
