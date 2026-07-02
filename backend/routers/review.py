from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..services import review_schedule_service


router = APIRouter(prefix="/api/review", tags=["review"])


class ReviewRecordRequest(BaseModel):
    score: float = Field(..., ge=0, le=100)
    reviewed_at: datetime | None = None


def get_node_or_404(db: Session, node_id: str):
    node = review_schedule_service.get_node(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    return node


def get_schedule_or_404(db: Session, node_id: str):
    schedule = review_schedule_service.get_schedule(db, node_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Review schedule not found")
    return schedule


@router.get("/due")
async def get_due_reviews(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    as_of: datetime | None = None,
    db: Session = Depends(get_db),
):
    return review_schedule_service.get_due_reviews(db, limit=limit, offset=offset, as_of=as_of)


@router.post("/{node_id}/init")
async def init_review_schedule(node_id: str, db: Session = Depends(get_db)):
    node = get_node_or_404(db, node_id)
    schedule = review_schedule_service.get_or_create_schedule(db, node)
    return review_schedule_service.serialize_schedule(schedule, node)


@router.post("/{node_id}/record")
async def record_review(node_id: str, request: ReviewRecordRequest, db: Session = Depends(get_db)):
    node = get_node_or_404(db, node_id)
    reviewed_at = request.reviewed_at or review_schedule_service.utcnow()
    schedule = review_schedule_service.record_review(db, node, request.score, reviewed_at)

    return review_schedule_service.serialize_schedule(schedule, node)


@router.get("/{node_id}")
async def get_review_schedule(node_id: str, db: Session = Depends(get_db)):
    node = get_node_or_404(db, node_id)
    schedule = get_schedule_or_404(db, node_id)
    return review_schedule_service.serialize_schedule(schedule, node)


@router.get("/{node_id}/curve")
async def get_review_curve(
    node_id: str,
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
):
    node = get_node_or_404(db, node_id)
    schedule = get_schedule_or_404(db, node_id)
    return review_schedule_service.build_review_curve(schedule, node, days)
