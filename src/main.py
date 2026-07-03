"""FastAPI 应用工厂。

启动：uvicorn src.main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.documents import router as documents_router
from .api.graph import router as graph_router
from .api.health import router as health_router
from .api.query import router as query_router
from .api.quiz import router as quiz_router
from .core.config import get_settings
from .core.exceptions import AppException
from .core.logging import get_logger, setup_logging
from .core.middleware import RequestIdMiddleware, RequestLoggingMiddleware
from .db.session import init_db, reset_database
from .services import (
    create_lightrag_client,
    create_llm_client,
    create_memory_manager,
    create_quiz_service,
    create_search_client,
)

setup_logging()
logger = get_logger("aitutor.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时重置数据库（清空旧数据文件）再建表，然后创建 LightRAGClient；shutdown 时关闭客户端。"""
    logger.info("resetting database (drop existing data file)")
    reset_database()
    logger.info("initializing database (create tables if missing)")
    init_db()

    # 创建 LightRAGClient 和 LLMClient，存到 app.state，供路由层依赖注入
    lightrag_client = create_lightrag_client()
    app.state.lightrag_client = lightrag_client
    logger.info("lightrag client created, base_url=%s", lightrag_client._base_url)

    llm_client = create_llm_client()
    app.state.llm_client = llm_client
    logger.info("LLM client created, model=%s, base_url=%s", llm_client._model, llm_client._base_url)

    # 创建 SearchClient（联网搜索），存到 app.state
    search_client = create_search_client()
    app.state.search_client = search_client
    if search_client:
        logger.info("search client created, provider=duckduckgo, max_results=%d", search_client.max_results)
    else:
        logger.info("search client disabled (search_enabled=False)")

    # 创建 MemoryManager（记忆系统），存到 app.state
    memory_manager = create_memory_manager(llm_client)
    app.state.memory_manager = memory_manager
    logger.info("memory manager created")

    # 创建 QuizService（出题服务），存到 app.state
    quiz_service = create_quiz_service(llm_client, lightrag_client)
    app.state.quiz_service = quiz_service
    logger.info("quiz service created")

    logger.info("application startup complete")
    yield

    await lightrag_client.close()
    await llm_client.close()
    if search_client:
        await search_client.close()
    logger.info("application shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="AI 辅助教学系统 API",
        lifespan=lifespan,
    )

    # 中间件（顺序：后添加的先执行外层；日志需在最外层，故最后添加）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(RequestIdMiddleware)

    # 统一异常处理
    register_exception_handlers(app)

    # 路由
    app.include_router(health_router, tags=["meta"])
    app.include_router(documents_router)
    app.include_router(graph_router)
    app.include_router(query_router)
    app.include_router(quiz_router)

    return app


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def handle_app_exception(_: FastAPI, exc: AppException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(_: FastAPI, exc: Exception):
        # 不向客户端泄露内部错误信息
        logger.exception("unhandled exception", extra={"exc_type": type(exc).__name__})
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "code": "internal_error"},
        )


app = create_app()
