from __future__ import annotations

import json
from pathlib import Path
import threading
import time
import uuid

from pydantic import BaseModel, ConfigDict, Field

from .models import LearningProgress

_store_lock = threading.Lock()


class BuildJob(BaseModel):
    model_config = ConfigDict(extra="ignore")

    track_id: str
    file_name: str = ""
    doc_id: str = ""
    status: str = "queued"
    error: str = ""
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp.{uuid.uuid4().hex}")
    try:
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _validate_id(value: str, label: str) -> str:
    candidate = str(value or "").strip()
    if not candidate or "/" in candidate or "\\" in candidate or ".." in candidate or ":" in candidate:
        raise ValueError(f"Invalid {label}: {value!r}")
    return candidate


class MasteryStore:
    def __init__(self, root: Path | None = None) -> None:
        if root is None:
            from ..core.config import get_settings

            root = Path(get_settings().mastery_storage_dir)
        self.root = root
        self.documents_dir = self.root / "documents"
        self.build_jobs_dir = self.root / "build_jobs"
        self.index_path = self.root / "index.json"
        self.documents_dir.mkdir(parents=True, exist_ok=True)
        self.build_jobs_dir.mkdir(parents=True, exist_ok=True)

    def save_progress(self, progress: LearningProgress) -> None:
        doc_id = _validate_id(progress.doc_id, "doc_id")
        with _store_lock:
            progress.version += 1
            progress.updated_at = time.time()
            _atomic_write_text(
                self._progress_path(doc_id),
                json.dumps(progress.model_dump(mode="json"), ensure_ascii=False, indent=2),
            )
            self._write_index()

    def load_progress(self, doc_id: str) -> LearningProgress | None:
        path = self._progress_path(_validate_id(doc_id, "doc_id"))
        if not path.exists():
            return None
        return LearningProgress.model_validate(json.loads(path.read_text(encoding="utf-8")))

    def delete_progress(self, doc_id: str) -> None:
        path = self._progress_path(_validate_id(doc_id, "doc_id"))
        with _store_lock:
            path.unlink(missing_ok=True)
            self._write_index()

    def list_progress(self) -> list[LearningProgress]:
        items: list[LearningProgress] = []
        for path in sorted(self.documents_dir.glob("*.json")):
            if path.name.startswith("."):
                continue
            items.append(LearningProgress.model_validate(json.loads(path.read_text(encoding="utf-8"))))
        return items

    def save_build_job(self, job: BuildJob) -> None:
        track_id = _validate_id(job.track_id, "track_id")
        with _store_lock:
            job.updated_at = time.time()
            _atomic_write_text(
                self._build_job_path(track_id),
                json.dumps(job.model_dump(mode="json"), ensure_ascii=False, indent=2),
            )

    def load_build_job(self, track_id: str) -> BuildJob | None:
        path = self._build_job_path(_validate_id(track_id, "track_id"))
        if not path.exists():
            return None
        return BuildJob.model_validate(json.loads(path.read_text(encoding="utf-8")))

    def list_build_jobs(self) -> list[BuildJob]:
        jobs: list[BuildJob] = []
        for path in sorted(self.build_jobs_dir.glob("*.json")):
            if path.name.startswith("."):
                continue
            jobs.append(BuildJob.model_validate(json.loads(path.read_text(encoding="utf-8"))))
        return jobs

    def _progress_path(self, doc_id: str) -> Path:
        return self.documents_dir / f"{doc_id}.json"

    def _build_job_path(self, track_id: str) -> Path:
        return self.build_jobs_dir / f"{track_id}.json"

    def _write_index(self) -> None:
        documents = [
            {
                "doc_id": progress.doc_id,
                "title": progress.title,
                "source_file": progress.source_file,
                "rag_status": progress.rag_status,
                "build_status": progress.build_status,
                "updated_at": progress.updated_at,
            }
            for progress in self.list_progress()
        ]
        _atomic_write_text(
            self.index_path,
            json.dumps({"documents": documents}, ensure_ascii=False, indent=2),
        )
