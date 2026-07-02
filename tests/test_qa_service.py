from __future__ import annotations

import unittest
from typing import Any

from src.services.qa_service import TeachingQAService


class FakeQueryClient:
    def __init__(self, response: dict[str, Any] | None = None, error: Exception | None = None):
        self.response = response or {}
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def query(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(body)
        if self.error is not None:
            raise self.error
        return self.response


class TeachingQAServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_ask_normalizes_answer_field(self):
        client = FakeQueryClient({"answer": "Use retrieval first.", "references": [{"id": "doc-1"}]})
        service = TeachingQAService(client)

        result = await service.ask("  What should I study?  ", mode="hybrid", top_k=3)

        self.assertEqual(result["answer"], "Use retrieval first.")
        self.assertEqual(result["references"], [{"id": "doc-1"}])
        self.assertEqual(result["mode"], "hybrid")
        self.assertEqual(result["top_k"], 3)
        self.assertEqual(
            client.calls,
            [{"query": "What should I study?", "mode": "hybrid", "top_k": 3, "stream": False}],
        )

    async def test_ask_accepts_response_field(self):
        client = FakeQueryClient({"response": "Review the prerequisite concept."})
        service = TeachingQAService(client)

        result = await service.ask("next step?")

        self.assertEqual(result["answer"], "Review the prerequisite concept.")
        self.assertEqual(result["references"], [])

    async def test_ask_accepts_content_field(self):
        client = FakeQueryClient({"content": "Practice with a short quiz."})
        service = TeachingQAService(client)

        result = await service.ask("how to practice?")

        self.assertEqual(result["answer"], "Practice with a short quiz.")

    async def test_ask_accepts_sources_field(self):
        client = FakeQueryClient({"answer": "From sources.", "sources": [{"file_path": "a.md"}]})
        service = TeachingQAService(client)

        result = await service.ask("source?")

        self.assertEqual(result["references"], [{"file_path": "a.md"}])

    async def test_ask_accepts_citations_field(self):
        client = FakeQueryClient({"answer": "From citations.", "citations": [{"reference_id": "r1"}]})
        service = TeachingQAService(client)

        result = await service.ask("citation?")

        self.assertEqual(result["references"], [{"reference_id": "r1"}])

    async def test_ask_rejects_empty_question(self):
        service = TeachingQAService(FakeQueryClient())

        with self.assertRaises(ValueError):
            await service.ask("   ")

    async def test_ask_propagates_client_exception(self):
        service = TeachingQAService(FakeQueryClient(error=RuntimeError("client failed")))

        with self.assertRaisesRegex(RuntimeError, "client failed"):
            await service.ask("why?")
