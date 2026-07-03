"""业务服务层。"""

from .lightrag_client import LightRAGClient
from .llm_client import LLMClient
from .search_client import SearchClient


def create_lightrag_client() -> LightRAGClient:
    """创建 LightRAG 客户端（使用 app 配置）。在 lifespan 启动时调用一次。"""
    from ..core.config import get_settings

    settings = get_settings()
    return LightRAGClient(
        base_url=settings.lightrag_base_url,
        timeout=settings.lightrag_timeout,
    )


def create_llm_client() -> LLMClient:
    """创建 LLM 客户端（使用 app 配置 + .env LLM 变量）。在 lifespan 启动时调用一次。"""
    from ..core.config import get_settings

    settings = get_settings()
    return LLMClient(
        base_url=settings.llm_binding_host,
        api_key=settings.llm_binding_api_key,
        model=settings.llm_model,
    )


def create_search_client() -> SearchClient | None:
    """创建联网搜索客户端（DuckDuckGo 零配置）。在 lifespan 启动时调用一次。

    如果 search_enabled=False，返回 None（不启用联网搜索）。
    """
    from ..core.config import get_settings

    settings = get_settings()
    if not settings.search_enabled:
        return None
    return SearchClient(
        max_results=settings.search_max_results,
    )
