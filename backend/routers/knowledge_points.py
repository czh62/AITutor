from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..services import knowledge_points_service


router = APIRouter(prefix="/api/knowledge-points", tags=["knowledge-points"])

KnowledgePointStatus = Literal["locked", "available", "learning", "completed"]


class StatusUpdateRequest(BaseModel):
    status: KnowledgePointStatus


def get_knowledge_point_or_404(db: Session, node_id: str):
    node = knowledge_points_service.get_knowledge_point(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Knowledge point not found")
    return node


@router.get("")
async def list_knowledge_points(
    doc_id: str | None = None,
    status: KnowledgePointStatus | None = None,
    level: int | None = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    return knowledge_points_service.list_knowledge_points(
        db,
        doc_id=doc_id,
        status=status,
        level=level,
        limit=limit,
        offset=offset,
    )


@router.get("/{node_id}")
async def get_knowledge_point(node_id: str, db: Session = Depends(get_db)):
    node = get_knowledge_point_or_404(db, node_id)
    return knowledge_points_service.get_knowledge_point_detail(db, node)


@router.patch("/{node_id}/status")
async def update_knowledge_point_status(
    node_id: str,
    request: StatusUpdateRequest,
    db: Session = Depends(get_db),
):
    node = get_knowledge_point_or_404(db, node_id)
    return knowledge_points_service.update_knowledge_point_status(db, node, request.status)


@router.get("/{node_id}/summary")
async def get_knowledge_point_summary(node_id: str, db: Session = Depends(get_db)):
    node = get_knowledge_point_or_404(db, node_id)
    return knowledge_points_service.build_knowledge_point_summary(node)
