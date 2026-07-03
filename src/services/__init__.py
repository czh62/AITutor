"""业务服务层。"""

from .lightrag_client import LightRAGClient
from .llm_client import LLMClient
from .query_service import QueryService
from .search_client import SearchClient
from .quiz_service import QuizService


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


def create_quiz_service(llm_client: LLMClient, lightrag_client: LightRAGClient) -> QuizService:
    """创建出题服务（依赖注入 LLMClient + LightRAGClient）。在 lifespan 启动时调用一次。"""
    return QuizService(llm=llm_client, lightrag=lightrag_client)


def create_memory_manager(llm_client: LLMClient) -> "MemoryManager":
    """创建记忆管理器（L1 追踪 + L2 摘要，SQLite 存储）。在 lifespan 启动时调用一次。"""
    from ..agentloop.memory import MemoryManager
    from ..db.session import SessionLocal

    return MemoryManager(db=SessionLocal, llm=llm_client)
