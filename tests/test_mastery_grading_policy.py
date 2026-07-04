import time

from src.mastery.grading import grade_answer
from src.mastery.models import KnowledgePoint, KnowledgeType, LearningModule, LearningProgress, QuizAttempt
from src.mastery.policy import compute_mastery, map_summary, next_objective
from src.mastery.scheduler import SpacedRepetitionScheduler


def _progress_with_kp(kp_type=KnowledgeType.MEMORY):
    kp = KnowledgePoint(id="doc-1_m0_kp0", name="变量", type=kp_type, module_id="doc-1_m0", description="变量的含义")
    module = LearningModule(id="doc-1_m0", name="基础", order=0, description="基础模块", knowledge_points=[kp])
    return LearningProgress(doc_id="doc-1", title="测试文档", modules=[module]), kp


def test_short_answer_accepts_close_match():
    assert grade_answer("递归函数", "递归函数", "short")
    assert grade_answer("递归函數", "递归函数", "short")


def test_quantitative_mastery_confidence_caps():
    assert compute_mastery([True]) == 0.5
    assert compute_mastery([True, True]) == 0.8
    assert compute_mastery([True, True, True]) >= 0.9


def test_next_objective_returns_first_unmastered_point():
    progress, kp = _progress_with_kp()
    step = next_objective(progress)
    assert step.action == "probe"
    assert step.knowledge_point_id == kp.id


def test_qualitative_mastery_uses_assessment_gate():
    progress, kp = _progress_with_kp(KnowledgeType.CONCEPT)
    progress.qualitative_mastery[kp.id] = True
    summary = map_summary(progress)
    assert summary["counts"]["mastered"] == 1


def test_review_queue_prioritizes_due_memory():
    progress, kp = _progress_with_kp()
    scheduler = SpacedRepetitionScheduler()
    state = scheduler.get_initial_state(kp.type)
    state.next_review_at = time.time() - 1
    progress.repetition_states[kp.id] = state
    progress.review_queue = scheduler.build_review_queue(progress)
    assert progress.review_queue[0].knowledge_point_id == kp.id
