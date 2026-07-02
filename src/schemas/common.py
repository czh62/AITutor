"""通用响应 schema。"""

from __future__ import annotations

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """统一错误响应。"""

    detail: str
    code: str = "internal_error"


class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str
