"""Query orchestration service."""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from ..agentloop.loop import AgentLoop
from ..schemas.query import LoopTrace, QueryRequest, QueryResponse, ReferenceItem, ResumeRequest
from .lightrag_client import LightRAGClient
from .llm_client import LLMClient
from .search_client import SearchClient


class QueryService:
    """Runs AgentLoop queries and adapts stream events into API responses."""

    def __init__(
        self,
        lightrag_client: LightRAGClient,
        llm_client: LLMClient,
        search_client: SearchClient | None = None,
        memory_manager: Any | None = None,
    ):
        self.lightrag = lightrag_client
        self.llm = llm_client
        self.search = search_client
        self.memory = memory_manager

    def _create_loop(self) -> AgentLoop:
        return AgentLoop(
            llm_client=self.llm,
            lightrag_client=self.lightrag,
            search_client=self.search,
            memory_manager=self.memory,
        )

    async def query(self, request: QueryRequest) -> QueryResponse:
        """Run AgentLoop and aggregate NDJSON events into QueryResponse."""
        response_text = ""
        references: list[dict[str, Any]] = []
        rounds_done = 0
        completed = False

        async for line in self.query_stream(request):
            try:
                event = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            event_type = event.get("type", "")
            content = event.get("content", "")
            metadata = event.get("metadata", {})

            if event_type == "content":
                response_text += content
            elif event_type in ("references", "sources"):
                refs = metadata.get("references") or metadata.get("sources") or []
                for ref in refs:
                    rid = ref.get("reference_id") or ref.get("id")
                    if not any(
                        (existing.get("reference_id") or existing.get("id")) == rid
                        for existing in references
                    ):
                        references.append(ref)
            elif event_type == "result":
                rounds_done = metadata.get("rounds", 0)
                completed = metadata.get("completed", False)

        norm_refs = [_normalize_reference(ref) for ref in references]
        loop_trace = LoopTrace(
            rounds=rounds_done,
            steps=[],
            completed=completed,
            engine="agent_loop",
        )

        return QueryResponse(
            response=response_text,
            references=[ReferenceItem(**ref) for ref in norm_refs if ref],
            loop_trace=loop_trace,
        )

    def query_stream(self, request: QueryRequest) -> AsyncIterator[str]:
        """Return the AgentLoop NDJSON stream unchanged."""
        loop = self._create_loop()
        return loop.run_stream(
            query=request.query,
            mode=request.mode,
            force_web_search=request.force_web_search,
            session_id=request.session_id,
        )

    def resume_stream(self, request: ResumeRequest) -> AsyncIterator[str]:
        """Return the AgentLoop resume NDJSON stream unchanged."""
        loop = self._create_loop()
        return loop.resume_stream(
            session_id=request.session_id,
            answers=request.answers,
        )


def _normalize_reference(ref: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize sources/references into ReferenceItem-compatible fields."""
    if not isinstance(ref, dict):
        return None
    rid = ref.get("reference_id") or ref.get("id")
    # 无标识的引用不可追踪，丢弃
    if not rid:
        return None
    fpath = ref.get("file_path")
    content = ref.get("content")
    if content is None:
        content = [ref.get("snippet", "")] if ref.get("snippet") else None
    elif isinstance(content, str):
        content = [content]
    return {"reference_id": rid, "file_path": fpath, "content": content}
