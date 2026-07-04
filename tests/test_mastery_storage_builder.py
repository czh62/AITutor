from __future__ import annotations

import asyncio

import pytest

from src.mastery.builder import MasteryBuilder, normalize_tree_payload
from src.mastery.extractors import extract_document_text
from src.mastery.models import LearningProgress
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
