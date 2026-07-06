from __future__ import annotations

from difflib import SequenceMatcher
import unicodedata

from .models import ErrorType


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").strip().casefold()
    return "".join(normalized.split())


def grade_answer(user_answer: str, expected_answer: str, question_type: str = "short") -> bool:
    user = _normalize_text(user_answer)
    expected = _normalize_text(expected_answer)
    if not user or not expected:
        return False
    if question_type != "short":
        return user == expected
    if user == expected:
        return True
    return SequenceMatcher(a=user, b=expected).ratio() >= 0.75


def classify_error(user_answer: str) -> ErrorType:
    if not _normalize_text(user_answer):
        return ErrorType.METACOGNITIVE
    return ErrorType.APPLICATION_ERROR
