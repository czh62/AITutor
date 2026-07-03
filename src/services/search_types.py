"""联网搜索结果数据类型。

简化版 DeepTutor services/search/types.py，仅保留 DuckDuckGo 需要的核心类型。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SearchCitation:
    """单条联网搜索引用（对齐 DeepTutor Citation，简化版）。"""

    id: int
    url: str
    title: str = ""
    snippet: str = ""


@dataclass
class SearchResult:
    """单条搜索结果项（对齐 DeepTutor SearchResult，简化版）。"""

    title: str
    url: str
    snippet: str


@dataclass
class SearchResponse:
    """联网搜索标准化响应（对齐 DeepTutor WebSearchResponse，简化版）。

    DuckDuckGo 不生成 answer，该字段始终为空。
    """

    query: str
    answer: str  # DuckDuckGo 无 answer，始终为空字符串
    provider: str  # "duckduckgo"
    citations: list[SearchCitation] = field(default_factory=list)
    search_results: list[SearchResult] = field(default_factory=list)


__all__ = ["SearchCitation", "SearchResult", "SearchResponse"]
