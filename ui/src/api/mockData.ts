import type { DocStatus, DocStatusResponse, GraphData, ReferenceItem } from './types'

/**
 * Mock 文档数据。后端接入后Delete此文件即可。
 * 模拟一个 AI 教学场景下的文档库：教材、课件、习题集等。
 */
const now = Date.now()
const days = (n: number) => new Date(now - n * 86400000).toISOString()
const hours = (n: number) => new Date(now - n * 3600000).toISOString()
const minutes = (n: number) => new Date(now - n * 60000).toISOString()

export const mockDocuments: DocStatusResponse[] = [
  {
    id: 'doc-9f2a1c',
    file_path: 'Advanced Calculus Volume 1.pdf',
    content_summary: 'This textbook covers limits, continuity, derivatives, differentials, the mean value theorem, and core single-variable calculus topics.',
    content_length: 1284021,
    chunks_count: 342,
    status: 'processed',
    created_at: days(20),
    updated_at: days(18),
    metadata: { parse_start_time: 1700000000, parse_end_time: 1700000120, source: 'upload' }
  },
  {
    id: 'doc-3b7e8d',
    file_path: 'Linear Algebra Notes.md',
    content_summary: 'Explains determinants, matrices, vector space linear dependence, linear systems, eigenvalues, eigenvectors, and quadratic forms.',
    content_length: 384200,
    chunks_count: 96,
    status: 'processed',
    created_at: days(15),
    updated_at: days(14),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-5c1f0a',
    file_path: 'Python Programming Slides.pptx',
    content_summary: 'Introductory Python slides covering data types, control flow, functions, object-oriented programming, and exception handling.',
    content_length: 512033,
    chunks_count: 128,
    status: 'processed',
    created_at: days(12),
    updated_at: days(11),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-7a9d2e',
    file_path: 'Machine Learning Exercises.docx',
    content_summary: 'Exercises for supervised learning, unsupervised learning, model evaluation, and regularization, including reference answers and explanations.',
    content_length: 220100,
    chunks_count: 54,
    status: 'processed',
    created_at: days(9),
    updated_at: days(8),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-2d4b6f',
    file_path: 'Deep Learning Basics - Neural Networks.pdf',
    content_summary: 'Introduces feed-forward neural networks, backpropagation, activation functions, optimization methods, and training techniques.',
    content_length: 890440,
    chunks_count: 210,
    status: 'processing',
    created_at: hours(2),
    updated_at: minutes(5),
    metadata: { process_start_time: 1700000200, source: 'upload' }
  },
  {
    id: 'doc-8e1c33',
    file_path: 'Discrete Mathematics - Graph Theory.txt',
    content_summary: 'Basic graph concepts, connectivity, trees, Eulerian and Hamiltonian graphs, planar graphs, and graph coloring.',
    content_length: 156000,
    chunks_count: 0,
    status: 'analyzing',
    created_at: hours(1),
    updated_at: minutes(12),
    metadata: { analyzing_start_time: 1700000300, source: 'upload' }
  },
  {
    id: 'doc-6f0a9b',
    file_path: 'Probability and Statistics Notes.md',
    content_summary: 'Random events and probability, random variables and distributions, moments, the law of large numbers, the central limit theorem, and parameter estimation.',
    content_length: 421300,
    chunks_count: 0,
    status: 'parsing',
    created_at: minutes(30),
    updated_at: minutes(2),
    metadata: { parse_start_time: 1700000400, source: 'upload' }
  },
  {
    id: 'doc-1b5e7c',
    file_path: 'Compiler Principles Lab Guide.pdf',
    content_summary: 'Lab guide for lexical analysis, parsing, semantic analysis, and intermediate code generation.',
    content_length: 98000,
    chunks_count: 0,
    status: 'pending',
    created_at: minutes(10),
    updated_at: minutes(10),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-4a8f1d',
    file_path: 'Data Structures and Algorithms - Exercise Explanations.docx',
    content_summary: 'Detailed exercises on lists, stacks, queues, trees, binary trees, graphs, sorting, and search algorithms.',
    content_length: 305200,
    chunks_count: 78,
    status: 'failed',
    created_at: days(3),
    updated_at: hours(20),
    error_msg: 'LLM call timed out during entity extraction (timeout=300s) and was stopped automatically.',
    metadata: { source: 'upload', retry_count: 2 }
  },
  {
    id: 'doc-0c3b9e',
    file_path: 'Operating System Concepts - 8th Edition.pdf',
    content_summary: 'Processes and threads, CPU scheduling, synchronization and deadlocks, memory management, and file system interfaces and implementation.',
    content_length: 1542000,
    chunks_count: 0,
    status: 'preprocessed',
    created_at: hours(3),
    updated_at: hours(2),
    metadata: { source: 'upload' }
  }
]

/** 按 status 统计计数（用于Status过滤Labels） */
export function countByStatus(docs: DocStatusResponse[]): Record<string, number> {
  const counts: Record<string, number> = { all: docs.length }
  const all: DocStatus[] = [
    'processed', 'preprocessed', 'parsing', 'analyzing', 'processing', 'pending', 'failed'
  ]
  for (const s of all) counts[s] = 0
  for (const d of docs) counts[d.status] = (counts[d.status] ?? 0) + 1
  return counts
}

/** mock 自增 id 生成（用于新Upload Documents） */
let mockIdCounter = 100
export function nextMockId(): string {
  mockIdCounter += 1
  return `doc-mock-${mockIdCounter.toString(16)}`
}

// ============================================================
//  Mock Knowledge Graph（VITE_USE_MOCK=true 时供 GraphViewer 渲染）
// ============================================================

/** mock 实体Labels列表（模拟 LightRAG /graph/label/*） */
export const mockGraphLabels: string[] = [
  'Calculus',
  'Linear Algebra',
  'Probability',
  'Machine Learning',
  'Deep Learning',
  'Neural Networks',
  'Python',
  'Data Structures',
  'Graph Theory',
  'Operating Systems'
]

/**
 * mock 图谱：以"Machine Learning"为中心的小型Knowledge Graph。
 * Nodes id 即实体名；Edges source/target 用实体名连接，与 webui NetworkX 模式一致。
 */
export const mockGraphData: GraphData = {
  nodes: [
    { id: 'Machine Learning', labels: ['Concept'], properties: { description: 'A field that studies how computers learn patterns from data', source_id: 'mock' } },
    { id: 'Supervised Learning', labels: ['Method'], properties: { description: 'Training models with labeled data', source_id: 'mock' } },
    { id: 'Unsupervised Learning', labels: ['Method'], properties: { description: 'Discovering patterns from unlabeled data', source_id: 'mock' } },
    { id: 'Reinforcement Learning', labels: ['Method'], properties: { description: 'Learning policies through rewards from environment interaction', source_id: 'mock' } },
    { id: 'Neural Networks', labels: ['Model'], properties: { description: 'A hierarchical model inspired by biological neurons', source_id: 'mock' } },
    { id: 'Deep Learning', labels: ['Concept'], properties: { description: 'A machine learning branch based on multi-layer neural networks', source_id: 'mock' } },
    { id: 'Gradient Descent', labels: ['Algorithm'], properties: { description: 'Iteratively updates parameters against the loss-function gradient', source_id: 'mock' } },
    { id: 'Backpropagation', labels: ['Algorithm'], properties: { description: 'Computes loss gradients with respect to parameters via the chain rule', source_id: 'mock' } },
    { id: 'Overfitting', labels: ['Phenomenon'], properties: { description: 'A model performs well on the training set but generalizes poorly', source_id: 'mock' } },
    { id: 'Regularization', labels: ['Technique'], properties: { description: 'Controls model complexity to reduce overfitting', source_id: 'mock' } },
    { id: 'Python', labels: ['Tool'], properties: { description: 'A mainstream programming language for machine learning', source_id: 'mock' } },
    { id: 'Classification', labels: ['Task'], properties: { description: 'Predicts discrete labels', source_id: 'mock' } },
    { id: 'Regression', labels: ['Task'], properties: { description: 'Predicts continuous values', source_id: 'mock' } }
  ],
  edges: [
    { id: 'ml-sup', source: 'Machine Learning', target: 'Supervised Learning', type: 'Includes', properties: {} },
    { id: 'ml-unsup', source: 'Machine Learning', target: 'Unsupervised Learning', type: 'Includes', properties: {} },
    { id: 'ml-rl', source: 'Machine Learning', target: 'Reinforcement Learning', type: 'Includes', properties: {} },
    { id: 'ml-dl', source: 'Machine Learning', target: 'Deep Learning', type: 'Branch', properties: {} },
    { id: 'dl-nn', source: 'Deep Learning', target: 'Neural Networks', type: 'Uses', properties: {} },
    { id: 'nn-bp', source: 'Neural Networks', target: 'Backpropagation', type: 'Depends On', properties: {} },
    { id: 'nn-gd', source: 'Neural Networks', target: 'Gradient Descent', type: 'Depends On', properties: {} },
    { id: 'bp-gd', source: 'Backpropagation', target: 'Gradient Descent', type: 'Works With', properties: {} },
    { id: 'sup-cls', source: 'Supervised Learning', target: 'Classification', type: 'Task', properties: {} },
    { id: 'sup-reg', source: 'Supervised Learning', target: 'Regression', type: 'Task', properties: {} },
    { id: 'sup-overfit', source: 'Supervised Learning', target: 'Overfitting', type: 'Risk', properties: {} },
    { id: 'overfit-reg', source: 'Overfitting', target: 'Regularization', type: 'Mitigates', properties: {} },
    { id: 'ml-py', source: 'Machine Learning', target: 'Python', type: 'Tool', properties: {} }
  ]
}

// ============================================================
//  Mock Knowledge Q&A（VITE_USE_MOCK=true 时供 queryStreamMock Uses）
// ============================================================

/**
 * mock 流式问答Answer：返回分段 chunks（模拟流式逐段输出）+ 引用来源。
 * 真实环境下由 LightRAG POST /query/stream 返回 NDJSON。
 */
export const mockSearchResults: { title: string; url: string; snippet: string }[] = [
  { title: 'Latest Deep Learning Advances - AI Research', url: 'https://arxiv.org/abs/2024.xxxxx', snippet: 'This article reviews recent technical breakthroughs and application trends in deep learning...' },
  { title: 'Machine Learning Introduction - Coursera', url: 'https://www.coursera.org/learn/machine-learning', snippet: 'Andrew Ng classic machine learning course covering fundamentals through practical applications...' },
  { title: 'Transformer Architecture Explained - Wikipedia', url: 'https://en.wikipedia.org/wiki/Transformer_(model)', snippet: 'Transformer is a deep learning model architecture based on self-attention...' },
]

export function mockQueryAnswer(query: string, mode: string): {
  chunks: string[]
  references: ReferenceItem[]
} {
  const references: ReferenceItem[] = [
    { reference_id: '1', file_path: 'Advanced Calculus Volume 1.pdf' },
    { reference_id: '2', file_path: 'Machine Learning Exercises.docx' }
  ]
  const answer =
`Based on the knowledge base (**${mode}** retrieval mode), here is an answer for "${query}":

This is a *mock answer* without a live LightRAG/LLM connection. In a real environment, the LLM generates this from RAG retrieval results over uploaded documents.

Key points:

1. First key point
2. Second key point
3. Third key point

Example code:

\`\`\`python
def example():
    return "mock"
\`\`\`

| Mode | Description |
| --- | --- |
| local | Local entity retrieval |
| global | Global community summary |

> 提示：设置 \`VITE_USE_MOCK=false\` 并启动后端与 LightRAG 后，将获得真实RetrievalAnswer。`
  // 按换行/句号/冒号粗粒度切分，模拟流式 chunk
  const chunks = answer
    .split(/(?<=\n)|(?<=。)|(?<=：)/)
    .filter((s) => s.length > 0)
  return { chunks, references }
}
