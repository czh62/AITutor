# UI Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean `/ui` Vite frontend that preserves current backend contracts while using DeepTutor-style chat interactions and LightRAG-style graph viewing.

**Architecture:** Create `/ui` as a sibling to `frontend/`, not a replacement. Copy stable graph/document infrastructure from the current project, add missing shared libs, split chat into focused components, and add pure helper tests for high-risk behavior.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind v4, Zustand, Radix primitives, Sigma/Graphology, Vitest.

---

### Task 1: Scaffold `/ui`

**Files:**
- Create: `ui/package.json`
- Create: `ui/vite.config.ts`
- Create: `ui/tsconfig.json`
- Create: `ui/tsconfig.app.json`
- Create: `ui/tsconfig.node.json`
- Create: `ui/index.html`
- Create: `ui/src/main.tsx`
- Create: `ui/src/App.tsx`
- Create: `ui/src/index.css`

- [ ] Create a Vite app shell with `@` alias, backend proxy routes, Tailwind plugin, and graphology CJS alias.
- [ ] Add `test`, `build`, `dev`, `preview`, and `lint` scripts.

### Task 2: Add Tests First

**Files:**
- Create: `ui/src/features/documentStatusFilters.test.ts`
- Create: `ui/src/lib/streamEvents.test.ts`
- Create: `ui/src/lib/thinkSegments.test.ts`

- [ ] Write tests that initially fail because the `/ui` implementation does not exist.
- [ ] Run `cd ui && npm run test -- --run` and confirm failure.

### Task 3: Shared Foundation

**Files:**
- Create: `ui/src/lib/utils.ts`
- Create: `ui/src/lib/constants.ts`
- Create: `ui/src/lib/streamEvents.ts`
- Create: `ui/src/lib/thinkSegments.ts`
- Create: `ui/src/features/documentStatusFilters.ts`
- Create/Copy: `ui/src/api/*`

- [ ] Implement `cn`, `errorMessage`, Zustand selector helper, graph constants, document file-type constants, and stream/thinking helpers.
- [ ] Preserve LightRAG document, graph, query, and quiz API contracts.
- [ ] Run unit tests and confirm they pass.

### Task 4: Graph And Document Infrastructure

**Files:**
- Create/Copy: `ui/src/components/ui/*`
- Create/Copy: `ui/src/components/documents/*`
- Create/Copy: `ui/src/components/graph/*`
- Create/Copy: `ui/src/hooks/*`
- Create/Copy: `ui/src/stores/graph.ts`
- Create/Copy: `ui/src/stores/settings.ts`
- Create/Copy: `ui/src/utils/graphColor.ts`
- Create/Copy: `ui/src/features/DocumentManager.tsx`
- Create/Copy: `ui/src/features/GraphViewer.tsx`

- [ ] Preserve document side-panel behavior and LightRAG status-bucket mapping.
- [ ] Preserve read-only graph behavior, persistent mount semantics, and Sigma performance safeguards.

### Task 5: DeepTutor-Style Chat

**Files:**
- Create: `ui/src/components/chat/ChatComposer.tsx`
- Create: `ui/src/components/chat/ChatMessage.tsx`
- Create: `ui/src/components/chat/AssistantResponse.tsx`
- Create: `ui/src/components/chat/ModelThinkingCard.tsx`
- Create: `ui/src/components/chat/AskUserCard.tsx`
- Create: `ui/src/components/chat/TracePanels.tsx`
- Create: `ui/src/components/chat/QuizConfigDialog.tsx`
- Create: `ui/src/components/chat/QuizCard.tsx`
- Create: `ui/src/stores/qa.ts`
- Create: `ui/src/features/QAPanel.tsx`

- [ ] Split chat into focused components.
- [ ] Keep stream callbacks compatible with `/query/stream`, `/query/resume`, and `/quiz/generate/stream`.
- [ ] Render assistant markdown, model-thinking blocks, ask-user pauses, references, process trace, and quiz cards.

### Task 6: App Layout And Verification

**Files:**
- Create: `ui/src/components/ActivityBar.tsx`
- Create: `ui/src/features/SiteHeader.tsx`
- Modify: `ui/src/App.tsx`

- [ ] Implement top navigation, Q&A workspace with collapsible document panel, and always-mounted graph panel.
- [ ] Run `cd ui && npm run test -- --run`.
- [ ] Run `cd ui && npm run build`.
- [ ] Start the dev server and smoke-test the page in browser automation.
