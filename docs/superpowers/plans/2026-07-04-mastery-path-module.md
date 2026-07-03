# Mastery Path Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a document-scoped Mastery Path module that creates a knowledge tree from supported LightRAG documents and provides dialog-centered study, quiz, review, and progress visualization.

**Architecture:** LightRAG remains the source of truth for document ingestion state. A new `src/mastery/` package owns deterministic learning policy, JSON persistence, knowledge tree construction, and build tracking. The frontend adds a Knowledge Points sidebar beside the existing QA panel and opens study/quiz/review flows in dialogs.

**Tech Stack:** FastAPI, Pydantic v2, httpx, existing OpenAI-compatible `LLMClient`, atomic JSON files under `data/mastery_paths/`, React 19, TypeScript, Vite, Tailwind v4, lucide-react.

## Global Constraints

- Supported build/upload file types are exactly `.txt`, `.md`, `.pdf`, and `.docx`.
- Frontend and backend must both reject unsupported upload types.
- LightRAG document status is authoritative; no knowledge tree renders before status `processed`.
- HTTP 409 from LightRAG must not create a Mastery build job.
- Mastery paths are associated with final LightRAG `doc_id`, not file name or `track_id`.
- Mastery progress is stored under `data/mastery_paths/`, not SQLite.
- Knowledge tree generation passes the extracted document text to the LLM without chunking.
- If extracted text exceeds the configured single-call limit, fail with `document_too_large`.
- The LLM may generate teaching content and questions; deterministic code decides grading, mastery, advancement, and review.
- Existing user changes must not be reverted.

---

## File Structure

Create:

- `src/mastery/__init__.py`: package exports.
- `src/mastery/models.py`: Pydantic learning and build models.
- `src/mastery/grading.py`: deterministic answer grading and error classification.
- `src/mastery/policy.py`: mastery gates, next objective, map summary.
- `src/mastery/scheduler.py`: spaced repetition state transitions and review queue.
- `src/mastery/storage.py`: atomic JSON persistence for progress and build jobs.
- `src/mastery/extractors.py`: TXT/MD/PDF/DOCX full-text extraction.
- `src/mastery/builder.py`: LLM prompt, JSON parsing, module/KP normalization, dependency resolution.
- `src/mastery/service.py`: orchestration API used by routers.
- `src/schemas/mastery.py`: request/response models for the REST API.
- `src/api/mastery.py`: FastAPI routes.
- `tests/test_mastery_grading_policy.py`: pure engine tests.
- `tests/test_mastery_storage_builder.py`: storage and builder tests.
- `tests/test_mastery_api_documents.py`: upload validation and route behavior tests.
- `ui/src/features/MasterySidebar.tsx`: document list, tree, next-step panel.
- `ui/src/components/mastery/MasteryTree.tsx`: tree visualization.
- `ui/src/components/mastery/KnowledgePointDialog.tsx`: study dialog.
- `ui/src/components/mastery/QuizDialog.tsx`: quiz and grading dialog.
- `ui/src/components/mastery/ReviewDialog.tsx`: due review dialog.
- `ui/src/components/mastery/BuildStatusDialog.tsx`: build/RAG state dialog.
- `ui/src/components/mastery/ResetProgressDialog.tsx`: reset confirmation.
- `ui/src/features/MasterySidebar.test.tsx`: sidebar state rendering tests if the existing test setup supports React component tests.

Modify:

- `src/main.py`: register `mastery_router` and create `MasteryService` during lifespan.
- `src/services/__init__.py`: factory for `MasteryService`.
- `src/services/lightrag_client.py`: add `track_id` preserving upload response and `get_track_status()`.
- `src/schemas/documents.py`: add `track_id` to `UploadResult` and add track status response schemas.
- `src/api/documents.py`: validate upload file type and register successful uploads with Mastery.
- `src/core/config.py`: add Mastery storage and LLM text-size settings.
- `ui/src/api/types.ts`: add `track_id` to upload result and add Mastery types.
- `ui/src/api/aitutor.ts`: add Mastery API calls and mock data.
- `ui/src/components/ActivityBar.tsx`: add Documents/Knowledge Points mode.
- `ui/src/App.tsx`: track active sidebar mode and render `MasterySidebar`.
- `ui/src/components/documents/UploadDocumentsDialog.tsx`: restrict accepted file types.

---

### Task 1: Upload Validation And LightRAG Track Status

**Files:**
- Modify: `src/core/config.py`
- Modify: `src/schemas/documents.py`
- Modify: `src/services/lightrag_client.py`
- Modify: `src/api/documents.py`
- Test: `tests/test_mastery_api_documents.py`

**Interfaces:**
- Produces: `SUPPORTED_MASTERY_EXTENSIONS: frozenset[str]`
- Produces: `validate_mastery_upload_file(filename: str, content_type: str | None) -> None`
- Produces: `LightRAGClient.get_track_status(track_id: str) -> dict`
- Produces: `UploadResult.track_id: str | None`
- Consumes: existing `LightRAGClient.upload_document()`

- [ ] **Step 1: Write failing upload validation tests**

Add these tests to `tests/test_mastery_api_documents.py`:

```python
import pytest

from src.api.documents import validate_mastery_upload_file
from src.core.exceptions import ValidationError
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
        ("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/test_mastery_api_documents.py -q
```

Expected: FAIL because `validate_mastery_upload_file` and `UploadResult.track_id` are not implemented.

- [ ] **Step 3: Implement backend upload validation**

In `src/core/config.py`, add settings:

```python
    mastery_storage_dir: str = "./data/mastery_paths"
    mastery_max_source_chars: int = 120000
    mastery_build_poll_interval_seconds: float = 3.0
```

In `src/schemas/documents.py`, change `UploadResult` and add track status schemas:

```python
class UploadResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: str
    message: str
    track_id: Optional[str] = None


class TrackStatusResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    track_id: str
    documents: List[DocStatusResponse]
    total_count: int
    status_summary: Dict[str, int]
```

In `src/services/lightrag_client.py`, add:

```python
    async def get_track_status(self, track_id: str) -> dict:
        try:
            resp = await self._get_client().get(f"/documents/track_status/{track_id}")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            self._handle_error(exc)
```

In `src/api/documents.py`, add:

```python
from pathlib import Path
from ..core.exceptions import ValidationError

SUPPORTED_MASTERY_EXTENSIONS = frozenset({".txt", ".md", ".pdf", ".docx"})
SUPPORTED_MASTERY_CONTENT_TYPES = {
    ".txt": {"text/plain", "application/octet-stream"},
    ".md": {"text/markdown", "text/plain", "application/octet-stream"},
    ".pdf": {"application/pdf", "application/octet-stream"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    },
}


def validate_mastery_upload_file(filename: str, content_type: str | None) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in SUPPORTED_MASTERY_EXTENSIONS:
        raise ValidationError("仅支持上传 TXT、MD、PDF、DOCX 文件")
    allowed = SUPPORTED_MASTERY_CONTENT_TYPES[suffix]
    if content_type and content_type not in allowed:
        raise ValidationError("文件类型与扩展名不匹配")
```

Call `validate_mastery_upload_file(file.filename or "", file.content_type)` before reading upload content.

- [ ] **Step 4: Register successful upload with Mastery service**

Add a dependency in `src/api/documents.py`:

```python
from typing import Any


def get_mastery_service(request: Request) -> Any:
    return getattr(request.app.state, "mastery_service", None)
```

Change upload endpoint signature:

```python
async def upload_document(
    file: UploadFile = File(...),
    client: LightRAGClient = Depends(get_lightrag_client),
    mastery: Any = Depends(get_mastery_service),
):
```

After `raw = await client.upload_document(...)`, add:

```python
    track_id = raw.get("track_id")
    if mastery is not None and raw.get("status") == "success" and track_id:
        mastery.register_upload(track_id=track_id, file_name=file.filename or "unknown")
```

- [ ] **Step 5: Run tests**

Run:

```bash
pytest tests/test_mastery_api_documents.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/config.py src/schemas/documents.py src/services/lightrag_client.py src/api/documents.py tests/test_mastery_api_documents.py
git commit -m "feat: validate mastery upload inputs"
```

---

### Task 2: Deterministic Mastery Engine

**Files:**
- Create: `src/mastery/__init__.py`
- Create: `src/mastery/models.py`
- Create: `src/mastery/grading.py`
- Create: `src/mastery/policy.py`
- Create: `src/mastery/scheduler.py`
- Test: `tests/test_mastery_grading_policy.py`

**Interfaces:**
- Produces: `KnowledgeType`, `KnowledgePoint`, `LearningModule`, `LearningProgress`
- Produces: `grade_answer(user_answer: str, expected_answer: str, question_type: str) -> bool`
- Produces: `compute_mastery(correctness: list[bool]) -> float`
- Produces: `next_objective(progress: LearningProgress) -> NextStep`
- Produces: `map_summary(progress: LearningProgress) -> dict`
- Produces: `SpacedRepetitionScheduler`

- [ ] **Step 1: Write failing engine tests**

Create `tests/test_mastery_grading_policy.py`:

```python
import time

from src.mastery.grading import grade_answer
from src.mastery.models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress, QuizAttempt
from src.mastery.policy import compute_mastery, map_summary, next_objective
from src.mastery.scheduler import SpacedRepetitionScheduler


def _progress_with_kp(kp_type=KnowledgeType.MEMORY):
    kp = KnowledgePoint(id="doc-1_m0_kp0", name="变量", type=kp_type, module_id="doc-1_m0", description="变量的含义")
    module = LearningModule(id="doc-1_m0", name="基础", order=0, description="基础模块", knowledge_points=[kp])
    return LearningProgress(doc_id="doc-1", title="测试文档", modules=[module]), kp


def test_short_answer_accepts_close_match():
    assert grade_answer("递归函数", "递归函数", "short")
    assert grade_answer("递归函數", "递归函数", "short")


def test_quantitative_mastery_confidence_caps():
    assert compute_mastery([True]) == 0.5
    assert compute_mastery([True, True]) == 0.8
    assert compute_mastery([True, True, True]) >= 0.9


def test_next_objective_returns_first_unmastered_point():
    progress, kp = _progress_with_kp()
    step = next_objective(progress)
    assert step.action == "probe"
    assert step.knowledge_point_id == kp.id


def test_qualitative_mastery_uses_assessment_gate():
    progress, kp = _progress_with_kp(KnowledgeType.CONCEPT)
    progress.qualitative_mastery[kp.id] = True
    summary = map_summary(progress)
    assert summary["counts"]["mastered"] == 1


def test_review_queue_prioritizes_due_memory():
    progress, kp = _progress_with_kp()
    scheduler = SpacedRepetitionScheduler()
    state = scheduler.get_initial_state(kp.type)
    state.next_review_at = time.time() - 1
    progress.repetition_states[kp.id] = state
    progress.review_queue = scheduler.build_review_queue(progress)
    assert progress.review_queue[0].knowledge_point_id == kp.id
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/test_mastery_grading_policy.py -q
```

Expected: FAIL because `src.mastery` does not exist.

- [ ] **Step 3: Create `src/mastery/models.py`**

Implement Pydantic models with `ConfigDict(extra="ignore")`. Include these exact fields:

```python
class KnowledgePoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    type: KnowledgeType
    module_id: str
    description: str = ""
    dependencies: list[str] = Field(default_factory=list)


class LearningModule(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    order: int
    description: str = ""
    pass_threshold: float = 0.7
    knowledge_points: list[KnowledgePoint] = Field(default_factory=list)


class LearningProgress(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    title: str = ""
    source_file: str = ""
    rag_status: str = "pending"
    build_status: Literal["not_started", "queued", "building", "ready", "build_failed", "rag_failed"] = "not_started"
    build_error: str = ""
    build_warnings: list[str] = Field(default_factory=list)
    modules: list[LearningModule] = Field(default_factory=list)
    mastery_levels: dict[str, float] = Field(default_factory=dict)
    qualitative_mastery: dict[str, bool] = Field(default_factory=dict)
    knowledge_types: dict[str, KnowledgeType] = Field(default_factory=dict)
    quiz_attempts: list[QuizAttempt] = Field(default_factory=list)
    error_records: list[ErrorRecord] = Field(default_factory=list)
    repetition_states: dict[str, RepetitionState] = Field(default_factory=dict)
    review_queue: list[ReviewTask] = Field(default_factory=list)
    pending_question: PendingQuestion | None = None
    feynman_explanations: dict[str, str] = Field(default_factory=dict)
    version: int = 0
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
```

Also include `QuizAttempt`, `RetryAttempt`, `ErrorRecord`, `PendingQuestion`, `RepetitionState`, and `ReviewTask` mirroring the spec.

- [ ] **Step 4: Create grading, policy, and scheduler modules**

Implement:

```python
def grade_answer(user_answer: str, expected_answer: str, question_type: str = "short") -> bool
def classify_error(user_answer: str) -> ErrorType
def compute_mastery(correctness: list[bool]) -> float
def is_mastered(progress: LearningProgress, kp: KnowledgePoint) -> bool
def next_objective(progress: LearningProgress, *, now: float | None = None) -> NextStep
def map_summary(progress: LearningProgress, *, now: float | None = None) -> dict
```

Use recency weights `(0.5, 0.7, 0.85, 0.95, 1.0)` and confidence caps `{1: 0.5, 2: 0.8}`.

- [ ] **Step 5: Run tests**

Run:

```bash
pytest tests/test_mastery_grading_policy.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mastery tests/test_mastery_grading_policy.py
git commit -m "feat: add mastery learning engine"
```

---

### Task 3: Mastery Storage And Knowledge Tree Builder

**Files:**
- Create: `src/mastery/storage.py`
- Create: `src/mastery/extractors.py`
- Create: `src/mastery/builder.py`
- Create: `src/mastery/service.py`
- Test: `tests/test_mastery_storage_builder.py`

**Interfaces:**
- Consumes: `LearningProgress`, `LearningModule`, `KnowledgePoint`
- Produces: `MasteryStore(root: Path | None = None)`
- Produces: `MasteryBuilder(llm: LLMClient, max_source_chars: int)`
- Produces: `MasteryService`
- Produces: `extract_document_text(path: Path) -> str`

- [ ] **Step 1: Write failing storage and builder tests**

Create `tests/test_mastery_storage_builder.py`:

```python
import json

import pytest

from src.mastery.builder import normalize_tree_payload
from src.mastery.models import LearningProgress
from src.mastery.storage import MasteryStore


def test_store_round_trips_progress(tmp_path):
    store = MasteryStore(root=tmp_path)
    progress = LearningProgress(doc_id="doc-abc", title="测试")
    store.save_progress(progress)
    loaded = store.load_progress("doc-abc")
    assert loaded is not None
    assert loaded.doc_id == "doc-abc"
    assert loaded.version == 1


def test_builder_normalizes_unknown_type_to_concept():
    payload = {
        "title": "文档",
        "modules": [
            {
                "name": "模块",
                "knowledge_points": [
                    {"name": "知识点 A", "type": "unknown", "description": "A"},
                    {"name": "知识点 B", "type": "memory", "description": "B", "dependencies": ["知识点 A"]},
                ],
            }
        ],
    }
    progress = normalize_tree_payload("doc-abc", "source.md", payload)
    kp_a = progress.modules[0].knowledge_points[0]
    kp_b = progress.modules[0].knowledge_points[1]
    assert kp_a.type.value == "concept"
    assert kp_b.dependencies == [kp_a.id]


def test_store_rejects_unsafe_doc_id(tmp_path):
    store = MasteryStore(root=tmp_path)
    with pytest.raises(ValueError):
        store.load_progress("../bad")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/test_mastery_storage_builder.py -q
```

Expected: FAIL because storage and builder modules do not exist.

- [ ] **Step 3: Implement atomic JSON store**

`MasteryStore` must write:

```text
{root}/documents/{doc_id}.json
{root}/build_jobs/{track_id}.json
{root}/index.json
```

Expose:

```python
def save_progress(self, progress: LearningProgress) -> None
def load_progress(self, doc_id: str) -> LearningProgress | None
def delete_progress(self, doc_id: str) -> None
def list_progress(self) -> list[LearningProgress]
def save_build_job(self, job: BuildJob) -> None
def load_build_job(self, track_id: str) -> BuildJob | None
def list_build_jobs(self) -> list[BuildJob]
```

Validate IDs by rejecting `/`, `\`, `..`, and `:`.

- [ ] **Step 4: Implement extractors**

`extract_document_text(path: Path) -> str`:

```python
suffix = path.suffix.lower()
if suffix in {".txt", ".md"}:
    return _read_text(path)
if suffix == ".pdf":
    return _read_pdf(path)
if suffix == ".docx":
    return _read_docx(path)
raise ValueError("unsupported_file_type")
```

Use optional imports inside `_read_pdf` and `_read_docx`. If missing:

```python
raise RuntimeError("缺少 PDF 解析依赖 pypdf，请安装后重试")
raise RuntimeError("缺少 DOCX 解析依赖 python-docx，请安装后重试")
```

- [ ] **Step 5: Implement builder normalization**

`normalize_tree_payload(doc_id, source_file, payload)` must:

- Create module IDs as `{doc_id}_m{module_index}`.
- Create KP IDs as `{module_id}_kp{kp_index}`.
- Coerce invalid knowledge types to `concept`.
- Resolve dependency names to KP IDs.
- Ignore missing dependency names and append build warnings.
- Populate `knowledge_types`.
- Set `build_status="ready"`.

- [ ] **Step 6: Implement LLM builder**

`MasteryBuilder.build_from_text(doc_id, source_file, text)`:

- Reject blank text with `ValueError("empty_content")`.
- Reject over-limit text with `ValueError("document_too_large")`.
- Call `LLMClient.call()` with JSON response instructions.
- Parse fenced or raw JSON.
- Return `LearningProgress`.

- [ ] **Step 7: Run tests**

Run:

```bash
pytest tests/test_mastery_storage_builder.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/mastery/storage.py src/mastery/extractors.py src/mastery/builder.py src/mastery/service.py tests/test_mastery_storage_builder.py
git commit -m "feat: build and persist mastery paths"
```

---

### Task 4: Mastery API And App Wiring

**Files:**
- Create: `src/schemas/mastery.py`
- Create: `src/api/mastery.py`
- Modify: `src/main.py`
- Modify: `src/services/__init__.py`
- Test: `tests/test_mastery_api_documents.py`

**Interfaces:**
- Consumes: `MasteryService`
- Produces: `GET /mastery/documents`
- Produces: `GET /mastery/documents/{doc_id}`
- Produces: `POST /mastery/documents/{doc_id}/build`
- Produces: `POST /mastery/documents/{doc_id}/study/{kp_id}`
- Produces: `POST /mastery/documents/{doc_id}/quiz/{kp_id}`
- Produces: `POST /mastery/documents/{doc_id}/grade`
- Produces: `POST /mastery/documents/{doc_id}/assess`
- Produces: `POST /mastery/documents/{doc_id}/reset`
- Produces: `DELETE /mastery/documents/{doc_id}`

- [ ] **Step 1: Write failing API tests**

Extend `tests/test_mastery_api_documents.py`:

```python
from fastapi.testclient import TestClient

from src.main import create_app
from src.mastery.models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress


class FakeMasteryService:
    def __init__(self):
        kp = KnowledgePoint(id="doc-1_m0_kp0", name="变量", type=KnowledgeType.CONCEPT, module_id="doc-1_m0", description="变量")
        module = LearningModule(id="doc-1_m0", name="基础", order=0, knowledge_points=[kp])
        self.progress = LearningProgress(doc_id="doc-1", title="文档", build_status="ready", rag_status="processed", modules=[module])

    def list_documents(self):
        return [{"doc_id": "doc-1", "title": "文档", "rag_status": "processed", "build_status": "ready"}]

    def get_document(self, doc_id):
        return self.progress

    def get_document_payload(self, doc_id):
        return {"doc_id": doc_id, "map": {"counts": {"total": 1, "mastered": 0, "learning": 0, "new": 1}, "modules": []}, "next": {"action": "probe"}}


def test_mastery_documents_route_lists_documents():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    response = client.get("/mastery/documents")
    assert response.status_code == 200
    assert response.json()["documents"][0]["doc_id"] == "doc-1"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/test_mastery_api_documents.py -q
```

Expected: FAIL because `/mastery/documents` is not registered.

- [ ] **Step 3: Add schema models**

In `src/schemas/mastery.py`, define request/response classes:

```python
class MasteryDocumentSummary(BaseModel): ...
class MasteryDocumentListResponse(BaseModel): documents: list[MasteryDocumentSummary]
class MasteryDocumentDetailResponse(BaseModel): ...
class StudyResponse(BaseModel): ...
class QuizRequest(BaseModel): ...
class QuizResponse(BaseModel): ...
class GradeRequest(BaseModel): answer: str
class GradeResponse(BaseModel): ...
class AssessRequest(BaseModel): passed: bool; feedback: str = ""
```

Use `ConfigDict(extra="ignore")`.

- [ ] **Step 4: Add router**

In `src/api/mastery.py`, add dependency:

```python
def get_mastery_service(request: Request) -> MasteryService:
    return request.app.state.mastery_service
```

Implement all routes by delegating to `MasteryService`. Raise `NotFoundError` when `MasteryService` returns no progress for `doc_id`. Raise `ValidationError` when a build is requested before LightRAG status is `processed`, when `assess` is called for `memory` or `procedure`, or when `grade` is called with no answer text. Raise `ConflictError` when `quiz` is called while `progress.pending_question` already exists.

- [ ] **Step 5: Wire app startup**

In `src/services/__init__.py`, add:

```python
def create_mastery_service(llm_client: LLMClient, lightrag_client: LightRAGClient) -> "MasteryService":
    from ..mastery.service import MasteryService
    return MasteryService(llm=llm_client, lightrag=lightrag_client)
```

In `src/main.py`, import and include `mastery_router`, then in lifespan:

```python
    mastery_service = create_mastery_service(llm_client, lightrag_client)
    app.state.mastery_service = mastery_service
    logger.info("mastery service created")
```

And route registration:

```python
app.include_router(mastery_router)
```

- [ ] **Step 6: Run API tests**

Run:

```bash
pytest tests/test_mastery_api_documents.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/schemas/mastery.py src/api/mastery.py src/main.py src/services/__init__.py tests/test_mastery_api_documents.py
git commit -m "feat: expose mastery path api"
```

---

### Task 5: Frontend API, Upload Filtering, And Sidebar Shell

**Files:**
- Modify: `ui/src/api/types.ts`
- Modify: `ui/src/api/aitutor.ts`
- Modify: `ui/src/components/documents/UploadDocumentsDialog.tsx`
- Modify: `ui/src/components/ActivityBar.tsx`
- Modify: `ui/src/App.tsx`
- Create: `ui/src/features/MasterySidebar.tsx`

**Interfaces:**
- Produces: `MasteryDocumentSummary`, `MasteryDocumentDetail`, `MasteryMap`, `MasteryNextStep`
- Produces: `getMasteryDocuments()`
- Produces: `getMasteryDocument(docId: string)`
- Produces: `buildMasteryDocument(docId: string)`
- Produces: `studyKnowledgePoint(docId: string, kpId: string)`
- Produces: `createMasteryQuiz(docId: string, kpId: string)`
- Produces: `gradeMasteryAnswer(docId: string, answer: string)`
- Produces: `assessKnowledgePoint(docId: string, kpId: string, passed: boolean, feedback: string)`

- [ ] **Step 1: Add TypeScript API types**

In `ui/src/api/types.ts`, add:

```ts
export type MasteryBuildStatus = 'not_started' | 'queued' | 'building' | 'ready' | 'build_failed' | 'rag_failed'
export type MasteryKnowledgeType = 'memory' | 'concept' | 'procedure' | 'design'
export type MasteryObjectiveStatus = 'new' | 'learning' | 'mastered'

export interface MasteryDocumentSummary {
  doc_id: string
  title: string
  source_file: string
  rag_status: DocStatus | 'unknown'
  build_status: MasteryBuildStatus
  build_error?: string
  counts?: { total: number; mastered: number; learning: number; new: number }
  due_reviews?: number
}

export interface MasteryKnowledgePoint {
  id: string
  name: string
  type: MasteryKnowledgeType
  status: MasteryObjectiveStatus
  mastery: number
  description: string
  dependencies: string[]
}

export interface MasteryModule {
  id: string
  name: string
  order: number
  description: string
  mastered: number
  total: number
  knowledge_points: MasteryKnowledgePoint[]
}

export interface MasteryDocumentDetail {
  doc_id: string
  title: string
  rag_status: string
  build_status: MasteryBuildStatus
  build_error?: string
  next: Record<string, unknown>
  map: {
    counts: { total: number; mastered: number; learning: number; new: number }
    due_reviews: number
    complete: boolean
    modules: MasteryModule[]
  }
}
```

Also change `UploadResult`:

```ts
export interface UploadResult {
  status: 'success' | 'partial_success' | 'failure'
  message: string
  track_id?: string
}
```

- [ ] **Step 2: Add API functions and mock data**

In `ui/src/api/aitutor.ts`, add:

```ts
export async function getMasteryDocuments(): Promise<{ documents: MasteryDocumentSummary[] }> {
  if (USE_MOCK) return { documents: mockMasteryDocuments }
  const resp = await api.get<{ documents: MasteryDocumentSummary[] }>('/mastery/documents')
  return resp.data
}

export async function getMasteryDocument(docId: string): Promise<MasteryDocumentDetail> {
  if (USE_MOCK) return mockMasteryDetail(docId)
  const resp = await api.get<MasteryDocumentDetail>(`/mastery/documents/${encodeURIComponent(docId)}`)
  return resp.data
}
```

Add the rest of the functions for build, study, quiz, grade, assess, reset, and delete using the paths in the spec.

- [ ] **Step 3: Restrict upload picker**

In `ui/src/components/documents/UploadDocumentsDialog.tsx`, configure dropzone/input accept:

```ts
const ACCEPTED_DOCUMENT_TYPES = {
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
}
```

Show rejected files with text:

```text
仅支持 TXT、MD、PDF、DOCX 文件
```

- [ ] **Step 4: Add ActivityBar mode**

Change `ActivityBarProps` to:

```ts
export type SidebarMode = 'documents' | 'mastery'

interface ActivityBarProps {
  sidebarOpen: boolean
  activeMode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
  onToggleSidebar: () => void
}
```

Render `FileTextIcon` and `NetworkIcon` or `BrainCircuitIcon` buttons with tooltips `文档管理` and `知识点`.

- [ ] **Step 5: Render MasterySidebar in App**

In `ui/src/App.tsx`, add:

```ts
const [sidebarMode, setSidebarMode] = useState<SidebarMode>('documents')
```

Render:

```tsx
{sidebarMode === 'documents' ? (
  <DocumentManager onCollapse={() => setSidebarOpen(false)} />
) : (
  <MasterySidebar onCollapse={() => setSidebarOpen(false)} />
)}
```

- [ ] **Step 6: Create MasterySidebar shell**

`MasterySidebar` should load `getMasteryDocuments()` on mount and every 10 seconds while any document is not `ready` or failed. It renders document rows with badges:

- `处理中`
- `构建中`
- `可学习`
- `构建失败`
- `RAG 失败`

- [ ] **Step 7: Run frontend typecheck**

Run:

```bash
cd ui && npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/src/api/types.ts ui/src/api/aitutor.ts ui/src/components/documents/UploadDocumentsDialog.tsx ui/src/components/ActivityBar.tsx ui/src/App.tsx ui/src/features/MasterySidebar.tsx
git commit -m "feat: add mastery sidebar shell"
```

---

### Task 6: Knowledge Tree Visualization And Dialog Learning Flow

**Files:**
- Modify: `ui/src/features/MasterySidebar.tsx`
- Create: `ui/src/components/mastery/MasteryTree.tsx`
- Create: `ui/src/components/mastery/KnowledgePointDialog.tsx`
- Create: `ui/src/components/mastery/QuizDialog.tsx`
- Create: `ui/src/components/mastery/ReviewDialog.tsx`
- Create: `ui/src/components/mastery/BuildStatusDialog.tsx`
- Create: `ui/src/components/mastery/ResetProgressDialog.tsx`

**Interfaces:**
- Consumes: Mastery API functions from Task 5.
- Produces: Dialog-centered study, quiz, review, build retry, and reset UI.

- [ ] **Step 1: Implement MasteryTree**

Render modules as collapsible vertical groups. Each KP row uses fixed dimensions and a status icon:

- `Circle` for new.
- `CircleDot` for learning.
- `CircleCheck` for mastered.
- `AlertTriangle` for active error/build problem.
- `Clock` for due review.

Expose:

```ts
interface MasteryTreeProps {
  modules: MasteryModule[]
  selectedKnowledgePointId?: string
  onKnowledgePointClick: (kp: MasteryKnowledgePoint, module: MasteryModule) => void
}
```

- [ ] **Step 2: Implement KnowledgePointDialog**

Props:

```ts
interface KnowledgePointDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docId: string
  module: MasteryModule | null
  knowledgePoint: MasteryKnowledgePoint | null
  onChanged: () => void
}
```

Show name, type, mastery, description, dependencies, and buttons:

- `学习`
- `测验`
- `费曼解释` for `concept` and `design`

- [ ] **Step 3: Implement QuizDialog**

Use `createMasteryQuiz(docId, kpId)` to fetch a pending question, collect the learner answer, and call `gradeMasteryAnswer(docId, answer)`. After grading, show correctness, mastery, and next action.

- [ ] **Step 4: Implement ReviewDialog**

Start from detail `map.due_reviews`. If no due review, render a compact empty state. If due, open the first due objective using the same quiz or assessment flow based on knowledge type.

- [ ] **Step 5: Implement BuildStatusDialog**

Show RAG status, build status, build error, and retry button. The retry button calls `buildMasteryDocument(docId)` and refreshes sidebar state.

- [ ] **Step 6: Implement ResetProgressDialog**

Call reset API and refresh detail. Confirm copy:

```text
重置后会保留知识树，但清空掌握度、答题记录、错误记录和复习计划。
```

- [ ] **Step 7: Integrate dialogs into MasterySidebar**

`MasterySidebar` maintains selected document, selected KP, active dialog, and detail refresh. It must not render a tree when:

- `rag_status !== 'processed'`
- `build_status !== 'ready'`

- [ ] **Step 8: Run frontend typecheck**

Run:

```bash
cd ui && npm run lint
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src/features/MasterySidebar.tsx ui/src/components/mastery
git commit -m "feat: add mastery tree dialogs"
```

---

### Task 7: End-To-End Verification And Polish

**Files:**
- Modify: only files changed by Tasks 1-6 when a verification command exposes a defect in those changes.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified module.

- [ ] **Step 1: Run backend tests**

Run:

```bash
pytest tests/test_mastery_grading_policy.py tests/test_mastery_storage_builder.py tests/test_mastery_api_documents.py -q
```

Expected: PASS.

- [ ] **Step 2: Run existing backend tests**

Run:

```bash
pytest tests -q
```

Expected: PASS. If existing unrelated tests fail, record exact failures and avoid changing unrelated behavior.

- [ ] **Step 3: Run frontend checks**

Run:

```bash
cd ui && npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run local app smoke test**

Start backend:

```bash
uvicorn src.main:app --reload --port 8000
```

Start frontend:

```bash
cd ui && npm run dev
```

Manual checks:

- Upload `.txt` succeeds.
- Upload `.png` is rejected in the UI.
- Duplicate upload returns conflict and no Mastery document appears.
- Knowledge Points sidebar shows processing before RAG completion.
- A ready document shows the knowledge tree.
- Clicking a KP opens the dialog.
- A quiz answer changes progress.

- [ ] **Step 5: Final commit if polish changes were required**

```bash
git status --short
git add src/mastery src/api/mastery.py src/api/documents.py src/schemas/mastery.py src/schemas/documents.py src/services/lightrag_client.py src/services/__init__.py src/main.py src/core/config.py ui/src/api/types.ts ui/src/api/aitutor.ts ui/src/components/ActivityBar.tsx ui/src/components/documents/UploadDocumentsDialog.tsx ui/src/components/mastery ui/src/features/MasterySidebar.tsx tests/test_mastery_grading_policy.py tests/test_mastery_storage_builder.py tests/test_mastery_api_documents.py
git commit -m "fix: polish mastery path flow"
```

Only run this commit if Step 1-4 required code changes.

---

## Plan Self-Review

Spec coverage:

- Upload type limits are covered in Task 1 and Task 5.
- LightRAG `track_id` to `doc_id` status flow is covered in Task 1, Task 3, and Task 4.
- JSON storage under `data/mastery_paths/` is covered in Task 3.
- DeepTutor-style deterministic gates are covered in Task 2.
- Knowledge tree construction without chunking is covered in Task 3.
- Dialog-centered frontend is covered in Task 6.
- Testing and manual verification are covered in Task 7.

Placeholder scan:

- No `TBD`, `TODO`, or undefined task references are used.
- Every task names exact files, interfaces, commands, and expected outcomes.

Type consistency:

- Backend uses `doc_id`, `track_id`, `build_status`, `rag_status`, `modules`, `knowledge_points`, and `mastery` consistently.
- Frontend types mirror backend response names.
- Quantitative and qualitative gates match the approved design spec.
