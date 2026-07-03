import json
import sys
import types
import unittest
from collections.abc import AsyncIterator


if "pydantic_settings" not in sys.modules:
    pydantic_settings = types.ModuleType("pydantic_settings")

    class BaseSettings:
        def __init__(self, **kwargs):
            for cls in reversed(type(self).mro()):
                for name in getattr(cls, "__annotations__", {}):
                    if not hasattr(type(self), name):
                        continue
                    value = getattr(type(self), name)
                    default_factory = getattr(value, "default_factory", None)
                    if default_factory is not None:
                        value = default_factory()
                    elif value.__class__.__name__ == "FieldInfo":
                        value = getattr(value, "default", None)
                    setattr(self, name, value)
            for name, value in kwargs.items():
                setattr(self, name, value)

    def SettingsConfigDict(**kwargs):
        return kwargs

    pydantic_settings.BaseSettings = BaseSettings
    pydantic_settings.SettingsConfigDict = SettingsConfigDict
    sys.modules["pydantic_settings"] = pydantic_settings


if "openai" not in sys.modules:
    openai = types.ModuleType("openai")

    class AsyncOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def close(self):
            return None

    openai.AsyncOpenAI = AsyncOpenAI
    sys.modules["openai"] = openai


from src.schemas.query import QueryRequest, ResumeRequest
from src.services.llm_client import LLMStreamChunk
from src.services.query_service import QueryService
from src.services.search_types import SearchCitation, SearchResponse, SearchResult


class FakeLightRAG:
    def __init__(self):
        self.calls = []

    async def query_context(self, body):
        self.calls.append(body)
        return {
            "response": "fixed context",
            "references": [
                {
                    "reference_id": "ref-1",
                    "file_path": "doc.md",
                    "content": ["first"],
                }
            ],
        }


class FakeLLM:
    def __init__(self, scripts=None):
        self.scripts = scripts or [[LLMStreamChunk(type="content", content="hello "), LLMStreamChunk(type="content", content="world")]]
        self.stream_calls = []

    async def stream_with_tools(
        self,
        system_prompt,
        messages,
        tools=None,
        temperature=0.3,
        max_tokens=4096,
    ):
        self.stream_calls.append(
            {
                "system_prompt": system_prompt,
                "messages": messages,
                "tools": tools,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        )
        index = min(len(self.stream_calls) - 1, len(self.scripts) - 1)
        for chunk in self.scripts[index]:
            yield chunk


class FakeSearch:
    def __init__(self):
        self.calls = []

    async def search(self, query, max_results=None):
        self.calls.append({"query": query, "max_results": max_results})
        return SearchResponse(
            query=query,
            answer="",
            provider="fake",
            citations=[
                SearchCitation(
                    id=1,
                    url="https://example.test/result",
                    title="Example",
                    snippet="Search snippet",
                )
            ],
            search_results=[
                SearchResult(
                    title="Example",
                    url="https://example.test/result",
                    snippet="Search snippet",
                )
            ],
        )


class FakeMemory:
    def __init__(self):
        self.created_sessions = []
        self.traces = []
        self.consolidated_sessions = []
        self.paused = None
        self.cleared_sessions = []

    def create_session(self, session_id):
        self.created_sessions.append(session_id)

    async def get_memory_context(self, session_id):
        return f"memory for {session_id}"

    def append_trace(self, session_id, entry):
        self.traces.append((session_id, entry))

    def save_paused_context(self, session_id, snapshot, round_num):
        self.paused = (session_id, snapshot, round_num)

    def load_paused_context(self, session_id):
        return None

    def clear_paused_context(self, session_id):
        self.cleared_sessions.append(session_id)

    async def consolidate(self, session_id):
        self.consolidated_sessions.append(session_id)


class ScriptedQueryService(QueryService):
    def __init__(self, lines):
        self.lines = lines

    async def _stream(self) -> AsyncIterator[str]:
        for line in self.lines:
            yield json.dumps(line) + "\n"

    def query_stream(self, request):
        return self._stream()


def tool_call_chunk(name, arguments):
    return LLMStreamChunk(
        type="tool_call_delta",
        tool_call_delta={
            "index": 0,
            "id": f"call-{name}",
            "name": name,
            "arguments_delta": json.dumps(arguments),
        },
    )


class QueryServiceTests(unittest.IsolatedAsyncioTestCase):
    def make_service(self, llm=None, search=None, memory=None):
        return QueryService(
            lightrag_client=FakeLightRAG(),
            llm_client=llm or FakeLLM(),
            search_client=search,
            memory_manager=memory,
        )

    async def test_query_aggregates_content(self):
        service = self.make_service(
            llm=FakeLLM(
                scripts=[
                    [
                        LLMStreamChunk(type="content", content="alpha"),
                        LLMStreamChunk(type="content", content=" beta"),
                    ]
                ]
            )
        )

        response = await service.query(QueryRequest(query="explain algebra"))

        self.assertEqual(response.response, "alpha beta")

    async def test_query_deduplicates_and_normalizes_references(self):
        service = ScriptedQueryService(
            [
                {"type": "content", "content": "answer", "metadata": {}},
                {
                    "type": "sources",
                    "content": "",
                    "metadata": {
                        "sources": [
                            {"id": "ref-1", "file_path": "doc.md", "snippet": "first"},
                            {"id": "ref-1", "file_path": "doc.md", "snippet": "duplicate"},
                        ]
                    },
                },
                {
                    "type": "references",
                    "content": "",
                    "metadata": {
                        "references": [
                            {
                                "reference_id": "ref-2",
                                "file_path": "other.md",
                                "content": "second",
                            }
                        ]
                    },
                },
                {
                    "type": "result",
                    "content": "",
                    "metadata": {"rounds": 2, "completed": True},
                },
            ]
        )

        response = await service.query(QueryRequest(query="explain algebra"))

        self.assertEqual(response.response, "answer")
        self.assertEqual([ref.reference_id for ref in response.references], ["ref-1", "ref-2"])
        self.assertEqual(response.references[0].content, ["first"])
        self.assertEqual(response.references[1].content, ["second"])

    async def test_query_builds_loop_trace(self):
        service = self.make_service()

        response = await service.query(QueryRequest(query="explain algebra"))

        self.assertIsNotNone(response.loop_trace)
        self.assertEqual(response.loop_trace.engine, "agent_loop")
        self.assertTrue(response.loop_trace.completed)
        self.assertEqual(response.loop_trace.rounds, 1)
        self.assertEqual(response.loop_trace.steps, [])

    async def test_query_stream_returns_ndjson_events(self):
        service = self.make_service()

        events = []
        async for line in service.query_stream(QueryRequest(query="explain algebra")):
            events.append(json.loads(line))

        event_types = [event["type"] for event in events]
        self.assertGreater(len(events), 0)
        self.assertEqual(event_types[0], "session")
        self.assertIn("stage_start", event_types)
        self.assertIn("content", event_types)
        self.assertEqual(event_types[-1], "done")

    async def test_search_not_called_without_tool_call(self):
        search = FakeSearch()
        service = self.make_service(search=search)

        await service.query(QueryRequest(query="explain algebra"))

        self.assertEqual(search.calls, [])

    async def test_force_web_search_can_use_search_tool_call(self):
        search = FakeSearch()
        llm = FakeLLM(
            scripts=[
                [tool_call_chunk("web_search", {"query": "latest algebra news"})],
                [LLMStreamChunk(type="content", content="searched answer")],
            ]
        )
        service = self.make_service(llm=llm, search=search)

        response = await service.query(
            QueryRequest(query="explain algebra", force_web_search=True)
        )

        self.assertEqual(response.response, "searched answer")
        self.assertEqual(len(search.calls), 1)
        self.assertEqual(search.calls[0]["query"], "latest algebra news")
        self.assertIsNotNone(response.references)
        self.assertEqual(response.references[0].reference_id, "https://example.test/result")

    async def test_session_id_and_memory_manager_are_used(self):
        memory = FakeMemory()
        service = self.make_service(memory=memory)

        response = await service.query(
            QueryRequest(query="explain algebra", session_id="sid-1")
        )

        self.assertEqual(response.response, "hello world")
        self.assertEqual(memory.created_sessions, ["sid-1"])
        self.assertIn(("sid-1", {"kind": "user_message", "content": "explain algebra"}), memory.traces)
        self.assertIn(("sid-1", {"kind": "answer", "content": "hello world"}), memory.traces)
        self.assertEqual(memory.consolidated_sessions, ["sid-1"])

    async def test_resume_stream_returns_ndjson_events(self):
        memory = FakeMemory()
        service = self.make_service(memory=memory)

        events = []
        async for line in service.resume_stream(
            ResumeRequest(session_id="missing", answers={"q1": "answer"})
        ):
            events.append(json.loads(line))

        self.assertEqual([event["type"] for event in events], ["error", "done"])


if __name__ == "__main__":
    unittest.main()
