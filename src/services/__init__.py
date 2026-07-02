"""业务服务层。"""

from .lightrag_client import LightRAGClient


def create_lightrag_client() -> LightRAGClient:
    """创建 LightRAG 客户端（使用 app 配置）。在 lifespan 启动时调用一次。"""
    from ..core.config import get_settings

    settings = get_settings()
    return LightRAGClient(
        base_url=settings.lightrag_base_url,
        timeout=settings.lightrag_timeout,
    )
