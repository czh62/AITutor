"""出题数据类型。

从 DeepTutor 的 QuestionType/QuizTemplate/QuizPlan/QuizPair 移植并简化：
- 保留 QuestionType taxonomy（6 种题型）
- QuizTemplate 简化（去掉 source/reference_question/reference_answer，不含 mimic 模式字段）
- QuizQuestion 对齐前端渲染所需的字段
- 辅助常量与验证函数
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class QuestionType(StrEnum):
    """题型分类（对齐 DeepTutor canonical taxonomy）。"""

    CHOICE = "choice"
    CONCEPT = "concept"
    FILL_IN_BLANK = "fill_in_blank"
    SHORT_ANSWER = "short_answer"
    WRITTEN = "written"
    CODING = "coding"


# 合法的题型/难度集合
_VALID_QUESTION_TYPES: frozenset[str] = frozenset(qt.value for qt in QuestionType)
_VALID_DIFFICULTIES: frozenset[str] = frozenset({"easy", "medium", "hard"})
_CHOICE_KEYS = ("A", "B", "C", "D")
_FILL_IN_BLANK_TOKEN = "____"
_CONCEPT_ANSWERS: frozenset[str] = frozenset({"true", "false"})


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class QuizTemplate:
    """规划器输出的题目蓝图（一道题的 template）。"""

    question_id: str
    topic: str
    question_type: str
    difficulty: str


@dataclass(frozen=True)
class QuizPlan:
    """规划器输出的完整规划。"""

    analysis: str
    templates: list[QuizTemplate] = field(default_factory=list)


@dataclass
class QuizQuestion:
    """最终输出给前端的单道题目（对齐 DeepTutor QuizPair）。"""

    question_id: str
    question: str
    question_type: str
    correct_answer: str
    explanation: str
    options: dict[str, str] | None = None
    topic: str = ""
    difficulty: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# 验证与归一化辅助函数（从 DeepTutor pipeline.py 移植）
# ---------------------------------------------------------------------------


def normalize_type_list(types: list[str] | None) -> list[str]:
    """将用户提供的题型列表归一化：去重、过滤非法值、保留顺序。空列表 = 任意题型。"""
    if not types:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in types:
        if not isinstance(raw, str):
            continue
        normalized = raw.strip().lower()
        if normalized in _VALID_QUESTION_TYPES and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def normalize_difficulty(difficulty: str) -> str:
    """归一化难度参数。空字符串或 "auto" → 让规划器自行决定。"""
    d = difficulty.strip().lower()
    if d in _VALID_DIFFICULTIES:
        return d
    return "auto"


def format_allowed_types(types: list[str]) -> str:
    """渲染允许的题型列表给 prompt 使用。空列表 = 任意题型。"""
    if not types:
        return "任意（规划器按每道题选择最合适的题型）"
    return ", ".join(f"``{t}``" for t in types)


def format_difficulty(difficulty: str) -> str:
    """渲染难度给 prompt 使用。"""
    if difficulty == "auto":
        return "auto（规划器按每道题选择）"
    return difficulty


def parse_quiz_payload(raw: str) -> dict[str, Any]:
    """从 LLM 输出解析题目 JSON。处理围栏代码块、JSON 提取等容错逻辑。

    移植自 DeepTutor pipeline.py 的 _parse_quiz_payload，增加更健壮的多行 JSON 解析。
    """
    import json
    import re

    text = (raw or "").strip()
    if not text:
        return {}
    # 剥离 ```json ... ``` 围栏（允许多行）
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    # 直接尝试完整 JSON 解析
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass
    # 尝试从文本中提取最外层 {...}（匹配最长的 JSON 块）
    # 使用非贪婪匹配来找到最内层的完整 JSON 对象
    candidates = list(re.finditer(r"\{[\s\S]*?\}", text))
    # 优先尝试最长匹配（最外层）
    for match in reversed(candidates):
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict) and parsed:
                return parsed
        except json.JSONDecodeError:
            continue
    # 最后尝试：找最外层 { 到最后一个 } 的范围
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        candidate = text[first_brace : last_brace + 1]
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            pass
    return {}


def normalize_quiz_payload(template: QuizTemplate, payload: dict[str, Any]) -> dict[str, Any]:
    """归一化 LLM 输出的题目 JSON：强制 question_type 与 template 一致、选项/答案格式修正。

    移植自 DeepTutor pipeline.py 的 _normalize_quiz_payload。
    """
    normalized = dict(payload or {})
    expected_type = template.question_type
    normalized["question_type"] = expected_type
    normalized["question"] = str(normalized.get("question", "") or "").strip()
    normalized["correct_answer"] = str(normalized.get("correct_answer", "") or "").strip()
    normalized["explanation"] = str(normalized.get("explanation", "") or "").strip()

    raw_options = normalized.get("options")
    if expected_type == QuestionType.CHOICE.value:
        clean: dict[str, str] = {}
        if isinstance(raw_options, dict):
            for key, value in raw_options.items():
                k = str(key or "").strip().upper()[:1]
                v = str(value or "").strip()
                if k in _CHOICE_KEYS and v:
                    clean[k] = v
        normalized["options"] = clean or None
        if clean and normalized["correct_answer"]:
            ans = normalized["correct_answer"].upper().strip()
            if ans in clean:
                normalized["correct_answer"] = ans
            else:
                for key, value in clean.items():
                    if normalized["correct_answer"].lower() == value.lower():
                        normalized["correct_answer"] = key
                        break
    elif expected_type == QuestionType.CONCEPT.value:
        normalized["options"] = None
        raw_ans = normalized["correct_answer"].lower()
        if raw_ans in {"true", "t", "对", "正确", "yes", "y", "1"}:
            normalized["correct_answer"] = "true"
        elif raw_ans in {"false", "f", "错", "错误", "no", "n", "0"}:
            normalized["correct_answer"] = "false"
    else:
        normalized["options"] = None
    return normalized


def collect_quiz_issues(template: QuizTemplate, payload: dict[str, Any]) -> list[str]:
    """检查题目 JSON 是否合规，返回 issue 列表。空列表 = 合规。

    移植自 DeepTutor pipeline.py 的 _collect_quiz_issues。
    """
    issues: list[str] = []
    question = str(payload.get("question") or "").strip()
    correct = str(payload.get("correct_answer") or "").strip()
    explanation = str(payload.get("explanation") or "").strip()
    options = payload.get("options")

    if not question:
        issues.append("missing_question")
    if not correct:
        issues.append("missing_correct_answer")
    if not explanation:
        issues.append("missing_explanation")

    qtype = template.question_type
    if qtype == QuestionType.CHOICE.value:
        if not isinstance(options, dict) or set(options.keys()) != set(_CHOICE_KEYS):
            issues.append("choice_options_must_be_a_to_d")
        if correct.upper() not in _CHOICE_KEYS:
            issues.append("choice_correct_answer_must_be_option_key")
    elif qtype == QuestionType.CONCEPT.value:
        if isinstance(options, dict) and options:
            issues.append("concept_must_not_have_options")
        if correct.lower() not in _CONCEPT_ANSWERS:
            issues.append("concept_correct_answer_must_be_true_or_false")
    elif qtype == QuestionType.FILL_IN_BLANK.value:
        if isinstance(options, dict) and options:
            issues.append("fill_in_blank_must_not_have_options")
        if question and _FILL_IN_BLANK_TOKEN not in question:
            issues.append("fill_in_blank_question_must_contain_blank_token")
    else:
        if isinstance(options, dict) and options:
            issues.append("non_choice_must_not_have_options")
        if correct.upper() in _CHOICE_KEYS and len(correct) == 1:
            issues.append("non_choice_correct_answer_looks_like_option_key")
    return issues


def quiz_question_to_dict(q: QuizQuestion) -> dict[str, Any]:
    """QuizQuestion → dict（用于 StreamBus metadata 和前端 JSON）。"""
    return {
        "question_id": q.question_id,
        "question": q.question,
        "question_type": q.question_type,
        "correct_answer": q.correct_answer,
        "explanation": q.explanation,
        "options": q.options,
        "topic": q.topic,
        "difficulty": q.difficulty,
    }


def parse_plan(raw: str, *, requested: int, allowed_types: list[str], target_difficulty: str) -> QuizPlan:
    """从 LLM 输出解析规划 JSON。

    移植自 DeepTutor pipeline.py 的 _parse_plan，简化去掉 mimic 相关逻辑。
    """
    import json
    import re

    # 先尝试 JSON 解析
    text = (raw or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        obj = re.search(r"\{[\s\S]*\}", text)
        if obj is None:
            return QuizPlan(analysis="", templates=[])
        try:
            data = json.loads(obj.group(0))
        except json.JSONDecodeError:
            return QuizPlan(analysis="", templates=[])

    if not isinstance(data, dict) or not data:
        return QuizPlan(analysis="", templates=[])

    analysis = str(data.get("analysis", "") or "")

    # 取 templates 或 ideas 字段
    raw_items: list[Any]
    if isinstance(data.get("templates"), list):
        raw_items = list(data["templates"])
    elif isinstance(data.get("ideas"), list):
        raw_items = list(data["ideas"])
    else:
        raw_items = []

    allowed_set: frozenset[str] = frozenset(allowed_types) if allowed_types else _VALID_QUESTION_TYPES

    # Fallback type: prefer short_answer if allowed, else first allowed, else written
    if QuestionType.SHORT_ANSWER.value in allowed_set:
        fallback_type = QuestionType.SHORT_ANSWER.value
    elif allowed_set:
        fallback_type = next(iter(allowed_set))
    else:
        fallback_type = QuestionType.WRITTEN.value

    templates: list[QuizTemplate] = []
    seen_topics: set[str] = set()

    for idx, item in enumerate(raw_items, 1):
        if not isinstance(item, dict):
            continue
        topic = str(item.get("topic") or item.get("concentration") or "").strip()
        if not topic or topic.lower() in seen_topics:
            continue
        seen_topics.add(topic.lower())

        qtype_raw = str(item.get("question_type", "")).strip().lower()
        qtype = qtype_raw if qtype_raw in allowed_set else fallback_type

        diff_raw = str(item.get("difficulty", "")).strip().lower()
        diff = target_difficulty if target_difficulty != "auto" else diff_raw
        diff = diff if diff in _VALID_DIFFICULTIES else "medium"

        templates.append(
            QuizTemplate(
                question_id=f"q_{len(templates) + 1}",
                topic=topic,
                question_type=qtype,
                difficulty=diff,
            )
        )
        if len(templates) >= requested:
            break

    return QuizPlan(analysis=analysis, templates=templates)


__all__ = [
    "QuestionType",
    "QuizTemplate",
    "QuizPlan",
    "QuizQuestion",
    "normalize_type_list",
    "normalize_difficulty",
    "format_allowed_types",
    "format_difficulty",
    "parse_quiz_payload",
    "normalize_quiz_payload",
    "collect_quiz_issues",
    "quiz_question_to_dict",
    "parse_plan",
    "_VALID_QUESTION_TYPES",
    "_VALID_DIFFICULTIES",
    "_CHOICE_KEYS",
    "_FILL_IN_BLANK_TOKEN",
    "_CONCEPT_ANSWERS",
]
