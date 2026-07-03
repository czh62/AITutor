"""联网搜索客户端 — DuckDuckGo 零配置搜索引擎。

参考 DeepTutor services/search/providers/duckduckgo.py，但改为异步版本
（使用 asyncio.to_thread 包装同步 ddgs 调用）。

无需 API key，无需外部服务，零配置即可使用。
"""

from __future__ import annotations

import asyncio
import logging

from .search_types import SearchCitation, SearchResult, SearchResponse

logger = logging.getLogger("aitutor.search_client")


class SearchClient:
    """DuckDuckGo 联网搜索客户端。

    使用 ddgs 库进行搜索，零配置无需 API key。
    同步 ddgs 调用通过 asyncio.to_thread 包装为异步接口。
    """

    def __init__(
        self,
        max_results: int = 5,
        proxy: str | None = None,
    ) -> None:
        self.max_results = max_results
        self.proxy = proxy

    async def search(
        self,
        query: str,
        max_results: int | None = None,
    ) -> SearchResponse:
        """异步执行 DuckDuckGo 搜索，返回标准化结果。

        同步 ddgs 调用通过 asyncio.to_thread 在线程池中运行，
        避免阻塞 asyncio 事件循环。
        """
        count = max_results or self.max_results
        try:
            result = await asyncio.to_thread(self._search_sync, query, count)
            return result
        except Exception as exc:
            logger.error("DuckDuckGo search failed for query '%s': %s", query[:50], exc)
            # 返回空结果而非抛异常，不影响主流程
            return SearchResponse(
                query=query,
                answer="",
                provider="duckduckgo",
                citations=[],
                search_results=[],
            )

    def _search_sync(self, query: str, max_results: int) -> SearchResponse:
        """同步 DuckDuckGo 搜索（在线程池中运行）。

        实现逻辑对齐 DeepTutor DuckDuckGoProvider.search()，
        但返回 AITutor 简化版 SearchResponse。
        """
        from ddgs import DDGS

        count = max(1, min(int(max_results), 10))
        ddgs = DDGS(proxy=self.proxy, timeout=20)
        rows = list(ddgs.text(query, max_results=count) or [])

        citations: list[SearchCitation] = []
        search_results: list[SearchResult] = []

        for idx, row in enumerate(rows, 1):
            title = str(row.get("title", ""))
            url = str(row.get("href", ""))
            snippet = str(row.get("body", ""))
            search_results.append(SearchResult(title=title, url=url, snippet=snippet))
            citations.append(SearchCitation(id=idx, url=url, title=title, snippet=snippet))

        logger.info(
            "DuckDuckGo search: query='%s', results=%d",
            query[:50],
            len(search_results),
        )

        return SearchResponse(
            query=query,
            answer="",  # DuckDuckGo 不生成 answer
            provider="duckduckgo",
            citations=citations,
            search_results=search_results,
        )

    async def close(self) -> None:
        """关闭客户端。DuckDuckGo 无需关闭连接池，此方法为空操作。"""
        pass


__all__ = ["SearchClient"]
