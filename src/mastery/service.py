from __future__ import annotations

from pathlib import Path
from typing import Any
import time
import uuid

from ..core.config import get_settings
from ..core.prompting import DEMO_RESPONSE_LANGUAGE_RULE
from .builder import MasteryBuilder
from .extractors import extract_document_text
from .grading import classify_error, grade_answer
from .models import KnowledgePoint, KnowledgeType, LearningProgress, PendingQuestion, QuizAttempt
from .policy import compute_mastery, find_knowledge_point, is_mastered, map_summary, next_objective
from .scheduler import SpacedRepetitionScheduler
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

    async def sync_upload_jobs(self) -> None:
        for job in self._store.list_build_jobs():
            if job.status in {"ready", "build_failed", "rag_failed"}:
                continue
            try:
                raw = await self._lightrag.get_track_status(job.track_id)
            except Exception as exc:  # Keep the UI list usable even if LightRAG is temporarily unavailable.
                job.status = "track_error"
                job.error = str(exc)
                self._store.save_build_job(job)
                continue

            documents = raw.get("documents") if isinstance(raw, dict) else None
            if not isinstance(documents, list) or not documents:
                job.status = "waiting_rag"
                self._store.save_build_job(job)
                continue

            for document in documents:
                if not isinstance(document, dict):
                    continue
                doc_id = str(document.get("id") or "").strip()
                if not doc_id:
                    continue
                file_path = str(document.get("file_path") or job.file_name or doc_id)
                rag_status = str(document.get("status") or "pending")
                progress = self._store.load_progress(doc_id) or LearningProgress(
                    doc_id=doc_id,
                    title=Path(file_path).name or job.file_name or doc_id,
                    source_file=file_path,
                    build_status="queued",
                )
                progress.rag_status = rag_status
                progress.source_file = progress.source_file or file_path
                progress.title = progress.title or Path(file_path).name or job.file_name or doc_id

                if rag_status == "failed":
                    progress.build_status = "rag_failed"
                    progress.build_error = str(document.get("error_msg") or "LightRAG 文档处理失败")
                    self._store.save_progress(progress)
                    job.doc_id = doc_id
                    job.status = "rag_failed"
                    job.error = progress.build_error
                    self._store.save_build_job(job)
                    continue

                if rag_status != "processed":
                    progress.build_status = "queued"
                    self._store.save_progress(progress)
                    job.doc_id = doc_id
                    job.status = f"rag_{rag_status}"
                    self._store.save_build_job(job)
                    continue

                job.doc_id = doc_id
                if progress.build_status == "ready":
                    progress.rag_status = "processed"
                    self._store.save_progress(progress)
                    job.status = "ready"
                    self._store.save_build_job(job)
                    continue

                await self._build_processed_document(progress, job, file_path)

    def list_documents(self) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        for progress in self._store.list_progress():
            summary = map_summary(progress)
            documents.append(
                {
                    "doc_id": progress.doc_id,
                    "title": progress.title,
                    "source_file": progress.source_file,
                    "rag_status": progress.rag_status,
                    "build_status": progress.build_status,
                    "build_error": progress.build_error,
                    "counts": summary["counts"],
                    "due_reviews": summary["due_reviews"],
                }
            )
        return documents

    def get_document(self, doc_id: str) -> LearningProgress | None:
        return self._store.load_progress(doc_id)

    def get_document_payload(self, doc_id: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        return {
            "doc_id": progress.doc_id,
            "title": progress.title,
            "source_file": progress.source_file,
            "rag_status": progress.rag_status,
            "build_status": progress.build_status,
            "build_error": progress.build_error,
            "map": map_summary(progress),
            "next": next_objective(progress).to_dict(),
        }

    def start_point_learning(self, doc_id: str, kp_id: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, _, module_name = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        dependency_titles = self._dependency_titles(progress, kp.dependencies)
        prompt = self._build_guided_learning_prompt(progress, module_name, kp, dependency_titles)
        progress.active_knowledge_point_id = kp.id
        progress.started_points[kp.id] = time.time()
        progress.mastery_levels[kp.id] = max(progress.mastery_levels.get(kp.id, 0.0), 0.1)
        self._store.save_progress(progress)
        return {
            "doc_id": doc_id,
            "knowledge_point_id": kp.id,
            "prompt": prompt,
            "document": self.get_document_payload(doc_id),
        }

    def self_assess_point(self, doc_id: str, kp_id: str, *, passed: bool, note: str = "") -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, _, _ = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        progress.active_knowledge_point_id = kp.id
        progress.qualitative_mastery[kp.id] = bool(passed)
        progress.mastery_levels[kp.id] = 1.0 if passed else max(progress.mastery_levels.get(kp.id, 0.0), 0.4)
        if note:
            progress.feynman_explanations[kp.id] = note
        self._store.save_progress(progress)
        return self.get_document_payload(doc_id)

    def record_quiz_started(self, doc_id: str, kp_id: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, _, _ = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        progress.active_knowledge_point_id = kp.id
        progress.quiz_started_points[kp.id] = time.time()
        progress.mastery_levels[kp.id] = max(progress.mastery_levels.get(kp.id, 0.0), 0.2)
        self._store.save_progress(progress)
        return self.get_document_payload(doc_id)

    def schedule_review_later(self, doc_id: str, kp_id: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, _, _ = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        progress.active_knowledge_point_id = kp.id
        progress.review_later_points[kp.id] = time.time()
        progress.mastery_levels[kp.id] = max(progress.mastery_levels.get(kp.id, 0.0), 0.2)
        self._store.save_progress(progress)
        return self.get_document_payload(doc_id)

    async def build_document(self, doc_id: str) -> LearningProgress:
        progress = self._require_progress(doc_id)
        if progress.rag_status != "processed":
            return progress
        job = next((item for item in self._store.list_build_jobs() if item.doc_id == doc_id), None)
        if job is None:
            job = BuildJob(track_id=f"manual_{doc_id}", file_name=progress.source_file, doc_id=doc_id, status="building")
        return await self._build_processed_document(progress, job, progress.source_file)

    def study_knowledge_point(self, doc_id: str, kp_id: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, _, _ = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        return {
            "doc_id": doc_id,
            "knowledge_point_id": kp.id,
            "title": kp.name,
            "description": kp.description,
            "explanation": kp.description or f"Study the knowledge point \"{kp.name}\".",
            "dependencies": kp.dependencies,
        }

    def create_quiz(self, doc_id: str, kp_id: str, *, question_type: str = "short") -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, module_id, _ = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        prompt = f"Answer this learning check: What is the core idea of \"{kp.name}\"?"
        expected = kp.description or kp.name
        pending = PendingQuestion(
            question_id=f"q_{uuid.uuid4().hex[:12]}",
            knowledge_point_id=kp.id,
            module_id=module_id,
            prompt=prompt,
            question_type=question_type,
            expected_answer=expected,
        )
        progress.pending_question = pending
        self._store.save_progress(progress)
        return {
            "question_id": pending.question_id,
            "knowledge_point_id": kp.id,
            "prompt": pending.prompt,
            "question_type": pending.question_type,
            "options": pending.options,
        }

    def grade_answer(self, doc_id: str, answer: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        pending = progress.pending_question
        is_correct = False
        mastery = 0.0
        mastered = False
        if pending is not None:
            kp, module_id, _ = find_knowledge_point(progress, pending.knowledge_point_id)
            is_correct = bool(pending.expected_answer) and grade_answer(
                answer,
                pending.expected_answer,
                pending.question_type,
            )
            progress.quiz_attempts.append(
                QuizAttempt(
                    question_id=pending.question_id,
                    knowledge_point_id=pending.knowledge_point_id,
                    module_id=module_id or pending.module_id,
                    is_correct=is_correct,
                    user_answer=answer,
                    error_type=None if is_correct else classify_error(answer),
                )
            )
            if kp is not None and kp.type in {KnowledgeType.MEMORY, KnowledgeType.PROCEDURE}:
                correctness = [
                    attempt.is_correct
                    for attempt in progress.quiz_attempts
                    if attempt.knowledge_point_id == kp.id
                ]
                mastery = compute_mastery(correctness)
                progress.mastery_levels[kp.id] = mastery
                scheduler = SpacedRepetitionScheduler()
                state = progress.repetition_states.get(kp.id) or scheduler.get_initial_state(kp.type)
                progress.repetition_states[kp.id] = scheduler.schedule_next(state, kp.type, is_correct)
                progress.review_queue = scheduler.build_review_queue(progress)
                mastered = is_mastered(progress, kp)
            progress.pending_question = None
        self._store.save_progress(progress)
        return {
            "is_correct": is_correct,
            "mastery": mastery,
            "mastered": mastered,
            "next": next_objective(progress).to_dict(),
            "map": map_summary(progress),
        }

    def assess(self, doc_id: str, kp_id: str, *, passed: bool, feedback: str = "") -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, _, _ = find_knowledge_point(progress, kp_id)
        if kp is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Knowledge point not found")
        progress.qualitative_mastery[kp.id] = bool(passed)
        current = progress.mastery_levels.get(kp.id, 0.0)
        progress.mastery_levels[kp.id] = max(current, 1.0) if passed else min(current, 0.4)
        if feedback:
            progress.feynman_explanations[kp.id] = feedback
        self._store.save_progress(progress)
        return {
            "passed": bool(passed),
            "next": next_objective(progress).to_dict(),
            "map": map_summary(progress),
        }

    def reset_progress(self, doc_id: str) -> LearningProgress:
        progress = self._require_progress(doc_id)
        progress.mastery_levels = {}
        progress.qualitative_mastery = {}
        progress.quiz_attempts = []
        progress.error_records = []
        progress.repetition_states = {}
        progress.review_queue = []
        progress.pending_question = None
        progress.feynman_explanations = {}
        progress.active_knowledge_point_id = ""
        progress.started_points = {}
        progress.quiz_started_points = {}
        progress.review_later_points = {}
        self._store.save_progress(progress)
        return progress

    def delete_document(self, doc_id: str) -> None:
        self._store.delete_progress(doc_id)

    async def build_from_file(self, doc_id: str, source_file: Path) -> LearningProgress:
        text = extract_document_text(source_file)
        progress = await self._builder.build_from_text(doc_id, source_file.name, text)
        self._store.save_progress(progress)
        return progress

    async def _build_processed_document(
        self,
        progress: LearningProgress,
        job: BuildJob,
        file_path: str,
    ) -> LearningProgress:
        source_path = self._resolve_source_file(file_path or progress.source_file or job.file_name)
        progress.rag_status = "processed"
        progress.build_status = "building"
        progress.build_error = ""
        self._store.save_progress(progress)
        job.status = "building"
        self._store.save_build_job(job)

        if source_path is None:
            progress.build_status = "build_failed"
            progress.build_error = "找不到原始文件，无法构建知识树"
            self._store.save_progress(progress)
            job.status = "build_failed"
            job.error = progress.build_error
            self._store.save_build_job(job)
            return progress

        try:
            built = await self.build_from_file(progress.doc_id, source_path)
        except Exception as exc:
            progress.build_status = "build_failed"
            progress.build_error = str(exc)
            self._store.save_progress(progress)
            job.status = "build_failed"
            job.error = progress.build_error
            self._store.save_build_job(job)
            return progress

        built.source_file = file_path or source_path.name
        built.rag_status = "processed"
        built.build_status = "ready"
        self._store.save_progress(built)
        job.status = "ready"
        job.error = ""
        self._store.save_build_job(job)
        return built

    def _resolve_source_file(self, file_path: str) -> Path | None:
        candidates = [
            Path(file_path),
            Path("data") / "inputs" / Path(file_path).name,
            Path("data") / "inputs" / "__parsed__" / Path(file_path).name,
            Path("data") / "uploads" / Path(file_path).name,
        ]
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate
        return None

    def _dependency_titles(self, progress: LearningProgress, dependency_ids: list[str]) -> list[str]:
        titles: list[str] = []
        for dependency_id in dependency_ids:
            dependency, _, _ = find_knowledge_point(progress, dependency_id)
            if dependency is not None:
                titles.append(dependency.name)
        return titles

    def _build_guided_learning_prompt(
        self,
        progress: LearningProgress,
        module_name: str,
        kp: KnowledgePoint,
        dependency_titles: list[str],
    ) -> str:
        dependencies = ", ".join(dependency_titles) if dependency_titles else "No explicit prerequisites"
        return (
            f"Act as EduMind AI and help the learner study the current knowledge point: \"{kp.name}\".\n\n"
            f"{DEMO_RESPONSE_LANGUAGE_RULE}\n\n"
            "Context:\n"
            f"- Document: {progress.title or progress.source_file or progress.doc_id}\n"
            f"- Module: {module_name or kp.module_id}\n"
            f"- Knowledge point description: {kp.description or 'No description available'}\n"
            f"- Prerequisites: {dependencies}\n\n"
            "Requirements:\n"
            "1. Explain what this knowledge point means in intuitive language.\n"
            "2. Explain which prerequisite ideas it depends on.\n"
            "3. Give one example grounded in the document content.\n"
            "4. End with one understanding-check question for the learner.\n"
            "5. If the learner's background or goal is unclear, use ask_user to clarify before continuing."
        )

    def _require_progress(self, doc_id: str) -> LearningProgress:
        progress = self._store.load_progress(doc_id)
        if progress is None:
            from ..core.exceptions import NotFoundError

            raise NotFoundError("Mastery document not found")
        return progress
