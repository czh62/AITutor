from __future__ import annotations

from pathlib import Path
from typing import Any

from ..core.config import get_settings
from .builder import MasteryBuilder
from .extractors import extract_document_text
from .models import LearningProgress
from .storage import BuildJob, MasteryStore


class MasteryService:
    def __init__(
        self,
        llm: Any,
        lightrag: Any,
        store: MasteryStore | None = None,
        builder: MasteryBuilder | None = None,
    ) -> None:
        settings = get_settings()
        self._llm = llm
        self._lightrag = lightrag
        self._store = store or MasteryStore()
        self._builder = builder or MasteryBuilder(
            llm=llm,
            max_source_chars=settings.mastery_max_source_chars,
        )

    def register_upload(self, track_id: str, file_name: str) -> BuildJob:
        existing = self._store.load_build_job(track_id)
        if existing is not None:
            return existing
        job = BuildJob(track_id=track_id, file_name=file_name, status="queued")
        self._store.save_build_job(job)
        return job

    def list_documents(self) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        for progress in self._store.list_progress():
            documents.append(
                {
                    "doc_id": progress.doc_id,
                    "title": progress.title,
                    "source_file": progress.source_file,
                    "rag_status": progress.rag_status,
                    "build_status": progress.build_status,
                    "build_error": progress.build_error,
                }
            )
        return documents

    def get_document(self, doc_id: str) -> LearningProgress | None:
        return self._store.load_progress(doc_id)

    async def build_from_file(self, doc_id: str, source_file: Path) -> LearningProgress:
        text = extract_document_text(source_file)
        progress = await self._builder.build_from_text(doc_id, source_file.name, text)
        self._store.save_progress(progress)
        return progress
