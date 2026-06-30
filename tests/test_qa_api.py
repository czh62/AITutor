import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.models.database import Base, SkillNode
from backend.routers import qa


class QaApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)
        Base.metadata.create_all(bind=self.engine)

        app = FastAPI()
        app.include_router(qa.router)

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[qa.get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        self.engine.dispose()

    def add_node(self, node_id="node-1", name="Backpropagation", doc_id="doc-1"):
        db = self.SessionLocal()
        try:
            db.add(
                SkillNode(
                    id=node_id,
                    name=name,
                    description="A training algorithm for neural networks.",
                    parent_ids=[],
                    doc_id=doc_id,
                    status="available",
                    mastery=0,
                )
            )
            db.commit()
        finally:
            db.close()

    async def fake_answer(self, question, context, doc_id=None):
        return {
            "answer": f"fake answer: {question}",
            "sources": [{"doc_id": doc_id}],
            "fallback": False,
        }

    async def failing_answer(self, question, context, doc_id=None):
        raise RuntimeError("internal service exploded")

    def test_ask_returns_200_and_stable_structure(self):
        with mock.patch("backend.routers.qa.generate_answer", self.fake_answer):
            response = self.client.post(
                "/api/qa/ask",
                json={"question": "What is gradient descent?", "doc_id": "doc-1"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.json().keys()),
            {"question", "answer", "doc_id", "sources", "fallback"},
        )
        self.assertEqual(response.json()["question"], "What is gradient descent?")
        self.assertEqual(response.json()["doc_id"], "doc-1")
        self.assertEqual(response.json()["sources"], [{"doc_id": "doc-1"}])
        self.assertFalse(response.json()["fallback"])

    def test_ask_empty_question_returns_400_or_422(self):
        response = self.client.post("/api/qa/ask", json={"question": ""})

        self.assertIn(response.status_code, (400, 422))

    def test_ask_blank_question_returns_400_or_422(self):
        response = self.client.post("/api/qa/ask", json={"question": "   "})

        self.assertIn(response.status_code, (400, 422))

    def test_ask_service_error_returns_stable_502(self):
        with mock.patch("backend.routers.qa.generate_answer", self.failing_answer):
            response = self.client.post("/api/qa/ask", json={"question": "Why?"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "QA service unavailable"})
        self.assertNotIn("internal service exploded", str(response.json()))

    def test_ask_node_returns_200_and_stable_structure(self):
        self.add_node()

        with mock.patch("backend.routers.qa.generate_answer", self.fake_answer):
            response = self.client.post(
                "/api/qa/ask-node/node-1",
                json={"question": "What is the key idea?"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.json().keys()),
            {"node_id", "title", "question", "answer", "sources", "fallback"},
        )
        self.assertEqual(response.json()["node_id"], "node-1")
        self.assertEqual(response.json()["title"], "Backpropagation")
        self.assertEqual(response.json()["question"], "What is the key idea?")
        self.assertEqual(response.json()["sources"], [{"doc_id": "doc-1"}])

    def test_ask_node_missing_node_returns_404(self):
        response = self.client.post(
            "/api/qa/ask-node/missing-node",
            json={"question": "What is this?"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Knowledge point not found"})

    def test_ask_node_empty_question_returns_400_or_422(self):
        self.add_node()

        response = self.client.post("/api/qa/ask-node/node-1", json={"question": ""})

        self.assertIn(response.status_code, (400, 422))

    def test_ask_node_blank_question_returns_400_or_422(self):
        self.add_node()

        response = self.client.post("/api/qa/ask-node/node-1", json={"question": "   "})

        self.assertIn(response.status_code, (400, 422))

    def test_ask_node_service_error_returns_stable_502(self):
        self.add_node()

        with mock.patch("backend.routers.qa.generate_answer", self.failing_answer):
            response = self.client.post(
                "/api/qa/ask-node/node-1",
                json={"question": "Why?"},
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "QA service unavailable"})
        self.assertNotIn("internal service exploded", str(response.json()))

    def test_tests_do_not_call_external_service(self):
        calls = {"count": 0}

        async def tracked_fake_answer(question, context, doc_id=None):
            calls["count"] += 1
            return await self.fake_answer(question, context, doc_id)

        with mock.patch("backend.routers.qa.generate_answer", tracked_fake_answer):
            response = self.client.post("/api/qa/ask", json={"question": "Local only?"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls["count"], 1)


if __name__ == "__main__":
    unittest.main()
