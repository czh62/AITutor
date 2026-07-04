import io
import sys
import types
import unittest

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

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

from src.api.documents import upload_document, validate_mastery_upload_file
from src.core.exceptions import ConflictError
from src.core.exceptions import ValidationError
from src.main import create_app
from src.mastery.models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress
from src.schemas.documents import UploadResult


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        ("notes.txt", "text/plain"),
        ("lesson.md", "text/markdown"),
        ("paper.pdf", "application/pdf"),
        (
            "chapter.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    ],
)
def test_validate_mastery_upload_file_accepts_supported_types(filename, content_type):
    validate_mastery_upload_file(filename, content_type)


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        (
            "slides.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        ("image.png", "image/png"),
        ("archive.zip", "application/zip"),
        ("no_extension", "text/plain"),
    ],
)
def test_validate_mastery_upload_file_rejects_unsupported_types(filename, content_type):
    with pytest.raises(ValidationError):
        validate_mastery_upload_file(filename, content_type)


def test_upload_result_preserves_track_id():
    result = UploadResult(status="success", message="ok", track_id="upload_abc")
    assert result.track_id == "upload_abc"


class FakeUploadClient:
    def __init__(self, raw=None, error=None):
        self.raw = raw
        self.error = error
        self.calls = []

    async def upload_document(self, *, file_name, file_content, content_type):
        self.calls.append(
            {
                "file_name": file_name,
                "file_content": file_content,
                "content_type": content_type,
            }
        )
        if self.error is not None:
            raise self.error
        return self.raw


class FakeMasteryRecorder:
    def __init__(self):
        self.calls = []

    def register_upload(self, *, track_id, file_name):
        self.calls.append({"track_id": track_id, "file_name": file_name})


def make_upload_file(name="lesson.md", content_type="text/markdown", content=b"hello"):
    return UploadFile(filename=name, file=io.BytesIO(content), headers={"content-type": content_type})


class UploadDocumentRegistrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_registers_only_for_success_with_track_id(self):
        client = FakeUploadClient(raw={"status": "success", "message": "ok", "track_id": "track-1"})
        mastery = FakeMasteryRecorder()

        result = await upload_document(
            file=make_upload_file(),
            client=client,
            mastery=mastery,
        )

        self.assertEqual(result.track_id, "track-1")
        self.assertEqual(mastery.calls, [{"track_id": "track-1", "file_name": "lesson.md"}])

    async def test_does_not_register_for_partial_success_or_failure(self):
        for status in ("partial_success", "failure"):
            with self.subTest(status=status):
                client = FakeUploadClient(
                    raw={"status": status, "message": "done", "track_id": "track-1"}
                )
                mastery = FakeMasteryRecorder()

                result = await upload_document(
                    file=make_upload_file(),
                    client=client,
                    mastery=mastery,
                )

                self.assertEqual(result.status, status)
                self.assertEqual(mastery.calls, [])

    async def test_does_not_register_when_track_id_missing(self):
        for raw in (
            {"status": "success", "message": "ok"},
            {"status": "success", "message": "ok", "track_id": ""},
        ):
            with self.subTest(raw=raw):
                client = FakeUploadClient(raw=raw)
                mastery = FakeMasteryRecorder()

                result = await upload_document(
                    file=make_upload_file(),
                    client=client,
                    mastery=mastery,
                )

                self.assertEqual(result.status, "success")
                self.assertEqual(mastery.calls, [])

    async def test_does_not_fail_when_mastery_service_absent(self):
        client = FakeUploadClient(raw={"status": "success", "message": "ok", "track_id": "track-1"})

        result = await upload_document(
            file=make_upload_file(),
            client=client,
            mastery=None,
        )

        self.assertEqual(result.track_id, "track-1")

    async def test_conflict_does_not_create_mastery_build_job(self):
        client = FakeUploadClient(error=ConflictError("LightRAG 资源冲突（如文件名重复）"))
        mastery = FakeMasteryRecorder()

        with self.assertRaises(ConflictError):
            await upload_document(
                file=make_upload_file(),
                client=client,
                mastery=mastery,
            )

        self.assertEqual(mastery.calls, [])


class FakeMasteryService:
    def __init__(self):
        kp = KnowledgePoint(
            id="doc-1_m0_kp0",
            name="变量",
            type=KnowledgeType.CONCEPT,
            module_id="doc-1_m0",
            description="变量",
        )
        module = LearningModule(id="doc-1_m0", name="基础", order=0, knowledge_points=[kp])
        self.progress = LearningProgress(
            doc_id="doc-1",
            title="文档",
            build_status="ready",
            rag_status="processed",
            modules=[module],
        )

    def list_documents(self):
        return [
            {
                "doc_id": "doc-1",
                "title": "文档",
                "source_file": "source.md",
                "rag_status": "processed",
                "build_status": "ready",
            }
        ]

    def get_document(self, doc_id):
        if doc_id == "missing":
            return None
        return self.progress

    def get_document_payload(self, doc_id):
        return {
            "doc_id": doc_id,
            "title": "文档",
            "rag_status": "processed",
            "build_status": "ready",
            "map": {
                "counts": {"total": 1, "mastered": 0, "learning": 0, "new": 1},
                "modules": [],
            },
            "next": {"action": "probe"},
        }

    def assess(self, doc_id, kp_id, *, passed, feedback=""):
        return {
            "passed": passed,
            "next": {"action": "complete"},
            "map": {"counts": {"total": 1, "mastered": 1, "learning": 0, "new": 0}},
        }


def test_mastery_documents_route_lists_documents():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    response = client.get("/mastery/documents")
    assert response.status_code == 200
    assert response.json()["documents"][0]["doc_id"] == "doc-1"


def test_mastery_document_detail_route_returns_payload():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    response = client.get("/mastery/documents/doc-1")
    assert response.status_code == 200
    assert response.json()["next"]["action"] == "probe"


def test_mastery_document_detail_route_404_for_missing_doc():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    response = client.get("/mastery/documents/missing")
    assert response.status_code == 404


def test_mastery_assess_route_accepts_knowledge_point_id_in_body():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    response = client.post(
        "/mastery/documents/doc-1/assess",
        json={"knowledge_point_id": "doc-1_m0_kp0", "passed": True, "feedback": "ok"},
    )
    assert response.status_code == 200
    assert response.json()["passed"] is True
