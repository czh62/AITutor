# Mastery Path Module Design

## Goal

Add a DeepTutor-style Mastery Path module to AITutor. The module turns each supported uploaded document into a comprehensive knowledge tree, then guides the learner through study, quiz, Feynman-style explanation, error recovery, and spaced review. LightRAG remains the source of truth for document ingestion status; the knowledge tree is only visible after the corresponding LightRAG document is fully processed.

## Scope

The first version supports only these upload/build input formats:

- `.txt`
- `.md`
- `.pdf`
- `.docx`

The frontend filters the upload picker to these formats. The backend validates both file extension and content type before forwarding the file to LightRAG. Unsupported files are rejected before they enter either LightRAG or the Mastery Path build pipeline.

This module is document-scoped. A Mastery Path is associated with LightRAG's final `doc_id`, not with the file name or upload `track_id`.

## Design Principles

LightRAG owns ingestion state. If LightRAG returns HTTP 409, rejects the file, is still processing, or marks the document failed, AITutor must not build or render a knowledge tree.

The LLM owns teaching creativity. It can explain, build the initial knowledge tree, propose quiz questions, and provide feedback text.

The Mastery engine owns gates. Advancement, mastery, review scheduling, and quiz grading are deterministic and cannot be bypassed by the LLM.

The UI is dialog-centered. The sidebar and tree show context and progress; study, quiz, review, and build status happen in focused dialogs.

## Architecture

The module is implemented as a new backend service area plus a new frontend sidebar feature.

Backend:

- `src/mastery/` contains the pure Mastery engine and persistence.
- `src/api/mastery.py` exposes document-scoped Mastery APIs.
- `src/services/lightrag_client.py` is extended to expose `track_id` from upload responses and proxy `/documents/track_status/{track_id}`.
- `src/api/documents.py` validates supported upload types and registers accepted uploads for Mastery build tracking.

Frontend:

- `ui/src/components/ActivityBar.tsx` gains a knowledge-point icon.
- `ui/src/features/MasterySidebar.tsx` lists document paths and their Mastery status.
- `ui/src/components/mastery/` contains the tree, status panels, and learning dialogs.
- `ui/src/api/aitutor.ts` and `ui/src/api/types.ts` add Mastery API methods and types.

## Data Storage

The first version stores Mastery data in JSON files under:

```text
data/mastery_paths/
```

The existing SQLite database is not used for Mastery progress because the current app lifespan resets the SQLite file at startup. Mastery progress must survive backend restarts.

Files:

```text
data/mastery_paths/index.json
data/mastery_paths/documents/{doc_id}.json
data/mastery_paths/build_jobs/{track_id}.json
```

`index.json` maps known documents and tracks list-level metadata.

`documents/{doc_id}.json` stores the full `LearningProgress` object, including modules, knowledge points, mastery levels, quiz attempts, qualitative mastery, error records, repetition states, review queue, pending question, and build metadata.

`build_jobs/{track_id}.json` stores upload tracking before the final LightRAG `doc_id` is known.

All writes are atomic: write a temporary file, then replace the target file.

## LightRAG Status Flow

Upload flow:

1. Frontend accepts only TXT, MD, PDF, DOCX files.
2. Backend validates file extension and content type.
3. Backend forwards valid files to LightRAG `/documents/upload`.
4. If LightRAG returns HTTP 409, the request fails and no Mastery build job is created.
5. If LightRAG returns success, backend returns `track_id` to the frontend and stores a pending build job.
6. A background poller calls `/documents/track_status/{track_id}`.
7. When the track status yields a document with `status=processed`, AITutor records the final `doc_id` and starts the knowledge tree build.
8. If the document reaches `failed`, AITutor marks the Mastery document as `rag_failed` and does not build.

Rendering rule:

- `pending`, `parsing`, `analyzing`, `processing`, and `preprocessed`: show processing state.
- `failed`: show RAG failed state and the LightRAG error message.
- `processed` with no Mastery tree yet: show building state or build retry action.
- `processed` with a valid Mastery tree: render the knowledge tree.

## Supported File Extraction

Knowledge tree construction uses the uploaded document content without chunking.

Extraction rules:

- TXT and MD are read as UTF-8 text, with a conservative fallback for common encoding errors.
- PDF text is extracted with a Python PDF text extraction library.
- DOCX text is extracted with a Python DOCX text extraction library.

If extraction produces empty text, the build fails with `empty_content`.

If the extracted text exceeds the configured maximum single-call size, the build fails with `document_too_large`. The first version must not silently split the document because the requirement is to pass the document to the LLM without chunking.

The build prompt asks the LLM to output strict JSON with modules, knowledge point descriptions, type labels, and dependencies.

Expected LLM structure:

```json
{
  "title": "文档学习路线",
  "summary": "整体学习说明",
  "modules": [
    {
      "name": "模块名",
      "description": "模块说明",
      "knowledge_points": [
        {
          "name": "知识点",
          "type": "memory",
          "description": "知识点内容和学习目标",
          "dependencies": ["前置知识点名称"]
        }
      ]
    }
  ]
}
```

Allowed knowledge point types:

- `memory`
- `concept`
- `procedure`
- `design`

Unknown or invalid types are coerced to `concept`. IDs are generated by the backend, never by the LLM.

Dependencies are resolved by knowledge point name. Missing dependency names are ignored and recorded as warnings in build metadata.

## Mastery Engine

The engine mirrors DeepTutor's deterministic Mastery Path behavior.

Core models:

- `KnowledgePoint`
- `LearningModule`
- `LearningProgress`
- `QuizAttempt`
- `PendingQuestion`
- `ErrorRecord`
- `RepetitionState`
- `ReviewTask`

Knowledge types:

- `memory`: quantitative gate, mastery must be at least `0.9`.
- `procedure`: quantitative gate, mastery must be at least `0.9`.
- `concept`: qualitative gate through Feynman explanation.
- `design`: qualitative gate through Feynman explanation.

Quantitative mastery:

- Use recent weighted correctness.
- One correct answer is capped at `0.5`.
- Two correct answers are capped at `0.8`.
- At least three stable attempts are needed to cross the `0.9` gate.

Qualitative mastery:

- `assess` records whether the learner's explanation passed.
- Passed concepts/design points display mastery `1.0`.
- Failed assessments cap display mastery at `0.4`.

Next objective priority:

1. Pending question awaiting grading.
2. Due spaced-review task.
3. First unmastered knowledge point in module order.
4. Complete.

Spaced review intervals:

- `memory`: `[0, 1, 3, 7, 14, 30, 60]`
- `concept`: `[3, 7, 14, 30]`
- `procedure`: `[3, 7, 14]`
- `design`: `[14, 28]`

Review priority:

1. Active or retrying error records.
2. Memory.
3. Concept.
4. Procedure.
5. Design.

## Backend APIs

`GET /mastery/documents`

Returns every known Mastery document with LightRAG status, build status, progress summary, and display name.

`GET /mastery/documents/{doc_id}`

Returns the full map summary, next objective, modules, knowledge points, dependency edges, build metadata, and LightRAG status.

`POST /mastery/documents/{doc_id}/build`

Manually starts or retries knowledge tree build. It is allowed only when LightRAG status is `processed`.

`POST /mastery/documents/{doc_id}/study/{kp_id}`

Generates a focused learning explanation for a knowledge point. The response includes the knowledge point description, dependency context, and tutor explanation text.

`POST /mastery/documents/{doc_id}/quiz/{kp_id}`

Generates and stores a pending question. The expected answer stays server-side and is not returned to the frontend.

`POST /mastery/documents/{doc_id}/grade`

Grades the learner's answer against the stored pending answer, updates attempts, mastery, errors, repetition state, and the next objective.

`POST /mastery/documents/{doc_id}/assess`

Records a qualitative pass/fail for `concept` and `design` points. It rejects `memory` and `procedure` points.

`POST /mastery/documents/{doc_id}/reset`

Keeps the knowledge tree but clears mastery levels, quiz attempts, pending questions, qualitative mastery, error records, repetition states, and review queue.

`DELETE /mastery/documents/{doc_id}`

Deletes the local Mastery Path only. It does not delete the LightRAG document.

## Frontend Experience

The existing `qa` tab keeps its layout: ActivityBar, left sidebar, and QAPanel.

ActivityBar has two modes:

- Documents.
- Knowledge points.

When Documents is active, the current `DocumentManager` appears.

When Knowledge Points is active, `MasterySidebar` appears. It includes:

- Document list with build/RAG badges.
- Progress summary for the selected document.
- Knowledge tree view.
- Next objective panel.
- Review queue indicator.

Tree node states:

- `processing`: RAG or Mastery build is not ready.
- `new`: no attempt yet.
- `learning`: attempted but below gate.
- `mastered`: gate passed.
- `review_due`: spaced review due.
- `error`: active error record.

Dialogs:

- `BuildStatusDialog`: shows RAG state, build state, errors, and retry.
- `KnowledgePointDialog`: shows description, dependencies, learning explanation, and actions.
- `QuizDialog`: shows the current pending question and answer input.
- `ReviewDialog`: walks through due reviews, prioritizing errors.
- `ResetProgressDialog`: confirms progress reset.

The tree is not shown for a document until LightRAG reports `processed` and a valid Mastery tree exists.

## Error Handling

Unsupported files:

- Frontend blocks them in the picker.
- Backend rejects them with `400 validation_error`.

LightRAG conflict:

- Backend returns the propagated conflict.
- No Mastery job is created.
- UI shows upload conflict through the existing upload error path.

LightRAG processing failure:

- Mastery status becomes `rag_failed`.
- UI shows LightRAG error details.
- Build/retry is disabled until the document is reprocessed successfully.

Build failure:

- Mastery status becomes `build_failed`.
- UI shows the failure reason and a retry button if LightRAG status is still `processed`.

Pending question safety:

- If no pending expected answer exists, grading fails closed and records an incorrect attempt.

## Testing Strategy

Backend tests:

- Upload validation accepts TXT, MD, PDF, DOCX and rejects other extensions.
- Backend does not create a build job after LightRAG 409.
- Track status with non-processed states keeps Mastery in processing.
- Track status with `failed` marks Mastery as `rag_failed`.
- Track status with `processed` starts build and stores progress by `doc_id`.
- Invalid LLM type is coerced to `concept`.
- Missing dependency names are ignored and recorded as warnings.
- One correct quantitative answer caps mastery at `0.5`.
- Two correct quantitative answers cap mastery at `0.8`.
- Three stable correct answers can cross `0.9`.
- Qualitative assessment only applies to `concept` and `design`.
- Reset clears progress but preserves modules and knowledge points.

Frontend tests:

- Upload dialog only accepts TXT, MD, PDF, DOCX.
- Knowledge sidebar shows processing state before RAG completion.
- Knowledge tree is hidden until `processed` and build complete.
- Clicking a node opens `KnowledgePointDialog`.
- Grading updates node status and progress.
- Due review indicator appears when reviews are due.
- RAG failure and build failure render distinct states.

Manual verification:

- `cd ui && npm run lint`
- Backend unit tests for Mastery engine and API.
- Upload a TXT fixture and verify the tree appears only after LightRAG reports `processed`.
- Upload a duplicate file and verify no Mastery job is created.

## Implementation Phases

Phase 1: Upload type validation and LightRAG tracking.

Phase 2: Mastery engine and JSON persistence.

Phase 3: Knowledge tree builder for TXT, MD, PDF, DOCX.

Phase 4: Mastery APIs.

Phase 5: Frontend sidebar, tree visualization, and dialogs.

Phase 6: Tests and manual verification.

## Non-Goals

The first version does not support every LightRAG upload type.

The first version does not chunk large documents for Mastery tree generation.

The first version does not merge multiple documents into one learning path.

The first version does not delete LightRAG documents when deleting local Mastery progress.

The first version does not make the main QAPanel a full Mastery tutor loop. The module can later be connected to AgentLoop tools, but the initial learning flow is API-driven dialogs.
