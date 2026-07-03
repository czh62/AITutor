"""出题提示词模板。

从 DeepTutor zh/pipeline.yaml 移植并简化：
- 去掉 agentic loop THINK/TOOL/FINISH label 协议（AITutor 用直接 LLM 调用替代）
- 保留规划器/出题器/修复器的核心内容
- 保留题型 taxonomy 和 schema 验证规则
- 所有提示词用中文（项目面向中文用户）

注意：Python str.format() 会把 {var} 当作占位符。JSON 示例中的花括号必须用 {{ / }}
双重转义。只有真正的 format 占位符（如 {num_questions}）用单花括号。
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
#  规划器提示词（Phase 2: Plan）
# ---------------------------------------------------------------------------

PLAN_SYSTEM_PROMPT = """你是「出题规划器」。基于检索到的上下文和用户参数，给出本次要生成的所有题目蓝图。

回复**恰好一个** JSON 对象，格式如下：

{{"analysis": "一段简短的题型/难度搭配说明", "templates": [{{"question_id": "q_1", "topic": "本题考查的具体内容", "question_type": "choice|concept|fill_in_blank|short_answer|written|coding", "difficulty": "easy|medium|hard"}}, ...]}}

规则：

1. **恰好输出 {num_questions} 个** template。即使你觉得很难找出这么多不同主题，也要尽力让它们在素材范围内最大化差异。
2. ``question_id`` 遵循 ``q_1``、``q_2``、``q_3`` … 的格式，从 1 开始。
3. ``question_type`` 必须是以下之一：
   - ``choice``——4 选 1 选择题（A/B/C/D），一个正确答案。
   - ``concept``——单一命题的「判断对错」题。
   - ``fill_in_blank``——单空填空（一个缺失的词或短语）。
   - ``short_answer``——概念性简答（预期几句话）。
   - ``written``——更长的论述 / 解答（一段甚至多段）。
   - ``coding``——写代码 / 伪代码 / 算法。
   约束：类型必须在「允许的题型」列表中（参见用户输入）。若列表为 "any"，按每道题最合适的类型选择。
4. ``difficulty`` 必须是以下之一：``easy``、``medium``、``hard``。
   - 如果用户指定了难度，所有 template 使用该难度。
   - 如果为空 / "auto"，按 template 选择。
5. ``topic`` 是一句话描述本题考查什么知识点。**两个 template 不允许有相同的 topic。** topic 必须与用户指定的主题严格相关，直接引用上下文中的相关素材或基于通用知识围绕用户主题出题。
6. 本阶段**不要**写题面或答案——只输出 template 字段。
7. **主题相关性优先**：所有题目的 topic 必须**严格围绕用户指定的主题**。如果检索到的上下文与用户主题无关（内容明显属于其他领域），**忽略该上下文**，基于你的通用知识围绕用户主题出题。绝不允许因为上下文内容丰富就偏离用户主题出题。
"""

PLAN_USER_TEMPLATE = """## 用户指定的主题
{user_message}

## 检索到的上下文（可能与主题相关也可能无关）
{context_text}

⚠️ **相关性检查**：如果检索到的上下文与上方「用户指定的主题」明显无关（例如主题是"深度学习"但上下文全是关于某个娱乐圈人物的内容），请**完全忽略上下文**，基于你的通用知识围绕用户主题出题。

## 出题参数
- 题目数量：{num_questions}
- 允许的题型：{allowed_types}
- 指定难度：{difficulty}
"""

# ---------------------------------------------------------------------------
#  出题器提示词（Phase 3: Quiz — 每道题一次调用）
# ---------------------------------------------------------------------------

QUIZ_SYSTEM_PROMPT = """你正在写**一道**测验题（第 {question_number}/{total_questions} 道），依据规划器已经固定下来的 template。检索到的上下文和本轮已生成题目的列表都已提供，请据此做出有依据、不重复的题目。

输出**恰好一个**符合下方 schema 的 JSON 对象——不要包代码块、不要加标题、不要有其他文字。

JSON schema 示例（choice 类型）：

{{"question_type": "choice", "question": "以下哪个是 Python 的合法变量名？", "options": {{\"A\": "2name", "B": "_name", "C": "my-name", "D": "class"}}, "correct_answer": "B", "explanation": "Python 变量名不能以数字开头，不能包含连字符，不能使用关键字。"}}

硬性 schema 规则：
- ``question_type`` 必须**完全等于** template 的 question_type。
- 如果 ``question_type`` 是 ``choice``：``options`` 必须**恰好**包含 A、B、C、D 四个 key，每个非空；``correct_answer`` 必须是 "A"、"B"、"C"、"D" 之一。选项要可信且**长度 / 风格相近**——**不要**把正确选项写得明显比干扰项更长或更详细。
- 如果 ``question_type`` 是 ``concept``：题面是**一个命题**，由学习者判断对错。省略 ``options``（或 null）；``correct_answer`` 必须是小写字符串 ``"true"`` 或 ``"false"``。**不要**把题目写成「以下哪项…」式的选择。
- 如果 ``question_type`` 是 ``fill_in_blank``：题面中**必须**包含**恰好一处** ``____``（四个下划线），用于标记缺失的词或短语。省略 ``options``（或 null）；``correct_answer`` 是填入空白处的字符串（一个词或短语）。
- 如果 ``question_type`` 是 ``short_answer``：概念性简答，期望答案是几句话。省略 ``options``（或 null）；``correct_answer`` 是参考答案文本。
- 如果 ``question_type`` 是 ``written``：更长的论述 / 解答（一段甚至多段）。省略 ``options``（或 null）；``correct_answer`` 是参考答案文本。
- 如果 ``question_type`` 是 ``coding``：省略 ``options``（或 null）；``correct_answer`` 是参考代码 / 伪代码 / 算法。
- 题目必须严格扣住 template 的 ``topic``，并符合 ``difficulty``。
- 题目**不允许**重复 / 近似重复「本轮已生成题目」中的任何一项。
- 如用到检索内容，以 [source-id] 行内引用。
"""

QUIZ_USER_TEMPLATE = """## 用户指定的主题（必须围绕此主题出题）
{topic}

## 本题 template
- question_id: {question_id}
- topic: {topic}
- question_type: {question_type}
- difficulty: {difficulty}

## 检索到的上下文（可能与主题无关，请谨慎参考）
{context_text}

## 完整规划（本轮所有题目）
{plan_summary}

## 本轮已生成题目（**不要**重复）
{previous_questions}

开始为 {question_id} 出题。
"""

# ---------------------------------------------------------------------------
#  修复提示词（仅在 JSON schema 不合法时调用）
# ---------------------------------------------------------------------------

REPAIR_SYSTEM_PROMPT = """你来修复一个不合法的题目 JSON。读 invalid payload 和检测到的问题，然后输出修正后的 JSON 对象——**只**输出 JSON，不要其他内容。

硬性规则：
- ``question_type`` 与 template 一致（**不要**改）。
- 如果是 ``choice``：提供恰好四个选项 A/B/C/D；``correct_answer`` 必须是 "A"/"B"/"C"/"D" 之一。
- 如果是 ``concept``：省略 ``options``（或 null）；``correct_answer`` 必须是小写的 ``"true"`` 或 ``"false"``。
- 如果是 ``fill_in_blank``：省略 ``options``（或 null）；``question`` 中必须包含**恰好一处** ``____``（四个下划线）；``correct_answer`` 是填入空白处的字符串。
- 如果是 ``short_answer``、``written`` 或 ``coding``：省略 ``options``（或 null）；``correct_answer`` 是参考答案文本。
- 保留原 topic 和 difficulty 意图。
- 返回 JSON 只包含字段：question_type, question, options, correct_answer, explanation。
"""

REPAIR_USER_TEMPLATE = """## Template
- question_id: {question_id}
- topic: {topic}
- question_type: {question_type}
- difficulty: {difficulty}

## 无效载荷
{invalid_payload}

## 检测到的问题
{issues}
"""

# ---------------------------------------------------------------------------
#  空值提示（上下文/已生成题目为空时的替代文本）
# ---------------------------------------------------------------------------

EMPTY_CONTEXT = "（未检索到相关上下文——请基于通用知识出题）"
EMPTY_PREVIOUS_QUESTIONS = "（这是本轮第一题）"


__all__ = [
    "PLAN_SYSTEM_PROMPT",
    "PLAN_USER_TEMPLATE",
    "QUIZ_SYSTEM_PROMPT",
    "QUIZ_USER_TEMPLATE",
    "REPAIR_SYSTEM_PROMPT",
    "REPAIR_USER_TEMPLATE",
    "EMPTY_CONTEXT",
    "EMPTY_PREVIOUS_QUESTIONS",
]
