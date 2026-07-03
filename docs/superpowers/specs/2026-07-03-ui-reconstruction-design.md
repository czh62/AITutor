# UI Reconstruction Design

**Goal:** Build a clean, independent `/ui` frontend for AI Tutor using the current Vite/React/Tailwind stack, while preserving the existing backend contracts.

**Approved Approach:** Create a new Vite app under `/ui`. Use the current frontend only for layout/API contracts, DeepTutor for chat interaction patterns, and LightRAG WebUI for graph behavior.

**Architecture:** `/ui/src` keeps the same broad structure as the current frontend: `api`, `components`, `features`, `hooks`, `stores`, `utils`, and `lib`. The main app has two persistent panels: knowledge Q&A and knowledge graph. The graph panel stays mounted and is hidden with `visibility:hidden` to preserve WebGL/Sigma state.

**Chat:** The Q&A surface keeps `/query/stream`, `/query/resume`, and `/quiz/generate/stream`. It is split into focused chat components: composer, message rendering, assistant markdown, model-thinking card, ask-user card, trace panel, quiz config, and quiz cards. Stream reconstruction is handled in testable helpers so narration/tool-call text does not leak into final answers.

**Documents:** The document manager remains in the left collapsible panel on the Q&A screen. It keeps LightRAG document API semantics, status-bucket filtering, upload, scan, delete, clear, and pipeline status dialogs.

**Graph:** The graph viewer follows the existing LightRAG-derived implementation: sigma.js + graphology + zustand, read-only entity/relationship inspection, label search, layout controls, legend, and performance guards. The Vite config aliases graphology to its CJS bundle to avoid the known Vite import-analysis white-screen bug.

**Testing:** Add Vitest unit tests for status filters, stream reconstruction, and model-thinking parsing. Verify with `npm run test`, `npm run build`, and a local dev-server/browser smoke test.
