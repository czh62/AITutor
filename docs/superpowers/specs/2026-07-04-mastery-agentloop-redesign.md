# Mastery AgentLoop Redesign Spec

## Goal

Redesign the Knowledge Points module so it acts as a learning navigator and progress tracker, while actual learning happens in the existing Knowledge QA AgentLoop and testing happens in the existing quiz flow.

## Product Shape

The Knowledge Points sidebar owns document selection, the knowledge tree, route progress, and the currently selected learning objective. It no longer opens a dedicated teaching dialog as the main learning surface. When the learner clicks a knowledge point, the app injects a guided learning prompt into the main QA conversation and streams it through the existing AgentLoop.

The learner can then naturally follow up in the same conversation. The sidebar stays visible as context and offers small next actions for the active point: continue learning, mark understood, generate quiz, review later, and reset progress.

## Learning Flow

Clicking a ready knowledge point starts this flow:

1. The sidebar calls the Mastery API to mark the point as started and retrieve a guided prompt.
2. The frontend injects that prompt as a normal user message into QAPanel.
3. QAPanel uses the existing `queryStream()` AgentLoop path, so RAG, query rewriting, ask_user, trace panels, references, and follow-up questions continue to work.
4. The selected point changes to `learning`.
5. AgentLoop completion does not automatically mark mastery.
6. The learner explicitly chooses `我理解了`, `出题测验`, or `稍后复习` from the sidebar.

The guided prompt must be specific enough to make AgentLoop behave like a tutor:

```text
请作为 AI Tutor，围绕当前文档中的知识点「{knowledge_point_title}」带我学习。

上下文：
- 文档：{document_title}
- 模块：{module_title}
- 知识点描述：{description}
- 前置依赖：{dependency_titles}

要求：
1. 先用直观语言解释它是什么；
2. 说明它依赖哪些前置知识；
3. 结合文档内容给一个例子；
4. 最后问我一个理解检查问题；
5. 如果我的背景或目标不清楚，使用 ask_user 追问后再继续。
```

## Quiz Flow

The Mastery module no longer owns a separate quiz generator or grading dialog for the main path. Clicking `出题测验` injects an existing quiz-generation request into QAPanel using `quizGenerateStream()`.

The topic is generated from the active document and point:

```text
文档《{document_title}》中的知识点「{knowledge_point_title}」。
重点考察：知识点定义、依赖关系、文档中的应用场景。
```

QuizViewer remains responsible for displaying questions, collecting answers, AI judgment, and follow-up explanations. Mastery records that a quiz was started and can later use explicit learner actions to update status.

## Status Model

The frontend status labels are learner-facing:

- `未开始`
- `学习中`
- `待测验`
- `待复习`
- `已掌握`

The backend can keep existing numeric mastery and qualitative mastery fields, but the API should expose enough action results for the frontend to map to these labels.

State transitions:

- click knowledge point: `new` -> `learning`
- AgentLoop answer completes: stays `learning`
- `我理解了`: qualitative point becomes mastered; quantitative point becomes at least learning and can be marked review-ready
- `出题测验`: records quiz started and moves to `learning` or `待测验`
- `稍后复习`: schedules review and moves to `待复习`
- reset: clears self-assessment, quiz attempts, review state, and active-point metadata

## Backend API

Keep the existing document/tree APIs:

- `GET /mastery/documents`
- `GET /mastery/documents/{doc_id}`
- `POST /mastery/documents/{doc_id}/build`
- `POST /mastery/documents/{doc_id}/reset`

Add point-action APIs:

- `POST /mastery/documents/{doc_id}/points/{kp_id}/start`
- `POST /mastery/documents/{doc_id}/points/{kp_id}/self-assess`
- `POST /mastery/documents/{doc_id}/points/{kp_id}/quiz-started`
- `POST /mastery/documents/{doc_id}/points/{kp_id}/review-later`

`start` returns:

```json
{
  "doc_id": "doc-...",
  "knowledge_point_id": "...",
  "prompt": "...",
  "document": { "...": "updated detail payload" }
}
```

`self-assess`, `quiz-started`, and `review-later` return the updated document detail.

Existing `study`, `quiz`, `grade`, and `assess` routes may remain temporarily for compatibility, but the redesigned frontend should stop using them for the primary learning flow.

## Frontend API

Add functions:

- `startKnowledgePointLearning(docId, kpId)`
- `selfAssessKnowledgePoint(docId, kpId, passed, note?)`
- `recordKnowledgePointQuizStarted(docId, kpId)`
- `scheduleKnowledgePointReview(docId, kpId)`

Keep:

- `getMasteryDocuments()`
- `getMasteryDocument()`
- `resetMasteryDocument()`

The frontend can keep existing response normalization for `map.modules`.

## QAPanel Integration

QAPanel exposes an imperative learning action through a small store queue rather than prop drilling:

```ts
type QACommand =
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

`useQAStore` owns `enqueueCommand()` and `consumeCommand()`. `QAPanel` watches the pending command and runs the same internal paths as manual send or quiz generation.

This avoids duplicating stream handling in MasterySidebar and keeps AgentLoop behavior in one place.

## Sidebar Interaction

The Mastery sidebar layout changes to:

- document list
- compact progress strip
- knowledge tree
- active point action panel

Clicking a point:

- selects it
- calls `startKnowledgePointLearning`
- enqueues the returned prompt into QAPanel
- shows active action buttons

The primary click should not open a modal. Secondary status and reset dialogs may remain.

## Error Handling

- If RAG is not `processed`, the tree is hidden and the document shows processing.
- If knowledge tree build fails, show the build status dialog and retry button.
- If AgentLoop command injection fails because QAPanel is busy, show a toast and leave the point selected.
- If a point-action API fails, show a toast and do not mutate local state optimistically.
- If `/mastery` returns malformed data, frontend normalization must fail closed to empty lists rather than crash.

## Testing

Backend tests:

- `start` returns a prompt containing document title, module title, point title, description, and dependencies.
- `start` marks a point as learning without marking it mastered.
- `self-assess` updates qualitative mastery and returns updated map counts.
- `quiz-started` records a non-mastering learning event.
- `review-later` creates or updates a review state.

Frontend checks:

- `npm run lint`.
- QAPanel command queue typechecks and consumes commands once.
- MasterySidebar no longer imports or opens `KnowledgePointDialog`/`QuizDialog` for primary learning.
- Clicking a point enqueues a QA query command and updates active action panel.
- Clicking `出题测验` enqueues a quiz command with the generated topic.

## Migration Notes

Existing dialog components can be deleted if no longer referenced:

- `ui/src/components/mastery/KnowledgePointDialog.tsx`
- `ui/src/components/mastery/QuizDialog.tsx`
- `ui/src/components/mastery/ReviewDialog.tsx`

Keep `BuildStatusDialog` and `ResetProgressDialog`.

Existing backend routes can stay for now to reduce risk, but new frontend work should target the point-action APIs.
