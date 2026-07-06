"""AI 判题 + 追问讲解的提示词模板。

从 DeepTutor quiz_judge.py 移植中文 prompt，适配 AITutor 的 NDJSON 流式架构。
"""

from __future__ import annotations

from ..core.prompting import DEMO_RESPONSE_LANGUAGE_RULE

# ── AI 判题 ──────────────────────────────────────────────

JUDGE_SYSTEM_PROMPT_ZH = (
    "你是一名严谨且鼓励学习者的助教，正在批改一道测验题。"
    "请基于题目、参考答案与解析，对学习者的作答给出针对性的判定与反馈。\n\n"
    "回答要求：\n"
    "- 先用一行明确结论：✅ 正确 / ⚠️ 部分正确 / ❌ 不正确，并简短点明关键判定依据。\n"
    "- 然后分条列出：哪里做对了、哪里出错或缺漏、应该如何改正。\n"
    "- 若题目本身有多种合理答案，请承认学习者的合理之处。\n"
    "- 直接以学习者的作答为对象，不要泛泛而谈。\n"
    f"- {DEMO_RESPONSE_LANGUAGE_RULE}"
)

JUDGE_SYSTEM_PROMPT_EN = (
    "You are a rigorous yet encouraging teaching assistant grading a learner's quiz answer. "
    "Use the question, reference answer, and explanation to deliver a targeted assessment.\n\n"
    "Requirements:\n"
    "- Open with one line that states the verdict: ✅ Correct / ⚠️ Partially correct / ❌ Incorrect, "
    "and the key reason.\n"
    "- Then list: what the learner got right, what is wrong or missing, and how to fix it.\n"
    "- If multiple reasonable answers exist, acknowledge what the learner did well.\n"
    "- Speak directly to the learner's submission — do not give a generic lecture.\n"
    f"- {DEMO_RESPONSE_LANGUAGE_RULE}"
)


def build_judge_user_prompt(
    *,
    language: str,
    question: str,
    question_type: str,
    options: dict | None,
    correct_answer: str,
    explanation: str,
    user_answer: str,
) -> str:
    """构造 AI 判题的用户提示词。"""
    options_block = ""
    if options:
        try:
            options_block = "\n".join(f"  {k}. {v}" for k, v in options.items())
        except Exception:
            options_block = ""

    if language == "zh":
        parts = [
            f"题目类型：{question_type or 'unknown'}",
            f"题干：\n{question}",
        ]
        if options_block:
            parts.append(f"选项：\n{options_block}")
        if correct_answer:
            parts.append(f"参考答案：\n{correct_answer}")
        if explanation:
            parts.append(f"参考解析：\n{explanation}")
        parts.append(
            "学习者作答：\n"
            + (user_answer.strip() if user_answer and user_answer.strip() else "（未作答）")
        )
        parts.append("请针对该学习者的具体作答给出 AI 评判。")
    else:
        parts = [
            f"Question type: {question_type or 'unknown'}",
            f"Question:\n{question}",
        ]
        if options_block:
            parts.append(f"Options:\n{options_block}")
        if correct_answer:
            parts.append(f"Reference answer:\n{correct_answer}")
        if explanation:
            parts.append(f"Reference explanation:\n{explanation}")
        parts.append(
            "Learner's answer:\n"
            + (user_answer.strip() if user_answer and user_answer.strip() else "(no answer)")
        )
        parts.append("Produce an AI judgment that addresses this learner's specific answer.")

    return "\n\n".join(parts)


# ── 追问讲解 ──────────────────────────────────────────────

FOLLOWUP_SYSTEM_PROMPT_ZH = (
    "你是一名耐心、善于引导的助教，正在帮助学习者深入理解一道测验题。"
    "学习者已经作答并看到了参考答案和 AI 评判，现在有进一步的疑问。\n\n"
    "回答要求：\n"
    "- 以题目的知识点为核心，结合学习者的作答与疑问进行针对性讲解。\n"
    "- 若学习者对参考答案有疑问，解释为什么该答案是正确的（或部分正确/错误的）。\n"
    "- 适当拓展相关知识点，帮助学习者建立更深层的理解，但不要偏离主题。\n"
    "- 语言简洁清晰，避免冗长堆砌。\n"
    f"- {DEMO_RESPONSE_LANGUAGE_RULE}"
)

FOLLOWUP_SYSTEM_PROMPT_EN = (
    "You are a patient, guiding teaching assistant helping a learner understand a quiz question "
    "more deeply. The learner has submitted their answer and seen the reference answer and AI judgment, "
    "and now has a follow-up question.\n\n"
    "Requirements:\n"
    "- Focus on the knowledge point of the question, addressing the learner's answer and their "
    "follow-up question.\n"
    "- If the learner questions the reference answer, explain why it is correct (or partially "
    "correct/incorrect).\n"
    "- Expand on related knowledge points to deepen understanding, but stay on-topic.\n"
    "- Be concise and clear, avoid lengthy exposition.\n"
    f"- {DEMO_RESPONSE_LANGUAGE_RULE}"
)


def build_followup_user_prompt(
    *,
    language: str,
    followup_question: str,
    question: str,
    question_type: str,
    options: dict | None,
    correct_answer: str,
    explanation: str,
    user_answer: str,
    ai_judgment: str | None,
) -> str:
    """构造追问讲解的用户提示词。"""
    options_block = ""
    if options:
        try:
            options_block = "\n".join(f"  {k}. {v}" for k, v in options.items())
        except Exception:
            options_block = ""

    if language == "zh":
        parts = [
            f"题目类型：{question_type or 'unknown'}",
            f"题干：\n{question}",
        ]
        if options_block:
            parts.append(f"选项：\n{options_block}")
        if correct_answer:
            parts.append(f"参考答案：\n{correct_answer}")
        if explanation:
            parts.append(f"参考解析：\n{explanation}")
        parts.append(
            "学习者作答：\n"
            + (user_answer.strip() if user_answer and user_answer.strip() else "（未作答）")
        )
        if ai_judgment and ai_judgment.strip():
            parts.append(f"AI 评判：\n{ai_judgment.strip()}")
        parts.append(f"学习者追问：\n{followup_question.strip()}")
        parts.append("请针对学习者的追问进行讲解。")
    else:
        parts = [
            f"Question type: {question_type or 'unknown'}",
            f"Question:\n{question}",
        ]
        if options_block:
            parts.append(f"Options:\n{options_block}")
        if correct_answer:
            parts.append(f"Reference answer:\n{correct_answer}")
        if explanation:
            parts.append(f"Reference explanation:\n{explanation}")
        parts.append(
            "Learner's answer:\n"
            + (user_answer.strip() if user_answer and user_answer.strip() else "(no answer)")
        )
        if ai_judgment and ai_judgment.strip():
            parts.append(f"AI judgment:\n{ai_judgment.strip()}")
        parts.append(f"Learner's follow-up question:\n{followup_question.strip()}")
        parts.append("Provide an explanation addressing the learner's follow-up question.")

    return "\n\n".join(parts)


__all__ = [
    "JUDGE_SYSTEM_PROMPT_ZH",
    "JUDGE_SYSTEM_PROMPT_EN",
    "build_judge_user_prompt",
    "FOLLOWUP_SYSTEM_PROMPT_ZH",
    "FOLLOWUP_SYSTEM_PROMPT_EN",
    "build_followup_user_prompt",
]
