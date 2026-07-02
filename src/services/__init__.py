"""业务服务层。"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .qa_service import TeachingQAService

if TYPE_CHECKING:
    from .lightrag_client import LightRAGClient

__all__ = ["LightRAGClient", "TeachingQAService", "create_lightrag_client"]


def __getattr__(name: str) -> Any:
    if name == "LightRAGClient":
        from .lightrag_client import LightRAGClient

        return LightRAGClient
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def create_lightrag_client() -> LightRAGClient:
    """创建 LightRAG 客户端（使用 app 配置）。在 lifespan 启动时调用一次。"""
    from ..core.config import get_settings
    from .lightrag_client import LightRAGClient

    settings = get_settings()
    return LightRAGClient(
        base_url=settings.lightrag_base_url,
        timeout=settings.lightrag_timeout,
    )
