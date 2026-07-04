from __future__ import annotations

import json
import re
from typing import Any

from .models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress

SYSTEM_PROMPT = """你是学习路线设计器。请根据完整文档构建覆盖全面、依赖清晰的知识树。
只输出 JSON，不要输出解释。知识点 type 只能是 memory、concept、procedure、design。"""

USER_TEMPLATE = """请为以下文档构建 Mastery Path 知识树。

文件名：{source_file}

文档全文：
{text}

输出 JSON 结构：
{{
  "title": "文档学习路线",
  "summary": "整体学习说明",
  "modules": [
    {{
      "name": "模块名",
      "description": "模块说明",
      "knowledge_points": [
        {{
          "name": "知识点",
          "type": "memory|concept|procedure|design",
          "description": "学什么、为什么重要",
          "dependencies": ["前置知识点名称"]
        }}
      ]
    }}
  ]
}}
"""


def normalize_tree_payload(doc_id: str, source_file: str, payload: dict[str, Any]) -> LearningProgress:
    title = str(payload.get("title") or source_file or doc_id)
    progress = LearningProgress(
        doc_id=doc_id,
        title=title,
        source_file=source_file,
        rag_status="processed",
        build_status="ready",
    )

    name_to_id: dict[str, str] = {}
    pending_dependencies: list[tuple[KnowledgePoint, list[str]]] = []
    modules: list[LearningModule] = []

    for module_index, module_data in enumerate(_as_list(payload.get("modules"))):
        if not isinstance(module_data, dict):
            continue
        module_id = f"{doc_id}_m{module_index}"
        points: list[KnowledgePoint] = []
        for kp_index, kp_data in enumerate(_as_list(module_data.get("knowledge_points"))):
            if not isinstance(kp_data, dict):
                continue
            kp_id = f"{module_id}_kp{kp_index}"
            kp_type = _coerce_knowledge_type(kp_data.get("type"))
            kp = KnowledgePoint(
                id=kp_id,
                name=str(kp_data.get("name") or f"知识点 {kp_index + 1}"),
                type=kp_type,
                module_id=module_id,
                description=str(kp_data.get("description") or ""),
            )
            points.append(kp)
            progress.knowledge_types[kp_id] = kp_type
            name_to_id[kp.name] = kp_id
            pending_dependencies.append((kp, [str(item) for item in _as_list(kp_data.get("dependencies"))]))
        modules.append(
            LearningModule(
                id=module_id,
                name=str(module_data.get("name") or f"模块 {module_index + 1}"),
                order=module_index,
                description=str(module_data.get("description") or ""),
                knowledge_points=points,
            )
        )

    for kp, dependency_names in pending_dependencies:
        resolved: list[str] = []
        for name in dependency_names:
            dependency_id = name_to_id.get(name)
            if dependency_id is None:
                progress.build_warnings.append(f"未找到依赖：{name}")
                continue
            if dependency_id != kp.id:
                resolved.append(dependency_id)
        kp.dependencies = resolved

    progress.modules = modules
    return progress


class MasteryBuilder:
    def __init__(self, llm: Any, max_source_chars: int) -> None:
        self._llm = llm
        self._max_source_chars = max_source_chars

    async def build_from_text(self, doc_id: str, source_file: str, text: str) -> LearningProgress:
        source_text = (text or "").strip()
        if not source_text:
            raise ValueError("empty_content")
        if len(source_text) > self._max_source_chars:
            raise ValueError("document_too_large")

        raw = await self._llm.call(
            SYSTEM_PROMPT,
            USER_TEMPLATE.format(source_file=source_file, text=source_text),
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=4096,
        )
        payload = _parse_json_payload(raw)
        return normalize_tree_payload(doc_id, source_file, payload)


def _parse_json_payload(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("invalid_tree_payload")
    return data


def _coerce_knowledge_type(value: Any) -> KnowledgeType:
    try:
        return KnowledgeType(str(value or "").strip().lower())
    except ValueError:
        return KnowledgeType.CONCEPT


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []
