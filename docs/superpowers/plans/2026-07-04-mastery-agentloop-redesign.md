# Mastery AgentLoop Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Knowledge Points module so the sidebar navigates and tracks learning while AgentLoop QA handles guided learning and the existing quiz flow handles tests.

**Architecture:** Backend Mastery point-action endpoints produce guided prompts and record state changes. Frontend QAPanel consumes queued commands from the QA store and reuses existing query and quiz streaming paths. MasterySidebar becomes a learning control panel that selects points, injects commands into QA, and records explicit learner actions.

**Tech Stack:** FastAPI, Pydantic v2, JSON MasteryStore, React 19, TypeScript, Zustand, Vite, existing AgentLoop query stream, existing QuizViewer stream.

## Global Constraints

- Knowledge tree generation and RAG status behavior from the existing Mastery module remain unchanged.
- Actual knowledge-point learning must use the existing `/query/stream` AgentLoop path.
- Knowledge-point quizzes must use the existing `/quiz/generate/stream` path and QuizViewer.
- The primary knowledge-point click must not open a learning modal.
- AgentLoop completion must not automatically mark a knowledge point as mastered.
- MasterySidebar must record explicit learner actions: start learning, self assess, quiz started, review later.
- Unsupported upload types remain limited to TXT, MD, PDF, DOCX.
- Existing user changes must not be reverted.

---

## File Structure

Modify:

- `src/mastery/models.py`: add lightweight point interaction records.
- `src/mastery/service.py`: add point-action methods and guided prompt builder.
- `src/schemas/mastery.py`: add point-action response/request schemas.
- `src/api/mastery.py`: expose point-action routes.
- `tests/test_mastery_api_documents.py`: test route behavior with fake service.
- `tests/test_mastery_storage_builder.py`: test service prompt/state behavior.
- `ui/src/api/types.ts`: add point-action response and QA command types.
- `ui/src/api/aitutor.ts`: add point-action client functions.
- `ui/src/stores/qa.ts`: add command queue.
- `ui/src/features/QAPanel.tsx`: consume queued query/quiz commands through existing handlers.
- `ui/src/features/MasterySidebar.tsx`: replace learning dialog flow with direct QA injection and action panel.
- `ui/src/components/mastery/MasteryTree.tsx`: keep tree but make selected active state clearer if needed.

Delete if unreferenced:

- `ui/src/components/mastery/KnowledgePointDialog.tsx`
- `ui/src/components/mastery/QuizDialog.tsx`
- `ui/src/components/mastery/ReviewDialog.tsx`

Keep:

- `ui/src/components/mastery/BuildStatusDialog.tsx`
- `ui/src/components/mastery/ResetProgressDialog.tsx`

---

### Task 1: Backend Point Action API

**Files:**
- Modify: `src/mastery/models.py`
- Modify: `src/mastery/service.py`
- Modify: `src/schemas/mastery.py`
- Modify: `src/api/mastery.py`
- Test: `tests/test_mastery_storage_builder.py`
- Test: `tests/test_mastery_api_documents.py`

**Interfaces:**
- Produces: `MasteryService.start_point_learning(doc_id: str, kp_id: str) -> dict[str, Any]`
- Produces: `MasteryService.self_assess_point(doc_id: str, kp_id: str, passed: bool, note: str = "") -> dict[str, Any]`
- Produces: `MasteryService.record_quiz_started(doc_id: str, kp_id: str) -> dict[str, Any]`
- Produces: `MasteryService.schedule_review_later(doc_id: str, kp_id: str) -> dict[str, Any]`
- Produces: `POST /mastery/documents/{doc_id}/points/{kp_id}/start`
- Produces: `POST /mastery/documents/{doc_id}/points/{kp_id}/self-assess`
- Produces: `POST /mastery/documents/{doc_id}/points/{kp_id}/quiz-started`
- Produces: `POST /mastery/documents/{doc_id}/points/{kp_id}/review-later`

- [ ] **Step 1: Write failing service tests**

Add tests to `tests/test_mastery_storage_builder.py`:

```python
def make_learning_progress_for_actions() -> LearningProgress:
    kp_a = KnowledgePoint(
        id="doc-1_m0_kp0",
        name="检索增强生成",
        type=KnowledgeType.CONCEPT,
        module_id="doc-1_m0",
        description="结合检索和生成回答问题。",
    )
    kp_b = KnowledgePoint(
        id="doc-1_m0_kp1",
        name="向量检索",
        type=KnowledgeType.MEMORY,
        module_id="doc-1_m0",
        description="用向量相似度找相关内容。",
    )
    kp_a.dependencies = [kp_b.id]
    module = LearningModule(
        id="doc-1_m0",
        name="RAG 基础",
        order=0,
        knowledge_points=[kp_b, kp_a],
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

    result = service.start_point_learning("doc-1", "doc-1_m0_kp0")

    assert result["doc_id"] == "doc-1"
    assert result["knowledge_point_id"] == "doc-1_m0_kp0"
    assert "请作为 AI Tutor" in result["prompt"]
    assert "RAG 文档" in result["prompt"]
    assert "RAG 基础" in result["prompt"]
    assert "检索增强生成" in result["prompt"]
    assert "结合检索和生成回答问题" in result["prompt"]
    assert "向量检索" in result["prompt"]
    progress = store.load_progress("doc-1")
    assert progress is not None
    assert progress.mastery_levels["doc-1_m0_kp0"] == 0.1
    assert progress.qualitative_mastery.get("doc-1_m0_kp0") is None


def test_point_actions_update_progress_without_agentloop_grading(tmp_path):
    store = MasteryStore(root=tmp_path)
    store.save_progress(make_learning_progress_for_actions())
    service = MasteryService(
        llm=FakeLLM("{}"),
        lightrag=FakeLightRAG({"documents": []}),
        store=store,
        builder=FakeBuilder(),
    )

    quiz_result = service.record_quiz_started("doc-1", "doc-1_m0_kp0")
    assert quiz_result["map"]["counts"]["learning"] == 1

    review_result = service.schedule_review_later("doc-1", "doc-1_m0_kp0")
    assert review_result["map"]["due_reviews"] >= 0

    assessed = service.self_assess_point("doc-1", "doc-1_m0_kp0", passed=True, note="能讲清楚")
    assert assessed["map"]["counts"]["mastered"] == 1
```

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
pytest tests/test_mastery_storage_builder.py -q
```

Expected: FAIL because point-action service methods do not exist.

- [ ] **Step 3: Implement models and service methods**

In `src/mastery/models.py`, add fields to `LearningProgress`:

```python
    active_knowledge_point_id: str = ""
    started_points: dict[str, float] = Field(default_factory=dict)
    quiz_started_points: dict[str, float] = Field(default_factory=dict)
    review_later_points: dict[str, float] = Field(default_factory=dict)
```

In `src/mastery/service.py`, add:

```python
    def start_point_learning(self, doc_id: str, kp_id: str) -> dict[str, Any]:
        progress = self._require_progress(doc_id)
        kp, module_id, module_name = find_knowledge_point(progress, kp_id)
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
```

Add analogous methods:

```python
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
```

Add helpers:

```python
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
        dependencies = "、".join(dependency_titles) if dependency_titles else "无明确前置依赖"
        return (
            f"请作为 AI Tutor，围绕当前文档中的知识点「{kp.name}」带我学习。\n\n"
            f"上下文：\n"
            f"- 文档：{progress.title or progress.source_file or progress.doc_id}\n"
            f"- 模块：{module_name or kp.module_id}\n"
            f"- 知识点描述：{kp.description or '暂无描述'}\n"
            f"- 前置依赖：{dependencies}\n\n"
            "要求：\n"
            "1. 先用直观语言解释它是什么；\n"
            "2. 说明它依赖哪些前置知识；\n"
            "3. 结合文档内容给一个例子；\n"
            "4. 最后问我一个理解检查问题；\n"
            "5. 如果我的背景或目标不清楚，使用 ask_user 追问后再继续。"
        )
```

Import `time` and `KnowledgePoint` as needed.

- [ ] **Step 4: Add schemas and routes**

In `src/schemas/mastery.py`, add:

```python
class StartPointResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    doc_id: str
    knowledge_point_id: str
    prompt: str
    document: dict[str, Any]


class SelfAssessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    passed: bool
    note: str = ""
```

In `src/api/mastery.py`, import these schemas and add routes:

```python
@router.post("/documents/{doc_id}/points/{kp_id}/start", response_model=StartPointResponse)
async def start_point_learning(...):
    _require_progress(service, doc_id)
    return service.start_point_learning(doc_id, kp_id)
```

Add `self-assess`, `quiz-started`, and `review-later` routes returning `MasteryDocumentDetailResponse`.

- [ ] **Step 5: Update route fake and tests**

In `tests/test_mastery_api_documents.py`, extend `FakeMasteryService`:

```python
    def start_point_learning(self, doc_id, kp_id):
        return {
            "doc_id": doc_id,
            "knowledge_point_id": kp_id,
            "prompt": "请作为 AI Tutor...",
            "document": self.get_document_payload(doc_id),
        }

    def self_assess_point(self, doc_id, kp_id, *, passed, note=""):
        return self.get_document_payload(doc_id)

    def record_quiz_started(self, doc_id, kp_id):
        return self.get_document_payload(doc_id)

    def schedule_review_later(self, doc_id, kp_id):
        return self.get_document_payload(doc_id)
```

Add route tests:

```python
def test_start_point_learning_route_returns_prompt():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    response = client.post("/mastery/documents/doc-1/points/doc-1_m0_kp0/start")
    assert response.status_code == 200
    assert response.json()["knowledge_point_id"] == "doc-1_m0_kp0"
    assert "AI Tutor" in response.json()["prompt"]


def test_point_action_routes_return_detail_payload():
    app = create_app()
    app.state.mastery_service = FakeMasteryService()
    client = TestClient(app)
    assert client.post("/mastery/documents/doc-1/points/doc-1_m0_kp0/quiz-started").status_code == 200
    assert client.post("/mastery/documents/doc-1/points/doc-1_m0_kp0/review-later").status_code == 200
    response = client.post(
        "/mastery/documents/doc-1/points/doc-1_m0_kp0/self-assess",
        json={"passed": True, "note": "理解了"},
    )
    assert response.status_code == 200
```

- [ ] **Step 6: Run backend tests**

Run:

```bash
pytest tests/test_mastery_storage_builder.py tests/test_mastery_api_documents.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mastery/models.py src/mastery/service.py src/schemas/mastery.py src/api/mastery.py tests/test_mastery_storage_builder.py tests/test_mastery_api_documents.py
git commit -m "feat: add mastery point actions"
```

---

### Task 2: QA Command Queue

**Files:**
- Modify: `ui/src/api/types.ts`
- Modify: `ui/src/stores/qa.ts`
- Modify: `ui/src/features/QAPanel.tsx`

**Interfaces:**
- Produces: `QACommand`
- Produces: `useQAStore.enqueueCommand(command: QACommand) -> void`
- Produces: `useQAStore.consumeCommand(id: string) -> void`
- Consumes: existing `queryStream`, `quizGenerateStream`, and QAPanel stream callbacks.

- [ ] **Step 1: Add command types**

In `ui/src/api/types.ts`, add:

```ts
export type QACommand =
  | {
      id: string
      kind: 'query'
      prompt: string
      metadata?: { source: 'mastery'; docId: string; knowledgePointId: string }
    }
  | {
      id: string
      kind: 'quiz'
      topic: string
      num_questions: number
      difficulty: QuizDifficulty
      question_types: QuizQuestionType[]
      metadata?: { source: 'mastery'; docId: string; knowledgePointId: string }
    }
```

- [ ] **Step 2: Add QA store queue**

In `ui/src/stores/qa.ts`, import `QACommand` and add:

```ts
  pendingCommands: QACommand[]
  enqueueCommand: (command: QACommand) => void
  consumeCommand: (id: string) => void
```

Implement:

```ts
      pendingCommands: [],
      enqueueCommand: (command) =>
        set((state) => ({ pendingCommands: [...state.pendingCommands, command] })),
      consumeCommand: (id) =>
        set((state) => ({
          pendingCommands: state.pendingCommands.filter((command) => command.id !== id)
        })),
```

Do not persist `pendingCommands` in `partialize`.

- [ ] **Step 3: Refactor QAPanel handlers**

In `ui/src/features/QAPanel.tsx`, extract:

```ts
const runQuery = useCallback(async (query: string) => { ...existing handleSend body... }, [...])
const runQuiz = useCallback(async (config) => { ...existing handleQuizConfirm body... }, [...])
```

Change manual `handleSend` to call `runQuery(input.trim())`.

Change `handleQuizConfirm` to call `runQuiz(config)`.

- [ ] **Step 4: Consume pending commands**

In `QAPanel`, read:

```ts
const pendingCommands = useQAStore((state) => state.pendingCommands)
const consumeCommand = useQAStore((state) => state.consumeCommand)
```

Add effect:

```ts
useEffect(() => {
  if (isStreaming || pendingCommands.length === 0) return
  const command = pendingCommands[0]
  consumeCommand(command.id)
  if (command.kind === 'query') {
    void runQuery(command.prompt)
  } else {
    void runQuiz({
      topic: command.topic,
      num_questions: command.num_questions,
      difficulty: command.difficulty,
      question_types: command.question_types
    })
  }
}, [consumeCommand, isStreaming, pendingCommands, runQuery, runQuiz])
```

- [ ] **Step 5: Run frontend typecheck**

Run:

```bash
cd ui && npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/api/types.ts ui/src/stores/qa.ts ui/src/features/QAPanel.tsx
git commit -m "feat: queue qa commands"
```

---

### Task 3: Frontend Point Actions And Sidebar Redesign

**Files:**
- Modify: `ui/src/api/types.ts`
- Modify: `ui/src/api/aitutor.ts`
- Modify: `ui/src/features/MasterySidebar.tsx`
- Modify: `ui/src/components/mastery/MasteryTree.tsx`
- Delete: `ui/src/components/mastery/KnowledgePointDialog.tsx`
- Delete: `ui/src/components/mastery/QuizDialog.tsx`
- Delete: `ui/src/components/mastery/ReviewDialog.tsx`

**Interfaces:**
- Consumes: `QACommand`, `enqueueCommand`, point-action API functions.
- Produces: direct point-click-to-AgentLoop flow.

- [ ] **Step 1: Add frontend point-action types and API calls**

In `ui/src/api/types.ts`, add:

```ts
export interface StartKnowledgePointLearningResponse {
  doc_id: string
  knowledge_point_id: string
  prompt: string
  document: MasteryDocumentDetail
}
```

In `ui/src/api/aitutor.ts`, add:

```ts
export async function startKnowledgePointLearning(docId: string, knowledgePointId: string): Promise<StartKnowledgePointLearningResponse> { ... }
export async function selfAssessKnowledgePoint(docId: string, knowledgePointId: string, passed: boolean, note?: string): Promise<MasteryDocumentDetail> { ... }
export async function recordKnowledgePointQuizStarted(docId: string, knowledgePointId: string): Promise<MasteryDocumentDetail> { ... }
export async function scheduleKnowledgePointReview(docId: string, knowledgePointId: string): Promise<MasteryDocumentDetail> { ... }
```

Normalize `document` with `normalizeMasteryDetail()`.

- [ ] **Step 2: Remove dialog imports and state from MasterySidebar**

Remove imports and state for:

- `KnowledgePointDialog`
- `ReviewDialog`
- `pointDialogOpen`
- `reviewDialogOpen`

Keep `BuildStatusDialog` and `ResetProgressDialog`.

- [ ] **Step 3: Add active point panel**

In `MasterySidebar`, read:

```ts
const enqueueCommand = useQAStore((state) => state.enqueueCommand)
```

Add helpers:

```ts
function commandId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
```

Add action handlers:

```ts
const handleKnowledgePointClick = async (point, module) => {
  setSelectedPoint(point)
  setSelectedModule(module)
  const result = await startKnowledgePointLearning(selectedDocument.doc_id, point.id)
  setDetail(result.document)
  enqueueCommand({ id: commandId('mastery-query'), kind: 'query', prompt: result.prompt, metadata: { source: 'mastery', docId: selectedDocument.doc_id, knowledgePointId: point.id } })
}
```

`handleContinueLearning` enqueues a shorter query prompt:

```text
我想继续追问刚才的知识点「{title}」。请结合当前文档继续带我理解，并先问我一个能暴露理解盲区的问题。
```

`handleQuiz` calls `recordKnowledgePointQuizStarted`, updates detail, and enqueues a quiz command with topic:

```text
文档《{document_title}》中的知识点「{point_title}」。重点考察：知识点定义、依赖关系、文档中的应用场景。
```

`handleUnderstood` calls `selfAssessKnowledgePoint(..., true)`.

`handleReviewLater` calls `scheduleKnowledgePointReview`.

- [ ] **Step 4: Render active point panel**

Below progress summary render a compact panel when `selectedPoint` exists:

- title and module
- description
- buttons: `继续追问`, `我理解了`, `出题测验`, `稍后复习`

Buttons should be disabled while an action is running.

- [ ] **Step 5: Delete obsolete primary learning dialogs**

Delete:

```bash
rm ui/src/components/mastery/KnowledgePointDialog.tsx ui/src/components/mastery/QuizDialog.tsx ui/src/components/mastery/ReviewDialog.tsx
```

Only do this after `rg "KnowledgePointDialog|QuizDialog|ReviewDialog" ui/src` shows no remaining imports.

- [ ] **Step 6: Run frontend typecheck**

Run:

```bash
cd ui && npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/api/types.ts ui/src/api/aitutor.ts ui/src/features/MasterySidebar.tsx ui/src/components/mastery/MasteryTree.tsx ui/src/components/mastery
git commit -m "feat: route mastery learning through qa"
```

---

### Task 4: Verification And Smoke Test

**Files:**
- Modify only files touched by Tasks 1-3 if verification exposes defects.

- [ ] **Step 1: Run backend tests**

Run:

```bash
pytest tests -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend checks**

Run:

```bash
cd ui && npm run lint
```

Expected: PASS.

- [ ] **Step 3: Local app smoke**

Start:

```bash
uvicorn src.main:app --reload --port 8000
cd ui && npm run dev -- --host 127.0.0.1 --port 5173
```

Verify in browser or through Playwright:

- Knowledge Points sidebar shows ready tree for an existing ready Mastery document.
- Clicking a point does not open a learning modal.
- Clicking a point appends a user message to QAPanel and starts an AgentLoop assistant stream.
- The selected point stays visible in the sidebar action panel.
- `继续追问` appends another query command.
- `出题测验` appends a QuizViewer message using existing quiz generation.
- `我理解了` updates the sidebar progress.
- `稍后复习` keeps the point selected and refreshes state.

- [ ] **Step 4: Final commit if smoke fixes were required**

Only if Step 1-3 required changes:

```bash
git add src ui tests
git commit -m "fix: polish mastery qa learning flow"
```

---

## Plan Self-Review

Spec coverage:

- AgentLoop learning is covered in Task 2 and Task 3.
- Existing quiz flow is covered in Task 2 and Task 3.
- Backend point-state recording is covered in Task 1.
- Modal removal and sidebar action panel are covered in Task 3.
- Verification and local smoke are covered in Task 4.

Placeholder scan:

- No TBD/TODO placeholders remain.
- All new function names and route paths are specified.

Type consistency:

- Backend route names match frontend API names.
- `QACommand` metadata names match Mastery API doc_id and knowledge_point_id.
