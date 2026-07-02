"""知识图谱相关 Pydantic schema。

与前端 frontend/src/api/types.ts 的 GraphNode/GraphEdge/GraphData 对齐。
所有 response model 使用 ConfigDict(extra="ignore")，容忍 LightRAG 返回未知字段。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class GraphNode(BaseModel):
    """图谱节点（对齐前端 GraphNode）。"""

    model_config = ConfigDict(extra="ignore")

    id: str
    labels: List[str] = []
    properties: Dict[str, Any] = {}


class GraphEdge(BaseModel):
    """图谱边（对齐前端 GraphEdge）。"""

    model_config = ConfigDict(extra="ignore")

    id: str
    source: str
    target: str
    type: Optional[str] = None
    properties: Dict[str, Any] = {}


class GraphData(BaseModel):
    """图谱数据（对齐前端 GraphData，LightRAG GET /graphs 响应）。"""

    model_config = ConfigDict(extra="ignore")

    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
