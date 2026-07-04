from __future__ import annotations

import asyncio

import pytest

from src.mastery.builder import MasteryBuilder, normalize_tree_payload
from src.mastery.extractors import extract_document_text
from src.mastery.models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress
from src.mastery.service import MasteryService
from src.mastery.storage import BuildJob, MasteryStore


def test_store_round_trips_progress(tmp_path):
    store = MasteryStore(root=tmp_path)
    progress = LearningProgress(doc_id="doc-abc", title="测试")
    store.save_progress(progress)
    loaded = store.load_progress("doc-abc")
    assert loaded is not None
    assert loaded.doc_id == "doc-abc"
    assert loaded.version == 1


def test_store_round_trips_build_job(tmp_path):
    store = MasteryStore(root=tmp_path)
    job = BuildJob(track_id="upload_abc", file_name="source.md")
    store.save_build_job(job)
    loaded = store.load_build_job("upload_abc")
    assert loaded is not None
    assert loaded.track_id == "upload_abc"
    assert loaded.file_name == "source.md"
    assert store.list_build_jobs()[0].track_id == "upload_abc"


def test_builder_normalizes_unknown_type_to_concept():
    payload = {
        "title": "文档",
        "modules": [
            {
                "name": "模块",
                "knowledge_points": [
                    {"name": "知识点 A", "type": "unknown", "description": "A"},
                    {
                        "name": "知识点 B",
                        "type": "memory",
                        "description": "B",
                        "dependencies": ["知识点 A"],
                    },
                ],
            }
        ],
    }
    progress = normalize_tree_payload("doc-abc", "source.md", payload)
    kp_a = progress.modules[0].knowledge_points[0]
    kp_b = progress.modules[0].knowledge_points[1]
    assert kp_a.type.value == "concept"
    assert kp_b.dependencies == [kp_a.id]
    assert progress.knowledge_types[kp_b.id].value == "memory"
    assert progress.build_status == "ready"


def test_builder_records_missing_dependency_warning():
    progress = normalize_tree_payload(
        "doc-abc",
        "source.md",
        {
            "modules": [
                {
                    "name": "模块",
                    "knowledge_points": [
                        {
                            "name": "知识点 A",
                            "type": "concept",
                            "description": "A",
                            "dependencies": ["不存在"],
                        }
                    ],
                }
            ]
        },
    )
    assert progress.modules[0].knowledge_points[0].dependencies == []
    assert "不存在" in progress.build_warnings[0]


def test_store_rejects_unsafe_doc_id(tmp_path):
    store = MasteryStore(root=tmp_path)
    with pytest.raises(ValueError):
        store.load_progress("../bad")


def test_extract_document_text_reads_txt_and_md(tmp_path):
    txt = tmp_path / "notes.txt"
    md = tmp_path / "lesson.md"
    txt.write_text("hello", encoding="utf-8")
    md.write_text("# title", encoding="utf-8")
    assert extract_document_text(txt) == "hello"
    assert extract_document_text(md) == "# title"


def test_extract_document_text_rejects_unsupported_type(tmp_path):
    path = tmp_path / "slides.pptx"
    path.write_text("data", encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported_file_type"):
        extract_document_text(path)


class FakeLLM:
    def __init__(self, response: str):
        self.response = response
        self.calls: list[dict] = []

    async def call(self, system_prompt, user_prompt, **kwargs):
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "kwargs": kwargs,
            }
        )
        return self.response


class FakeLightRAG:
    def __init__(self, payload):
        self.payload = payload
        self.calls: list[str] = []

    async def get_track_status(self, track_id):
        self.calls.append(track_id)
        return self.payload


class FakeBuilder:
    def __init__(self):
        self.calls: list[dict] = []

    async def build_from_text(self, doc_id, source_file, text):
        self.calls.append({"doc_id": doc_id, "source_file": source_file, "text": text})
        kp = KnowledgePoint(
            id=f"{doc_id}_m0_kp0",
            name="核心概念",
            type=KnowledgeType.CONCEPT,
            module_id=f"{doc_id}_m0",
            description="核心概念说明",
        )
        module = LearningModule(id=f"{doc_id}_m0", name="基础", order=0, knowledge_points=[kp])
        return LearningProgress(
            doc_id=doc_id,
            title="构建完成",
            source_file=source_file,
            rag_status="processed",
            build_status="ready",
            modules=[module],
        )


def test_mastery_builder_rejects_blank_and_large_text():
    builder = MasteryBuilder(llm=FakeLLM("{}"), max_source_chars=5)
    with pytest.raises(ValueError, match="empty_content"):
        asyncio.run(builder.build_from_text("doc-abc", "source.md", "   "))
    with pytest.raises(ValueError, match="document_too_large"):
        asyncio.run(builder.build_from_text("doc-abc", "source.md", "123456"))


def test_mastery_builder_parses_fenced_json():
    llm = FakeLLM(
        """```json
        {
          "title": "文档",
          "modules": [
            {
              "name": "模块",
              "knowledge_points": [
                {"name": "知识点 A", "type": "memory", "description": "A"}
              ]
            }
          ]
        }
        ```"""
    )
    builder = MasteryBuilder(llm=llm, max_source_chars=1000)
    progress = asyncio.run(builder.build_from_text("doc-abc", "source.md", "正文"))
    assert progress.title == "文档"
    assert progress.modules[0].knowledge_points[0].id == "doc-abc_m0_kp0"
    assert llm.calls


def test_sync_upload_jobs_creates_processing_progress(tmp_path):
    store = MasteryStore(root=tmp_path)
    store.save_build_job(BuildJob(track_id="track-1", file_name="lesson.md"))
    service = MasteryService(
        llm=FakeLLM("{}"),
        lightrag=FakeLightRAG(
            {
                "documents": [
                    {
                        "id": "doc-1",
                        "file_path": "lesson.md",
                        "status": "processing",
                        "created_at": "2026-01-01T00:00:00Z",
                        "updated_at": "2026-01-01T00:00:00Z",
                    }
                ]
            }
        ),
        store=store,
        builder=FakeBuilder(),
    )

    asyncio.run(service.sync_upload_jobs())

    progress = store.load_progress("doc-1")
    assert progress is not None
    assert progress.rag_status == "processing"
    assert progress.build_status == "queued"
    job = store.load_build_job("track-1")
    assert job is not None
    assert job.doc_id == "doc-1"


def test_sync_upload_jobs_builds_when_rag_processed(tmp_path):
    source = tmp_path / "lesson.txt"
    source.write_text("正文", encoding="utf-8")
    store = MasteryStore(root=tmp_path / "store")
    store.save_build_job(BuildJob(track_id="track-1", file_name=source.name))
    builder = FakeBuilder()
    service = MasteryService(
        llm=FakeLLM("{}"),
        lightrag=FakeLightRAG(
            {
                "documents": [
                    {
                        "id": "doc-1",
                        "file_path": str(source),
                        "status": "processed",
                        "created_at": "2026-01-01T00:00:00Z",
                        "updated_at": "2026-01-01T00:00:00Z",
                    }
                ]
            }
        ),
        store=store,
        builder=builder,
    )

    asyncio.run(service.sync_upload_jobs())

    progress = store.load_progress("doc-1")
    assert progress is not None
    assert progress.rag_status == "processed"
    assert progress.build_status == "ready"
    assert progress.modules[0].knowledge_points[0].name == "核心概念"
    assert builder.calls[0]["text"] == "正文"


def test_source_resolution_checks_lightrag_parsed_inputs(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    parsed = tmp_path / "data" / "inputs" / "__parsed__" / "lesson.txt"
    parsed.parent.mkdir(parents=True)
    parsed.write_text("正文", encoding="utf-8")
    service = MasteryService(
        llm=FakeLLM("{}"),
        lightrag=FakeLightRAG({"documents": []}),
        store=MasteryStore(root=tmp_path / "store"),
        builder=FakeBuilder(),
    )

    assert service._resolve_source_file("lesson.txt").resolve() == parsed.resolve()


def make_learning_progress_for_actions() -> LearningProgress:
    kp_dependency = KnowledgePoint(
        id="doc-1_m0_kp0",
        name="向量检索",
        type=KnowledgeType.MEMORY,
        module_id="doc-1_m0",
        description="用向量相似度找相关内容。",
    )
    kp_target = KnowledgePoint(
        id="doc-1_m0_kp1",
        name="检索增强生成",
        type=KnowledgeType.CONCEPT,
        module_id="doc-1_m0",
        description="结合检索和生成回答问题。",
        dependencies=[kp_dependency.id],
    )
    module = LearningModule(
        id="doc-1_m0",
        name="RAG 基础",
        order=0,
        knowledge_points=[kp_dependency, kp_target],
    )
    return LearningProgress(
        doc_id="doc-1",
        title="RAG 文档",
        source_file="rag.md",
        rag_status="processed",
        build_status="ready",
        modules=[module],
    )


def test_start_point_learning_returns_guided_agentloop_prompt(tmp_path):
    store = MasteryStore(root=tmp_path)
    store.save_progress(make_learning_progress_for_actions())
    service = MasteryService(
        llm=FakeLLM("{}"),
        lightrag=FakeLightRAG({"documents": []}),
        store=store,
        builder=FakeBuilder(),
    )

    result = service.start_point_learning("doc-1", "doc-1_m0_kp1")

    assert result["doc_id"] == "doc-1"
    assert result["knowledge_point_id"] == "doc-1_m0_kp1"
    assert "请作为 AI Tutor" in result["prompt"]
    assert "RAG 文档" in result["prompt"]
    assert "RAG 基础" in result["prompt"]
    assert "检索增强生成" in result["prompt"]
    assert "结合检索和生成回答问题" in result["prompt"]
    assert "向量检索" in result["prompt"]
    progress = store.load_progress("doc-1")
    assert progress is not None
    assert progress.active_knowledge_point_id == "doc-1_m0_kp1"
    assert progress.mastery_levels["doc-1_m0_kp1"] == 0.1
    assert progress.qualitative_mastery.get("doc-1_m0_kp1") is None


def test_point_actions_update_progress_without_agentloop_grading(tmp_path):
    store = MasteryStore(root=tmp_path)
    store.save_progress(make_learning_progress_for_actions())
    service = MasteryService(
        llm=FakeLLM("{}"),
        lightrag=FakeLightRAG({"documents": []}),
        store=store,
        builder=FakeBuilder(),
    )

    quiz_result = service.record_quiz_started("doc-1", "doc-1_m0_kp1")
    assert quiz_result["map"]["counts"]["learning"] == 1

    review_result = service.schedule_review_later("doc-1", "doc-1_m0_kp1")
    assert review_result["map"]["due_reviews"] >= 0

    assessed = service.self_assess_point("doc-1", "doc-1_m0_kp1", passed=True, note="能讲清楚")
    assert assessed["map"]["counts"]["mastered"] == 1
