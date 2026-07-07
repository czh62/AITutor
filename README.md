# EduMind AI

EduMind AI is a full-stack **Agentic RAG learning workspace** that turns uploaded study documents into an interactive learning experience.

It combines document-grounded Q&A, knowledge graph exploration, mastery tracking, quiz generation, AI judging, and review scheduling in one workspace.

> This project is an AI learning system prototype built with React, FastAPI, HKU LightRAG, external LLM APIs, and embedding models.

---

## Overview

EduMind AI is designed for document-based learning.

Instead of only chatting with an LLM, learners can upload study materials, ask questions grounded in the document, explore generated knowledge points, practice with quizzes, receive AI feedback, and review weak points later.

The main learning flow is:

```text
Upload Documents
→ Build RAG Knowledge Base
→ Generate Knowledge Points
→ Ask Document-Grounded Questions
→ Continue Guided Learning
→ Generate Quizzes
→ Judge Answers
→ Track Mastery Progress
→ Review Later
```

---

## Key Features

### 1. Document-Grounded Q&A

EduMind AI supports document-based question answering through a RAG pipeline.

Uploaded documents are processed by LightRAG and can be used as grounded knowledge for user questions. The system retrieves relevant context before generating answers, reducing hallucination compared with a plain chatbot.

### 2. Agentic RAG Workflow

The core Q&A flow uses an AgentLoop-style backend workflow.

The agent can decide whether to:

- Retrieve knowledge from uploaded documents
- Use web search when enabled
- Ask the user for clarification
- Stream intermediate reasoning and final answers to the frontend

### 3. Knowledge Graph Exploration

The Knowledge Graph view visualizes relationships extracted from documents.

It helps learners explore concepts and their connections, instead of reading documents only in a linear way.

### 4. Mastery Learning Path

EduMind AI can organize uploaded content into structured learning paths.

The Mastery module tracks:

- Knowledge modules
- Knowledge points
- Learning status
- Mastery percentage
- “I Understand” actions
- “Review Later” items
- Review queue filtering

This makes the system closer to an adaptive learning assistant rather than a simple RAG chatbot.

### 5. Quiz Generation

The system can generate structured quizzes based on uploaded documents or selected knowledge points.

Quiz generation is handled as a dedicated LLM workflow, with structured output for frontend rendering.

Supported quiz interactions include:

- Multiple questions
- Progress tracking
- Answer submission
- AI feedback
- Follow-up explanation

### 6. AI Quiz Judging

EduMind AI includes a quiz judging workflow.

The judge service evaluates learner answers, explains mistakes, and provides follow-up learning support.

### 7. Review Later Workflow

Learners can mark knowledge points for later review.

The system tracks review items and provides a visible review filter in the Knowledge Points panel.

### 8. English Demo Mode

The current UI is localized for English demo usage.

The system name is displayed as **EduMind AI**, and the main UI, dialogs, buttons, status messages, and learning actions are adapted for English presentation.

---

## Technical Architecture

EduMind AI uses a layered architecture.

```text
User
 ↓
React / Vite Frontend
 ↓
FastAPI Backend
 ↓
AgentLoop / MasteryService / QuizService / JudgeService
 ↓
HKU LightRAG Knowledge Engine
 ↓
LLM + Embedding APIs
```

---

## Frontend

The frontend is built as an interactive learning workspace rather than a simple chat interface.

Main technologies:

- React
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- Sigma / Graphology for graph visualization
- Streaming UI for Agent responses

Frontend modules include:

```text
ui/src/features
ui/src/components
ui/src/components/chat
ui/src/components/documents
ui/src/components/graph
ui/src/components/mastery
ui/src/api
ui/src/stores
```

Main frontend capabilities:

- Document upload and status tracking
- Knowledge Q&A panel
- Knowledge Graph viewer
- Knowledge Points sidebar
- Quiz viewer
- Review Later filter
- Streaming response rendering
- Toast notifications and dialog states
- English demo UI copy

---

## Backend

The backend is built with FastAPI and works as the orchestration layer of the system.

Main technologies:

- FastAPI
- Pydantic
- SQLAlchemy
- httpx
- OpenAI-compatible LLM API client
- HKU LightRAG integration
- Async streaming response
- Docker-based local deployment

Main backend modules:

```text
src/main.py
src/api
src/services
src/agentloop
src/mastery
src/schemas
src/core
src/db
```

Important backend components:

### AgentLoop

The main Q&A agent workflow.

It supports tool calling, RAG retrieval, optional web search, ask-user clarification, streaming output, and paused context recovery.

### LightRAG Client

The backend wraps HKU LightRAG as an external RAG service.

LightRAG handles:

- Document parsing
- Chunking
- Entity-relation extraction
- Embedding
- Knowledge graph construction
- Vector / graph retrieval

### Mastery Service

Responsible for knowledge point learning paths and progress tracking.

It manages:

- Learning modules
- Knowledge points
- Mastery status
- Review Later
- Review queue
- Guided learning prompts

### Quiz Service

Responsible for quiz generation based on document or knowledge point context.

### Quiz Judge Service

Responsible for answer evaluation, feedback generation, and follow-up explanation.

---

## LightRAG Integration

HKU LightRAG is used as the external knowledge engine.

It is not the agent itself. Instead, it provides the RAG and graph-based retrieval layer.

The FastAPI backend communicates with LightRAG through a client wrapper and exposes document, graph, and query-related capabilities to the frontend.

---

## Project Structure

```text
.
├── src/                    # FastAPI backend
│   ├── api/                # API routes
│   ├── agentloop/          # Core AgentLoop logic
│   ├── services/           # Query, LightRAG, Quiz, Judge services
│   ├── mastery/            # Mastery learning logic
│   ├── schemas/            # Pydantic schemas
│   ├── db/                 # Database models / sessions
│   └── core/               # Shared config and prompting utilities
│
├── ui/                     # React frontend
│   ├── src/
│   │   ├── features/       # Main page-level features
│   │   ├── components/     # UI components
│   │   ├── api/            # Frontend API client
│   │   ├── stores/         # Zustand state stores
│   │   └── hooks/          # Frontend hooks
│   └── package.json
│
├── docker-compose.yml      # Local multi-service startup
├── Dockerfile.backend      # Backend Dockerfile
├── requirements.txt        # Python dependencies
├── .env.template           # Environment variable template
└── docs/                   # Documentation assets
```

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/czh62/AITutor.git
cd AITutor
git checkout ui
```

### 2. Configure environment variables

Create a `.env` file in the project root.

You can start from:

```bash
cp .env.template .env
```

Important configuration includes:

```env
LLM_BINDING=openai
LLM_BINDING_HOST=https://your-llm-api-host
LLM_BINDING_API_KEY=your-llm-api-key
LLM_MODEL=your-llm-model

EMBEDDING_BINDING=openai
EMBEDDING_BINDING_HOST=https://your-embedding-api-host
EMBEDDING_BINDING_API_KEY=your-embedding-api-key
EMBEDDING_MODEL=your-embedding-model
EMBEDDING_DIM=1024
```

Do not commit `.env`.

### 3. Start with Docker Compose

```bash
docker compose up -d --build
```

This starts:

- LightRAG service
- FastAPI backend
- React frontend

### 4. Open the frontend

```text
http://localhost:5174
```

### 5. Backend health check

```text
http://localhost:8000/health
```

---

## Demo Flow

A recommended demo flow:

```text
1. Start all services with Docker Compose
2. Open EduMind AI frontend
3. Upload a study document
4. Wait until document processing is completed
5. Ask a document-grounded question
6. Open Knowledge Points
7. Continue discussion on a selected knowledge point
8. Answer the understanding-check question
9. Generate a quiz
10. Submit an answer and view AI feedback
11. Mark a knowledge point as Review Later
12. Open the Review filter
13. Explore the Knowledge Graph
```

---

## Engineering Highlights

### Agentic RAG Learning Workspace

EduMind AI combines RAG, tool-calling, learning state, quiz workflows, and graph visualization into one learning system.

### Document-to-Knowledge Pipeline

Uploaded documents are transformed into retrievable knowledge, graph structures, and mastery learning paths.

### Tool-Augmented Q&A Agent

The Q&A Agent can call retrieval, web search, and ask-user clarification tools.

### Structured Learning State

The system tracks learning progress at the knowledge point level.

### Practice-Feedback Loop

Quiz generation and judging create a closed loop of practice, feedback, and follow-up explanation.

### Docker-Based Local Deployment

The project supports local multi-service startup through Docker Compose.

---

## Notes

This project is a prototype and is still under active development.

Recommended future improvements:

- Improve persistent mastery data management
- Add stronger end-to-end tests
- Improve graph layout and filtering
- Add user authentication
- Improve production deployment settings
- Add more robust prompt/version management
- Expand quiz types and learning analytics
- Improve multilingual support

---

## Summary

EduMind AI turns uploaded documents into an interactive AI learning workspace.

It combines:

- React-based learning UI
- FastAPI backend orchestration
- HKU LightRAG retrieval
- Tool-calling AgentLoop
- Knowledge graph visualization
- Mastery tracking
- Quiz generation
- AI judging
- Review scheduling

The goal is to provide a more structured and interactive learning experience than a traditional RAG chatbot.
