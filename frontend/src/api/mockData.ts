import type { DocStatus, DocStatusResponse, GraphData, ReferenceItem } from './types'

/**
 * Mock 文档数据。后端接入后删除此文件即可。
 * 模拟一个 AI 教学场景下的文档库：教材、课件、习题集等。
 */
const now = Date.now()
const days = (n: number) => new Date(now - n * 86400000).toISOString()
const hours = (n: number) => new Date(now - n * 3600000).toISOString()
const minutes = (n: number) => new Date(now - n * 60000).toISOString()

export const mockDocuments: DocStatusResponse[] = [
  {
    id: 'doc-9f2a1c',
    file_path: '高等数学-第七版-上册.pdf',
    content_summary: '本教材系统介绍极限、连续、导数与微分、微分中值定理及其应用等核心内容，覆盖一元微积分基础。',
    content_length: 1284021,
    chunks_count: 342,
    status: 'processed',
    created_at: days(20),
    updated_at: days(18),
    metadata: { parse_start_time: 1700000000, parse_end_time: 1700000120, source: 'upload' }
  },
  {
    id: 'doc-3b7e8d',
    file_path: '线性代数讲义.md',
    content_summary: '讲解行列式、矩阵、向量组的线性相关性、线性方程组、特征值与特征向量及二次型。',
    content_length: 384200,
    chunks_count: 96,
    status: 'processed',
    created_at: days(15),
    updated_at: days(14),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-5c1f0a',
    file_path: 'Python程序设计课件.pptx',
    content_summary: '面向初学者的 Python 入门课件，涵盖数据类型、控制流、函数、面向对象与异常处理。',
    content_length: 512033,
    chunks_count: 128,
    status: 'processed',
    created_at: days(12),
    updated_at: days(11),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-7a9d2e',
    file_path: '机器学习习题集.docx',
    content_summary: '监督学习、无监督学习、模型评估与正则化等章节配套习题，含参考答案与解析。',
    content_length: 220100,
    chunks_count: 54,
    status: 'processed',
    created_at: days(9),
    updated_at: days(8),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-2d4b6f',
    file_path: '深度学习基础-神经网络.pdf',
    content_summary: '介绍前馈神经网络、反向传播算法、激活函数、优化方法与训练技巧。',
    content_length: 890440,
    chunks_count: 210,
    status: 'processing',
    created_at: hours(2),
    updated_at: minutes(5),
    metadata: { process_start_time: 1700000200, source: 'upload' }
  },
  {
    id: 'doc-8e1c33',
    file_path: '离散数学-图论章节.txt',
    content_summary: '图的基本概念、连通性、树、欧拉图与哈密顿图、平面图及图着色。',
    content_length: 156000,
    chunks_count: 0,
    status: 'analyzing',
    created_at: hours(1),
    updated_at: minutes(12),
    metadata: { analyzing_start_time: 1700000300, source: 'upload' }
  },
  {
    id: 'doc-6f0a9b',
    file_path: '概率论与数理统计-讲义.md',
    content_summary: '随机事件与概率、随机变量及其分布、数字特征、大数定律与中心极限定理、参数估计。',
    content_length: 421300,
    chunks_count: 0,
    status: 'parsing',
    created_at: minutes(30),
    updated_at: minutes(2),
    metadata: { parse_start_time: 1700000400, source: 'upload' }
  },
  {
    id: 'doc-1b5e7c',
    file_path: '编译原理实验指导书.pdf',
    content_summary: '词法分析器、语法分析器、语义分析与中间代码生成实验说明。',
    content_length: 98000,
    chunks_count: 0,
    status: 'pending',
    created_at: minutes(10),
    updated_at: minutes(10),
    metadata: { source: 'upload' }
  },
  {
    id: 'doc-4a8f1d',
    file_path: '数据结构与算法-习题解析.docx',
    content_summary: '线性表、栈与队列、树与二叉树、图、排序与查找算法的习题精讲。',
    content_length: 305200,
    chunks_count: 78,
    status: 'failed',
    created_at: days(3),
    updated_at: hours(20),
    error_msg: '实体抽取阶段 LLM 调用超时（timeout=300s），已自动终止。',
    metadata: { source: 'upload', retry_count: 2 }
  },
  {
    id: 'doc-0c3b9e',
    file_path: '操作系统概念-第八版.pdf',
    content_summary: '进程与线程、CPU 调度、同步与死锁、内存管理、文件系统接口与实现。',
    content_length: 1542000,
    chunks_count: 0,
    status: 'preprocessed',
    created_at: hours(3),
    updated_at: hours(2),
    metadata: { source: 'upload' }
  }
]

/** 按 status 统计计数（用于状态过滤标签） */
export function countByStatus(docs: DocStatusResponse[]): Record<string, number> {
  const counts: Record<string, number> = { all: docs.length }
  const all: DocStatus[] = [
    'processed', 'preprocessed', 'parsing', 'analyzing', 'processing', 'pending', 'failed'
  ]
  for (const s of all) counts[s] = 0
  for (const d of docs) counts[d.status] = (counts[d.status] ?? 0) + 1
  return counts
}

/** mock 自增 id 生成（用于新上传文档） */
let mockIdCounter = 100
export function nextMockId(): string {
  mockIdCounter += 1
  return `doc-mock-${mockIdCounter.toString(16)}`
}

// ============================================================
//  Mock 知识图谱（VITE_USE_MOCK=true 时供 GraphViewer 渲染）
// ============================================================

/** mock 实体标签列表（模拟 LightRAG /graph/label/*） */
export const mockGraphLabels: string[] = [
  '微积分',
  '线性代数',
  '概率论',
  '机器学习',
  '深度学习',
  '神经网络',
  'Python',
  '数据结构',
  '图论',
  '操作系统'
]

/**
 * mock 图谱：以"机器学习"为中心的小型知识图谱。
 * 节点 id 即实体名；边 source/target 用实体名连接，与 webui NetworkX 模式一致。
 */
export const mockGraphData: GraphData = {
  nodes: [
    { id: '机器学习', labels: ['概念'], properties: { description: '研究如何让计算机从数据中学习规律的学科', source_id: 'mock' } },
    { id: '监督学习', labels: ['方法'], properties: { description: '使用带标签数据训练模型', source_id: 'mock' } },
    { id: '无监督学习', labels: ['方法'], properties: { description: '从无标签数据中发现模式', source_id: 'mock' } },
    { id: '强化学习', labels: ['方法'], properties: { description: '通过与环境交互获得奖励来学习策略', source_id: 'mock' } },
    { id: '神经网络', labels: ['模型'], properties: { description: '受生物神经元启发的层级化模型', source_id: 'mock' } },
    { id: '深度学习', labels: ['概念'], properties: { description: '基于多层神经网络的机器学习分支', source_id: 'mock' } },
    { id: '梯度下降', labels: ['算法'], properties: { description: '沿损失函数梯度反方向迭代更新参数', source_id: 'mock' } },
    { id: '反向传播', labels: ['算法'], properties: { description: '通过链式法则计算损失对参数的梯度', source_id: 'mock' } },
    { id: '过拟合', labels: ['现象'], properties: { description: '模型在训练集表现好但泛化能力差', source_id: 'mock' } },
    { id: '正则化', labels: ['技术'], properties: { description: '抑制模型复杂度以缓解过拟合', source_id: 'mock' } },
    { id: 'Python', labels: ['工具'], properties: { description: '主流的机器学习编程语言', source_id: 'mock' } },
    { id: '分类', labels: ['任务'], properties: { description: '预测离散标签', source_id: 'mock' } },
    { id: '回归', labels: ['任务'], properties: { description: '预测连续值', source_id: 'mock' } }
  ],
  edges: [
    { id: 'ml-sup', source: '机器学习', target: '监督学习', type: '包含', properties: {} },
    { id: 'ml-unsup', source: '机器学习', target: '无监督学习', type: '包含', properties: {} },
    { id: 'ml-rl', source: '机器学习', target: '强化学习', type: '包含', properties: {} },
    { id: 'ml-dl', source: '机器学习', target: '深度学习', type: '分支', properties: {} },
    { id: 'dl-nn', source: '深度学习', target: '神经网络', type: '使用', properties: {} },
    { id: 'nn-bp', source: '神经网络', target: '反向传播', type: '依赖', properties: {} },
    { id: 'nn-gd', source: '神经网络', target: '梯度下降', type: '依赖', properties: {} },
    { id: 'bp-gd', source: '反向传播', target: '梯度下降', type: '配合', properties: {} },
    { id: 'sup-cls', source: '监督学习', target: '分类', type: '任务', properties: {} },
    { id: 'sup-reg', source: '监督学习', target: '回归', type: '任务', properties: {} },
    { id: 'sup-overfit', source: '监督学习', target: '过拟合', type: '风险', properties: {} },
    { id: 'overfit-reg', source: '过拟合', target: '正则化', type: '缓解', properties: {} },
    { id: 'ml-py', source: '机器学习', target: 'Python', type: '工具', properties: {} }
  ]
}

// ============================================================
//  Mock 知识问答（VITE_USE_MOCK=true 时供 queryStreamMock 使用）
// ============================================================

/**
 * mock 流式问答回答：返回分段 chunks（模拟流式逐段输出）+ 引用来源。
 * 真实环境下由 LightRAG POST /query/stream 返回 NDJSON。
 */
export function mockQueryAnswer(query: string, mode: string): {
  chunks: string[]
  references: ReferenceItem[]
} {
  const references: ReferenceItem[] = [
    { reference_id: '1', file_path: '高等数学-第七版-上册.pdf' },
    { reference_id: '2', file_path: '机器学习习题集.docx' }
  ]
  const answer =
`根据知识库（**${mode}** 模式检索），针对「${query}」作答如下：

这是一段 *mock 模拟回答*（未连接真实 LightRAG/LLM）。在真实环境下，此处会基于已上传文档的 RAG 检索结果由 LLM 生成。

要点：

1. 第一项要点说明
2. 第二项要点说明
3. 第三项要点说明

示例代码：

\`\`\`python
def example():
    return "mock"
\`\`\`

| 模式 | 说明 |
| --- | --- |
| local | 局部实体检索 |
| global | 全局社区摘要 |

> 提示：设置 \`VITE_USE_MOCK=false\` 并启动后端与 LightRAG 后，将获得真实检索回答。`
  // 按换行/句号/冒号粗粒度切分，模拟流式 chunk
  const chunks = answer
    .split(/(?<=\n)|(?<=。)|(?<=：)/)
    .filter((s) => s.length > 0)
  return { chunks, references }
}
