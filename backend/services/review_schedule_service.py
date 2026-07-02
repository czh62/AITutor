from datetime import datetime, timedelta
import math
import uuid

from sqlalchemy.orm import Session

from ..models.database import ReviewSchedule, SkillNode


def utcnow() -> datetime:
    return datetime.utcnow()


def get_node(db: Session, node_id: str) -> SkillNode | None:
    return db.query(SkillNode).filter(SkillNode.id == node_id).first()


def get_schedule(db: Session, node_id: str) -> ReviewSchedule | None:
    return db.query(ReviewSchedule).filter(ReviewSchedule.node_id == node_id).first()


def get_node_title(node: SkillNode) -> str:
    return getattr(node, "title", None) or getattr(node, "name", None) or ""


def create_schedule(db: Session, node: SkillNode, now: datetime | None = None) -> ReviewSchedule:
    current_time = now or utcnow()
    schedule = ReviewSchedule(
        id=str(uuid.uuid4()),
        node_id=node.id,
        interval_days=1,
        ease_factor=2.5,
        review_count=0,
        last_score=None,
        last_reviewed_at=None,
        next_review_at=current_time + timedelta(days=1),
        created_at=current_time,
        updated_at=current_time,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def get_or_create_schedule(db: Session, node: SkillNode, now: datetime | None = None) -> ReviewSchedule:
    schedule = get_schedule(db, node.id)
    if schedule:
        return schedule
    return create_schedule(db, node, now=now)


def apply_review_result(schedule: ReviewSchedule, score: float, reviewed_at: datetime) -> None:
    interval_days = schedule.interval_days or 1
    ease_factor = schedule.ease_factor or 2.5
    first_review = (schedule.review_count or 0) == 0

    if score < 60:
        next_interval = 1
        next_ease = max(1.3, ease_factor - 0.2)
    elif score < 85:
        next_interval = 1 if first_review else max(1, round(interval_days * ease_factor))
        next_ease = ease_factor
    else:
        next_interval = 2 if first_review else max(2, round(interval_days * (ease_factor + 0.15)))
        next_ease = min(3.0, ease_factor + 0.1)

    schedule.interval_days = next_interval
    schedule.ease_factor = next_ease
    schedule.review_count = (schedule.review_count or 0) + 1
    schedule.last_score = score
    schedule.last_reviewed_at = reviewed_at
    schedule.next_review_at = reviewed_at + timedelta(days=next_interval)
    schedule.updated_at = reviewed_at


def serialize_schedule(schedule: ReviewSchedule, node: SkillNode | None = None) -> dict:
    data = {
        "node_id": schedule.node_id,
        "interval_days": schedule.interval_days,
        "ease_factor": schedule.ease_factor,
        "review_count": schedule.review_count,
        "last_score": schedule.last_score,
        "last_reviewed_at": schedule.last_reviewed_at,
        "next_review_at": schedule.next_review_at,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }
    if node is not None:
        data["title"] = get_node_title(node)
        data["mastery"] = node.mastery
        data["status"] = node.status
    return data


def get_due_reviews(db: Session, limit: int, offset: int, as_of: datetime | None = None) -> dict:
    due_at = as_of or utcnow()
    query = (
        db.query(ReviewSchedule, SkillNode)
        .join(SkillNode, ReviewSchedule.node_id == SkillNode.id)
        .filter(ReviewSchedule.next_review_at <= due_at)
        .order_by(ReviewSchedule.next_review_at.asc())
    )
    total = query.count()
    rows = query.offset(offset).limit(limit).all()

    return {
        "items": [serialize_schedule(schedule, node) for schedule, node in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "as_of": due_at,
    }


def record_review(db: Session, node: SkillNode, score: float, reviewed_at: datetime) -> ReviewSchedule:
    schedule = get_or_create_schedule(db, node, now=reviewed_at)
    apply_review_result(schedule, score, reviewed_at)
    db.commit()
    db.refresh(schedule)
    return schedule


def build_review_curve(schedule: ReviewSchedule, node: SkillNode, days: int, now: datetime | None = None) -> dict:
    start = schedule.last_reviewed_at or now or utcnow()
    strength = max(schedule.interval_days or 1, 1)
    points = []

    for day in range(days + 1):
        retention = math.exp(-day / strength) * 100
        points.append(
            {
                "day": day,
                "date": (start + timedelta(days=day)).date().isoformat(),
                "retention": round(retention, 2),
            }
        )

    return {
        "node_id": node.id,
        "interval_days": schedule.interval_days,
        "last_reviewed_at": schedule.last_reviewed_at,
        "next_review_at": schedule.next_review_at,
        "points": points,
    }
