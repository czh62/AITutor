"""健康检查与根信息。

/health 端点聚合后端自身状态与 LightRAG 健康信息。
LightRAG 不可用时返回降级响应（status="error"），而非 500。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..core.config import get_settings
from ..core.exceptions import ServiceUnavailableError
from ..core.logging import get_logger
from ..schemas.common import HealthResponse
from ..schemas.documents import HealthStatus
from ..services.lightrag_client import LightRAGClient

logger = get_logger("aitutor.health")

router = APIRouter()


def get_lightrag_client(request: Request) -> LightRAGClient:
    """从 app.state 获取 LightRAGClient。"""
    return request.app.state.lightrag_client


@router.get("/health", response_model=HealthStatus)
async def health(client: LightRAGClient = Depends(get_lightrag_client)):
    """聚合健康检查：后端 + LightRAG。

    LightRAG 不可用时返回降级响应，前端可据此提示用户。
    """
    try:
        lightrag_health = await client.get_health()
        return HealthStatus(
            status=lightrag_health.get("status", "healthy"),
            pipeline_busy=lightrag_health.get("pipeline_busy", False),
            auth_mode=lightrag_health.get("auth_mode"),
            configuration=lightrag_health.get("configuration"),
        )
    except ServiceUnavailableError as exc:
        logger.warning(f"LightRAG health check failed: {exc.detail}")
        return HealthStatus(
            status="error",
            pipeline_busy=False,
            message=exc.detail,
        )


@router.get("/")
async def root() -> dict:
    settings = get_settings()
    return {
        "message": settings.app_name,
        "version": settings.app_version,
        "status": "running",
    }
