from __future__ import annotations

import time

from .models import KnowledgePoint, KnowledgeType, LearningProgress, RepetitionState, ReviewTask

REVIEW_INTERVALS = {
    KnowledgeType.MEMORY: [0, 1, 3, 7, 14, 30, 60],
    KnowledgeType.CONCEPT: [3, 7, 14, 30],
    KnowledgeType.PROCEDURE: [3, 7, 14],
    KnowledgeType.DESIGN: [14, 28],
}

REVIEW_PRIORITIES = {
    KnowledgeType.MEMORY: 2,
    KnowledgeType.CONCEPT: 3,
    KnowledgeType.PROCEDURE: 4,
    KnowledgeType.DESIGN: 5,
}


class SpacedRepetitionScheduler:
    def get_initial_state(self, knowledge_type: KnowledgeType, *, now: float | None = None) -> RepetitionState:
        current_time = time.time() if now is None else now
        interval_days = REVIEW_INTERVALS[knowledge_type][0]
        return RepetitionState(
            interval_index=0,
            next_review_at=current_time + (interval_days * 86400),
        )

    def schedule_next(
        self,
        state: RepetitionState,
        knowledge_type: KnowledgeType,
        is_correct: bool,
        *,
        now: float | None = None,
    ) -> RepetitionState:
        if is_correct:
            state.consecutive_correct += 1
            state.consecutive_wrong = 0
            jump = 2 if state.consecutive_correct >= 2 else 1
            if state.consecutive_correct >= 2:
                state.consecutive_correct = 0
        else:
            state.consecutive_wrong += 1
            state.consecutive_correct = 0
            jump = -1
            if state.consecutive_wrong >= 2:
                state.consecutive_wrong = 0

        intervals = REVIEW_INTERVALS[knowledge_type]
        state.interval_index = max(
            0,
            min(state.interval_index + jump, len(intervals) - 1),
        )
        current_time = time.time() if now is None else now
        state.next_review_at = current_time + (intervals[state.interval_index] * 86400)
        return state

    def build_review_queue(self, progress: LearningProgress, *, now: float | None = None) -> list[ReviewTask]:
        current_time = time.time() if now is None else now
        queue: list[ReviewTask] = []
        errors_by_kp = {
            record.knowledge_point_id: record
            for record in progress.error_records
            if record.status in {"active", "retrying"}
        }
        for kp in _iter_knowledge_points(progress):
            state = progress.repetition_states.get(kp.id)
            if state is None or state.next_review_at > current_time:
                continue
            priority = 1 if kp.id in errors_by_kp else REVIEW_PRIORITIES[kp.type]
            queue.append(
                ReviewTask(
                    id=f"review_{kp.id}",
                    knowledge_point_id=kp.id,
                    knowledge_type=kp.type,
                    due_at=state.next_review_at,
                    priority=priority,
                    state=state,
                )
            )
        queue.sort(key=lambda task: (task.priority, task.due_at, task.knowledge_point_id))
        return queue


def _iter_knowledge_points(progress: LearningProgress) -> list[KnowledgePoint]:
    modules = sorted(progress.modules, key=lambda module: module.order)
    knowledge_points: list[KnowledgePoint] = []
    for module in modules:
        knowledge_points.extend(module.knowledge_points)
    return knowledge_points
