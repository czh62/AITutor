"""LightRAG HTTP API 异步客户端。

封装所有文档管理端点，返回原始 dict（由 router 层解析为 Pydantic schema）。
httpx 错误转换为 AppException 子类，确保上层可统一处理。
"""

from __future__ import annotations

import httpx
import json

from ..core.config import get_settings
from ..core.exceptions import NotFoundError, ServiceUnavailableError
from ..core.logging import get_logger

logger = get_logger("aitutor.lightrag_client")


class LightRAGClient:
    """LightRAG HTTP API 异步客户端。

    所有方法返回原始 dict，由 api 层解析为对应 Pydantic schema。
    这样 client 层不依赖 schema 定义，保持职责单一。
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float | None = None,
    ):
        settings = get_settings()
        self._base_url = (base_url or settings.lightrag_base_url).rstrip("/")
        self._timeout = timeout or settings.lightrag_timeout
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        """懒创建 httpx.AsyncClient。"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
            )
        return self._client

    async def close(self) -> None:
        """关闭 httpx 客户端连接池。在 app lifespan shutdown 时调用。"""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.info("lightrag client closed")

    # ------------------------------------------------------------------
    #  错误转换
    # ------------------------------------------------------------------

    def _handle_error(self, exc: httpx.HTTPError) -> None:
        """将 httpx 错误转换为 AppException 子类。"""
        if isinstance(exc, httpx.ConnectError):
            raise ServiceUnavailableError("LightRAG 服务不可用，无法建立连接")
        if isinstance(exc, httpx.TimeoutException):
            raise ServiceUnavailableError("LightRAG 请求超时")
        if isinstance(exc, httpx.HTTPStatusError):
            status_code = exc.response.status_code
            if status_code == 404:
                raise NotFoundError("LightRAG 资源不存在")
            if status_code == 409:
                from ..core.exceptions import ConflictError
                raise ConflictError("LightRAG 资源冲突（如文件名重复）")
            raise ServiceUnavailableError(
                f"LightRAG 返回 HTTP {status_code}: {exc.response.text[:200]}"
            )
        raise ServiceUnavailableError(f"LightRAG 请求失败: {exc}")

    # ------------------------------------------------------------------
    #  1. 分页查询文档列表
    # ------------------------------------------------------------------

    async def get_documents_paginated(
        self,
        page: int = 1,
        page_size: int = 10,
        status_filter: str | None = None,
        status_filters: list[str] | None = None,
        sort_field: str = "updated_at",
        sort_direction: str = "desc",
    ) -> dict:
        """POST /documents/paginated — 分页查询文档列表。"""
        body: dict = {
            "page": page,
            "page_size": page_size,
            "sort_field": sort_field,
            "sort_direction": sort_direction,
        }
        if status_filter is not None:
            body["status_filter"] = status_filter
        if status_filters is not None:
            body["status_filters"] = status_filters
        try:
            resp = await self._get_client().post("/documents/paginated", json=body)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  2. 扫描/重试
    # ------------------------------------------------------------------

    async def scan_documents(self) -> dict:
        """POST /documents/scan — 扫描输入目录中的新文档并重试失败文档。"""
        try:
            resp = await self._get_client().post("/documents/scan")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  3. 上传文档
    # ------------------------------------------------------------------

    async def upload_document(
        self,
        file_name: str,
        file_content: bytes,
        content_type: str | None = None,
    ) -> dict:
        """POST /documents/upload — 上传单个文档（multipart/form-data）。

        接收文件名、内容和类型（不涉及磁盘文件），由 httpx 构建 multipart body。
        """
        files = {"file": (file_name, file_content, content_type or "application/octet-stream")}
        try:
            resp = await self._get_client().post("/documents/upload", files=files)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  4. 删除指定文档
    # ------------------------------------------------------------------

    async def delete_documents(
        self,
        doc_ids: list[str],
        delete_file: bool = False,
        delete_llm_cache: bool = False,
    ) -> dict:
        """DELETE /documents/delete_document — 删除指定文档（JSON body）。"""
        body = {
            "doc_ids": doc_ids,
            "delete_file": delete_file,
            "delete_llm_cache": delete_llm_cache,
        }
        try:
            resp = await self._get_client().request(
                "DELETE", "/documents/delete_document", json=body
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  5. 清空所有文档
    # ------------------------------------------------------------------

    async def clear_documents(self) -> dict:
        """DELETE /documents — 清空所有文档。"""
        try:
            resp = await self._get_client().request("DELETE", "/documents")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  6. 清空 LLM 缓存
    # ------------------------------------------------------------------

    async def clear_cache(self) -> dict:
        """POST /documents/clear_cache — 清空 LLM 缓存（独立接口）。"""
        try:
            resp = await self._get_client().post("/documents/clear_cache")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  7. 流水线状态
    # ------------------------------------------------------------------

    async def get_pipeline_status(self) -> dict:
        """GET /documents/pipeline_status — 获取流水线状态。"""
        try:
            resp = await self._get_client().get("/documents/pipeline_status")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  8. 取消流水线
    # ------------------------------------------------------------------

    async def cancel_pipeline(self) -> dict:
        """POST /documents/cancel_pipeline — 请求取消当前流水线任务。"""
        try:
            resp = await self._get_client().post("/documents/cancel_pipeline")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  9. 状态计数
    # ------------------------------------------------------------------

    async def get_status_counts(self) -> dict:
        """GET /documents/status_counts — 获取各状态的文档数量。"""
        try:
            resp = await self._get_client().get("/documents/status_counts")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  10. 健康检查
    # ------------------------------------------------------------------

    async def get_health(self) -> dict:
        """GET /health — LightRAG 健康检查。"""
        try:
            resp = await self._get_client().get("/health")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  11. 知识图谱
    # ------------------------------------------------------------------

    async def get_graph(self, label: str, max_depth: int = 3, max_nodes: int = 1000) -> dict:
        """GET /graphs — 按 label 查询知识图谱（节点+边）。"""
        params = {
            "label": label,
            "max_depth": max_depth,
            "max_nodes": max_nodes,
        }
        try:
            resp = await self._get_client().get("/graphs", params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    async def get_graph_labels(self) -> dict:
        """GET /graph/label/list — 全部实体标签。"""
        try:
            resp = await self._get_client().get("/graph/label/list")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    async def get_popular_labels(self, limit: int = 300) -> dict:
        """GET /graph/label/popular — 热门实体标签。"""
        try:
            resp = await self._get_client().get(
                "/graph/label/popular", params={"limit": limit}
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    async def search_labels(self, query: str, limit: int = 50) -> dict:
        """GET /graph/label/search — 搜索实体标签。"""
        try:
            resp = await self._get_client().get(
                "/graph/label/search", params={"q": query, "limit": limit}
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    # ------------------------------------------------------------------
    #  12. 知识问答
    # ------------------------------------------------------------------

    async def query(self, body: dict) -> dict:
        """POST /query — 非流式查询，返回 {response, references}。"""
        try:
            resp = await self._get_client().post("/query", json=body)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)

    async def query_stream(self, body: dict):
        """POST /query/stream — NDJSON 流式查询，逐行 yield（每行含尾部换行）。

        流式响应 headers 已发送（200），无法再用 _handle_error 抛 AppException
        改状态码；故所有错误转成 NDJSON {"error": "..."} 行，由前端 onError 处理。
        """
        try:
            async with self._get_client().stream(
                "POST", "/query/stream", json=body
            ) as resp:
                if resp.status_code >= 400:
                    yield json.dumps(
                        {"error": f"LightRAG 返回 HTTP {resp.status_code}"},
                        ensure_ascii=False,
                    ) + "\n"
                    return
                async for line in resp.aiter_lines():
                    if line.strip():
                        yield line + "\n"
        except httpx.ConnectError:
            yield json.dumps(
                {"error": "LightRAG 服务不可用，无法建立连接"}, ensure_ascii=False
            ) + "\n"
        except httpx.TimeoutException:
            yield json.dumps(
                {"error": "LightRAG 请求超时"}, ensure_ascii=False
            ) + "\n"
        except httpx.HTTPError as exc:
            yield json.dumps(
                {"error": f"LightRAG 请求失败: {exc}"}, ensure_ascii=False
            ) + "\n"
        except Exception as exc:
            yield json.dumps(
                {"error": f"流式查询中断: {exc}"}, ensure_ascii=False
            ) + "\n"
