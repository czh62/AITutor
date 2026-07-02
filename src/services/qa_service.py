"""Teaching question-answering service.

This layer keeps teaching-oriented response normalization outside API routers.
It accepts a LightRAGClient-like object so tests and future callers can inject a
fake client without touching real LightRAG, LLM, embedding, or external APIs.
"""

from __future__ import annotations

from typing import Any, Mapping, Protocol


class QueryClient(Protocol):
    """Minimal client contract required by TeachingQAService."""

    async def query(self, body: dict[str, Any]) -> Mapping[str, Any]:
        """Run a non-streaming query and return a LightRAG-like payload."""


class TeachingQAService:
    """Business service for teaching QA over a LightRAG-compatible client."""

    def __init__(self, client: QueryClient):
        self._client = client

    async def ask(self, question: str, mode: str = "hybrid", top_k: int = 5) -> dict[str, Any]:
        """Ask a non-streaming teaching question and normalize common response shapes.

        Recognized answer fields: answer, response, content.
        Recognized reference fields: references, sources, citations.
        """
        normalized_question = question.strip()
        if not normalized_question:
            raise ValueError("question must not be empty")

        raw = await self._client.query(
            {
                "query": normalized_question,
                "mode": mode,
                "top_k": top_k,
                "stream": False,
            }
        )

        return {
            "answer": self._extract_text(raw, ("answer", "response", "content")),
            "references": self._extract_references(raw, ("references", "sources", "citations")),
            "mode": mode,
            "top_k": top_k,
        }

    @staticmethod
    def _first_present(payload: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return None

    @classmethod
    def _extract_text(cls, payload: Mapping[str, Any], keys: tuple[str, ...]) -> str:
        value = cls._first_present(payload, keys)
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)

    @classmethod
    def _extract_references(cls, payload: Mapping[str, Any], keys: tuple[str, ...]) -> list[Any]:
        value = cls._first_present(payload, keys)
        if value is None:
            return []
        if isinstance(value, list):
            return value
        return [value]
