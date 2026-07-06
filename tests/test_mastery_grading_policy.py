import time

from src.mastery.grading import grade_answer
from src.mastery.models import (
    ErrorRecord,
    ErrorType,
    KnowledgePoint,
    KnowledgeType,
    LearningModule,
    LearningProgress,
    PendingQuestion,
    QuizAttempt,
)
from src.mastery.policy import compute_mastery, map_summary, next_objective
from src.mastery.scheduler import SpacedRepetitionScheduler


def _progress_with_kps(*kp_types: KnowledgeType):
    points = [
        KnowledgePoint(
            id=f"doc-1_m0_kp{index}",
            name=f"知识点 {index}",
            type=kp_type,
            module_id="doc-1_m0",
            description=f"知识点 {index} 的含义",
        )
        for index, kp_type in enumerate(kp_types or (KnowledgeType.MEMORY,))
    ]
    module = LearningModule(
        id="doc-1_m0",
        name="基础",
        order=0,
        description="基础模块",
        knowledge_points=points,
    )
    return LearningProgress(doc_id="doc-1", title="测试文档", modules=[module]), points


def test_short_answer_accepts_close_match():
    assert grade_answer("递归函数", "递归函数", "short")
    assert grade_answer("递归函數", "递归函数", "short")


def test_quantitative_mastery_confidence_caps():
    assert compute_mastery([True]) == 0.5
    assert compute_mastery([True, True]) == 0.8
    assert compute_mastery([True, True, True]) >= 0.9


def test_next_objective_returns_first_unmastered_point():
    progress, (kp,) = _progress_with_kps()
    step = next_objective(progress)
    assert step.action == "probe"
    assert step.knowledge_point_id == kp.id
    assert step.knowledge_point_name == kp.name
    assert step.status == "new"
    assert step.gate == "quantitative"


def test_next_objective_returns_pending_question_first():
    progress, (kp,) = _progress_with_kps()
    progress.pending_question = PendingQuestion(
        question_id="q1",
        knowledge_point_id=kp.id,
        module_id="doc-1_m0",
        prompt="什么是变量？",
        expected_answer="变量是可变化的量",
    )

    step = next_objective(progress)

    assert step.action == "answer_pending"
    assert step.knowledge_point_id == kp.id
    assert step.pending_prompt == "什么是变量？"


def test_next_objective_returns_practice_for_seen_quantitative_point():
    progress, (kp,) = _progress_with_kps(KnowledgeType.MEMORY)
    progress.quiz_attempts.append(
        QuizAttempt(
            question_id="q1",
            knowledge_point_id=kp.id,
            module_id="doc-1_m0",
            is_correct=False,
            user_answer="",
        )
    )

    step = next_objective(progress)

    assert step.action == "practice"
    assert step.status == "learning"
    assert step.threshold == 0.9


def test_next_objective_returns_assess_for_failed_qualitative_point():
    progress, (kp,) = _progress_with_kps(KnowledgeType.CONCEPT)
    progress.qualitative_mastery[kp.id] = False

    step = next_objective(progress)

    assert step.action == "assess"
    assert step.gate == "qualitative"
    assert step.status == "learning"


def test_qualitative_mastery_uses_assessment_gate():
    progress, (kp,) = _progress_with_kps(KnowledgeType.CONCEPT)
    progress.qualitative_mastery[kp.id] = True
    summary = map_summary(progress)
    assert summary["counts"]["mastered"] == 1
    assert summary["counts"]["total"] == 1
    assert summary["complete"] is True


def test_review_queue_prioritizes_due_memory():
    progress, (kp,) = _progress_with_kps()
    scheduler = SpacedRepetitionScheduler()
    state = scheduler.get_initial_state(kp.type)
    state.next_review_at = time.time() - 1
    progress.repetition_states[kp.id] = state
    progress.review_queue = scheduler.build_review_queue(progress)
    assert progress.review_queue[0].knowledge_point_id == kp.id
    assert progress.review_queue[0].id == f"review_{kp.id}"
    assert progress.review_queue[0].state is state


def test_map_summary_counts_new_learning_mastered_and_due_reviews():
    progress, (new_kp, learning_kp, mastered_kp) = _progress_with_kps(
        KnowledgeType.MEMORY,
        KnowledgeType.MEMORY,
        KnowledgeType.CONCEPT,
    )
    progress.quiz_attempts.append(
        QuizAttempt(
            question_id="q1",
            knowledge_point_id=learning_kp.id,
            module_id="doc-1_m0",
            is_correct=False,
        )
    )
    progress.qualitative_mastery[mastered_kp.id] = True
    scheduler = SpacedRepetitionScheduler()
    state = scheduler.get_initial_state(learning_kp.type)
    state.next_review_at = time.time() - 1
    progress.repetition_states[learning_kp.id] = state

    summary = map_summary(progress)

    assert summary["counts"] == {"mastered": 1, "learning": 1, "new": 1, "total": 3}
    assert summary["due_reviews"] == 1
    module = summary["modules"][0]
    assert module["mastered"] == 1
    assert module["total"] == 3
    assert module["knowledge_points"][0]["id"] == new_kp.id
    assert module["knowledge_points"][0]["description"] == new_kp.description


def test_review_queue_prioritizes_active_errors_before_memory():
    progress, (error_kp, memory_kp) = _progress_with_kps(
        KnowledgeType.DESIGN,
        KnowledgeType.MEMORY,
    )
    scheduler = SpacedRepetitionScheduler()
    for kp in (error_kp, memory_kp):
        state = scheduler.get_initial_state(kp.type)
        state.next_review_at = time.time() - 1
        progress.repetition_states[kp.id] = state
    progress.error_records.append(
        ErrorRecord(
            id="err1",
            question_id="q1",
            knowledge_point_id=error_kp.id,
            module_id="doc-1_m0",
            error_type=ErrorType.METACOGNITIVE,
            status="active",
        )
    )

    queue = scheduler.build_review_queue(progress)

    assert queue[0].knowledge_point_id == error_kp.id
    assert queue[0].priority == 1
    assert queue[1].knowledge_point_id == memory_kp.id
    assert queue[1].priority == 2


def test_schedule_next_advances_and_downgrades_repetition_state():
    scheduler = SpacedRepetitionScheduler()
    state = scheduler.get_initial_state(KnowledgeType.MEMORY, now=1000)

    scheduler.schedule_next(state, KnowledgeType.MEMORY, True, now=1000)
    assert state.interval_index == 1
    assert state.consecutive_correct == 1

    scheduler.schedule_next(state, KnowledgeType.MEMORY, True, now=1000)
    assert state.interval_index == 3
    assert state.consecutive_correct == 0

    scheduler.schedule_next(state, KnowledgeType.MEMORY, False, now=1000)
    assert state.interval_index == 2
    assert state.consecutive_wrong == 1

    scheduler.schedule_next(state, KnowledgeType.MEMORY, False, now=1000)
    assert state.interval_index == 1
    assert state.consecutive_wrong == 0
