from __future__ import annotations

import time

from .models import KnowledgePoint, KnowledgeType, LearningProgress, NextAction, NextStep
from .scheduler import SpacedRepetitionScheduler

RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0)
CONFIDENCE_CAPS = {1: 0.5, 2: 0.8}


def compute_mastery(correctness: list[bool]) -> float:
    if not correctness:
        return 0.0
    recent = correctness[-len(RECENCY_WEIGHTS) :]
    weights = RECENCY_WEIGHTS[-len(recent) :]
    weighted_score = sum((1.0 if value else 0.0) * weight for value, weight in zip(recent, weights, strict=False))
    mastery = weighted_score / sum(weights)
    cap = CONFIDENCE_CAPS.get(len(correctness))
    if cap is not None:
        mastery = min(mastery, cap)
    return round(mastery, 4)


def is_mastered(progress: LearningProgress, kp: KnowledgePoint) -> bool:
    if kp.type in {KnowledgeType.CONCEPT, KnowledgeType.DESIGN}:
        return progress.qualitative_mastery.get(kp.id, False)
    return progress.mastery_levels.get(kp.id, 0.0) >= 0.9


def next_objective(progress: LearningProgress, *, now: float | None = None) -> NextStep:
    current_time = time.time() if now is None else now
    if progress.pending_question is not None:
        return NextStep(action=NextAction.GRADE, knowledge_point_id=progress.pending_question.knowledge_point_id)

    scheduler = SpacedRepetitionScheduler()
    review_queue = scheduler.build_review_queue(progress, now=current_time)
    if review_queue:
        return NextStep(action=NextAction.REVIEW, knowledge_point_id=review_queue[0].knowledge_point_id)

    for kp in _iter_knowledge_points(progress):
        if not is_mastered(progress, kp):
            return NextStep(action=NextAction.PROBE, knowledge_point_id=kp.id)

    return NextStep(action=NextAction.COMPLETE)


def map_summary(progress: LearningProgress, *, now: float | None = None) -> dict:
    current_time = time.time() if now is None else now
    scheduler = SpacedRepetitionScheduler()
    review_queue = scheduler.build_review_queue(progress, now=current_time)
    mastered = 0
    total = 0
    modules: list[dict] = []

    for module in sorted(progress.modules, key=lambda item: item.order):
        module_points: list[dict] = []
        for kp in module.knowledge_points:
            total += 1
            mastery = _display_mastery(progress, kp)
            mastered_flag = is_mastered(progress, kp)
            if mastered_flag:
                mastered += 1
            module_points.append(
                {
                    "id": kp.id,
                    "name": kp.name,
                    "type": kp.type.value,
                    "mastery": mastery,
                    "mastered": mastered_flag,
                    "dependencies": kp.dependencies,
                }
            )
        modules.append(
            {
                "id": module.id,
                "name": module.name,
                "order": module.order,
                "knowledge_points": module_points,
            }
        )

    return {
        "doc_id": progress.doc_id,
        "title": progress.title,
        "counts": {
            "total": total,
            "mastered": mastered,
            "remaining": max(total - mastered, 0),
            "review_due": len(review_queue),
        },
        "modules": modules,
        "next_step": next_objective(progress, now=current_time).model_dump(),
    }


def _display_mastery(progress: LearningProgress, kp: KnowledgePoint) -> float:
    if kp.type in {KnowledgeType.CONCEPT, KnowledgeType.DESIGN}:
        if progress.qualitative_mastery.get(kp.id, False):
            return 1.0
        if kp.id in progress.qualitative_mastery:
            return 0.4
        return progress.mastery_levels.get(kp.id, 0.0)
    return progress.mastery_levels.get(kp.id, 0.0)


def _iter_knowledge_points(progress: LearningProgress) -> list[KnowledgePoint]:
    modules = sorted(progress.modules, key=lambda module: module.order)
    knowledge_points: list[KnowledgePoint] = []
    for module in modules:
        knowledge_points.extend(module.knowledge_points)
    return knowledge_points
