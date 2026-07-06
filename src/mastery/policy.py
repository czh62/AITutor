from __future__ import annotations

from dataclasses import dataclass
import time

from .models import KnowledgePoint, KnowledgeType, LearningProgress, ReviewTask
from .scheduler import SpacedRepetitionScheduler

RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0)
CONFIDENCE_CAPS = {1: 0.5, 2: 0.8}
QUANTITATIVE_GATE = {
    KnowledgeType.MEMORY: 0.9,
    KnowledgeType.PROCEDURE: 0.9,
}
QUALITATIVE_TYPES = frozenset({KnowledgeType.CONCEPT, KnowledgeType.DESIGN})


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
    if kp.type in QUALITATIVE_TYPES:
        return progress.qualitative_mastery.get(kp.id, False)
    return progress.mastery_levels.get(kp.id, 0.0) >= gate_threshold(kp.type)


def gate_threshold(kp_type: KnowledgeType) -> float:
    if kp_type in QUALITATIVE_TYPES:
        return 1.0
    return QUANTITATIVE_GATE.get(kp_type, 0.9)


def display_mastery(progress: LearningProgress, kp: KnowledgePoint) -> float:
    if kp.type in QUALITATIVE_TYPES:
        if progress.qualitative_mastery.get(kp.id, False):
            return 1.0
        if kp.id in progress.qualitative_mastery:
            return min(progress.mastery_levels.get(kp.id, 0.0), 0.4)
    return float(progress.mastery_levels.get(kp.id, 0.0))


def objective_status(progress: LearningProgress, kp: KnowledgePoint) -> str:
    if is_mastered(progress, kp):
        return "mastered"
    seen = (
        any(attempt.knowledge_point_id == kp.id for attempt in progress.quiz_attempts)
        or kp.id in progress.qualitative_mastery
        or kp.id in progress.started_points
        or kp.id in progress.quiz_started_points
        or kp.id in progress.review_later_points
        or progress.mastery_levels.get(kp.id, 0.0) > 0
    )
    return "learning" if seen else "new"


def find_knowledge_point(
    progress: LearningProgress, kp_id: str
) -> tuple[KnowledgePoint | None, str, str]:
    for module in sorted(progress.modules, key=lambda item: item.order):
        for kp in module.knowledge_points:
            if kp.id == kp_id:
                return kp, module.id, module.name
    return None, "", ""


def due_reviews(progress: LearningProgress, *, now: float | None = None) -> list[ReviewTask]:
    return SpacedRepetitionScheduler().build_review_queue(progress, now=now)


@dataclass(frozen=True)
class NextStep:
    action: str
    module_id: str = ""
    module_name: str = ""
    knowledge_point_id: str = ""
    knowledge_point_name: str = ""
    knowledge_point_type: str = ""
    status: str = ""
    gate: str = ""
    mastery: float = 0.0
    threshold: float = 0.0
    reason: str = ""
    pending_prompt: str = ""

    def to_dict(self) -> dict:
        return {
            "action": self.action,
            "module_id": self.module_id,
            "module_name": self.module_name,
            "knowledge_point_id": self.knowledge_point_id,
            "knowledge_point_name": self.knowledge_point_name,
            "knowledge_point_type": self.knowledge_point_type,
            "status": self.status,
            "gate": self.gate,
            "mastery": round(self.mastery, 3),
            "threshold": round(self.threshold, 3),
            "reason": self.reason,
            "pending_prompt": self.pending_prompt,
        }


def _gate_kind(kp: KnowledgePoint) -> str:
    return "qualitative" if kp.type in QUALITATIVE_TYPES else "quantitative"


def next_objective(progress: LearningProgress, *, now: float | None = None) -> NextStep:
    current_time = time.time() if now is None else now
    if progress.pending_question is not None:
        pending = progress.pending_question
        kp, module_id, module_name = find_knowledge_point(progress, pending.knowledge_point_id)
        return NextStep(
            action="answer_pending",
            module_id=module_id or pending.module_id,
            module_name=module_name,
            knowledge_point_id=pending.knowledge_point_id,
            knowledge_point_name=kp.name if kp else "",
            knowledge_point_type=kp.type.value if kp else "",
            status=objective_status(progress, kp) if kp else "learning",
            gate=_gate_kind(kp) if kp else "",
            mastery=display_mastery(progress, kp) if kp else 0.0,
            threshold=gate_threshold(kp.type) if kp else 0.0,
            reason="A posed question is awaiting the learner's answer.",
            pending_prompt=pending.prompt,
        )

    review_queue = due_reviews(progress, now=current_time)
    if review_queue:
        kp, module_id, module_name = find_knowledge_point(progress, review_queue[0].knowledge_point_id)
        if kp is not None:
            return NextStep(
                action="review",
                module_id=module_id,
                module_name=module_name,
                knowledge_point_id=kp.id,
                knowledge_point_name=kp.name,
                knowledge_point_type=kp.type.value,
                status=objective_status(progress, kp),
                gate=_gate_kind(kp),
                mastery=display_mastery(progress, kp),
                threshold=gate_threshold(kp.type),
                reason="This objective is due for spaced-repetition review.",
            )

    for module in sorted(progress.modules, key=lambda item: item.order):
        for kp in module.knowledge_points:
            if is_mastered(progress, kp):
                continue
            status = objective_status(progress, kp)
            gate = _gate_kind(kp)
            action = "probe" if status == "new" else "assess" if gate == "qualitative" else "practice"
            return NextStep(
                action=action,
                module_id=module.id,
                module_name=module.name,
                knowledge_point_id=kp.id,
                knowledge_point_name=kp.name,
                knowledge_point_type=kp.type.value,
                status=status,
                gate=gate,
                mastery=display_mastery(progress, kp),
                threshold=gate_threshold(kp.type),
                reason=(
                    "Untouched objective - probe first to let the learner test out."
                    if status == "new"
                    else "Objective is below its mastery gate; keep working it until it clears."
                ),
            )

    return NextStep(action="complete", reason="All objectives are mastered and no reviews are due.")


def map_summary(progress: LearningProgress, *, now: float | None = None) -> dict:
    current_time = time.time() if now is None else now
    review_queue = due_reviews(progress, now=current_time)
    counts = {"mastered": 0, "learning": 0, "new": 0, "total": 0}
    modules: list[dict] = []

    for module in sorted(progress.modules, key=lambda item: item.order):
        module_points: list[dict] = []
        mastered = 0
        for kp in module.knowledge_points:
            status = objective_status(progress, kp)
            counts[status] += 1
            counts["total"] += 1
            if status == "mastered":
                mastered += 1
            module_points.append(
                {
                    "id": kp.id,
                    "name": kp.name,
                    "type": kp.type.value,
                    "status": status,
                    "mastery": round(display_mastery(progress, kp), 3),
                    "description": kp.description,
                    "dependencies": kp.dependencies,
                    "review_later_at": progress.review_later_points.get(kp.id),
                }
            )
        modules.append(
            {
                "id": module.id,
                "name": module.name,
                "order": module.order,
                "description": module.description,
                "mastered": mastered,
                "total": len(module.knowledge_points),
                "knowledge_points": module_points,
            }
        )

    return {
        "counts": counts,
        "due_reviews": len(review_queue),
        "complete": counts["total"] > 0 and counts["mastered"] == counts["total"],
        "modules": modules,
    }


def _iter_knowledge_points(progress: LearningProgress) -> list[KnowledgePoint]:
    modules = sorted(progress.modules, key=lambda module: module.order)
    knowledge_points: list[KnowledgePoint] = []
    for module in modules:
        knowledge_points.extend(module.knowledge_points)
    return knowledge_points
