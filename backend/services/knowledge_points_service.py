import json
from typing import Dict, List

from sqlalchemy.orm import Session

from ..models.database import SkillNode


def parse_parent_ids(value) -> List[str]:
    if value is None:
        return []

    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []

        try:
            parsed = json.loads(stripped)
        except (TypeError, json.JSONDecodeError):
            parsed = None

        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]

        if "," in stripped:
            return [item.strip() for item in stripped.split(",") if item.strip()]

        return [stripped]

    return []


def get_node_parent_ids(node: SkillNode) -> List[str]:
    for field_name in ("parent_ids", "prerequisite_ids", "prerequisites", "dependencies"):
        if hasattr(node, field_name):
            parent_ids = parse_parent_ids(getattr(node, field_name))
            if parent_ids:
                return parent_ids

    if hasattr(node, "parent_id"):
        parent_id = getattr(node, "parent_id")
        if parent_id is not None:
            return [str(parent_id)]

    return []


def get_node_title(node: SkillNode) -> str:
    return getattr(node, "title", None) or getattr(node, "name", None) or ""


def get_node_description(node: SkillNode) -> str:
    return getattr(node, "description", None) or ""


def calculate_node_level(
    node: SkillNode,
    nodes_by_id: Dict[str, SkillNode],
    seen: set | None = None,
) -> int:
    if hasattr(node, "level"):
        level = getattr(node, "level")
        if level is not None:
            return level

    seen = seen or set()
    node_id = str(node.id)
    if node_id in seen:
        return 1

    parent_levels = []
    for parent_id in get_node_parent_ids(node):
        parent = nodes_by_id.get(str(parent_id))
        if parent:
            parent_levels.append(calculate_node_level(parent, nodes_by_id, seen | {node_id}))

    if not parent_levels:
        return 1

    return max(parent_levels) + 1


def serialize_node_basic(node: SkillNode, nodes_by_id: Dict[str, SkillNode]):
    return {
        "id": node.id,
        "title": get_node_title(node),
        "description": get_node_description(node),
        "status": node.status,
        "mastery": node.mastery,
        "level": calculate_node_level(node, nodes_by_id),
        "doc_id": node.doc_id,
    }


def serialize_node_ref(node: SkillNode):
    return {
        "id": node.id,
        "title": get_node_title(node),
    }


def serialize_node_detail(node: SkillNode, all_nodes: List[SkillNode]):
    nodes_by_id = {str(item.id): item for item in all_nodes}
    parent_ids = set(get_node_parent_ids(node))

    prerequisites = [
        serialize_node_ref(parent)
        for parent_id, parent in nodes_by_id.items()
        if parent_id in parent_ids
    ]
    dependents = [
        serialize_node_ref(candidate)
        for candidate in all_nodes
        if str(node.id) in set(get_node_parent_ids(candidate))
    ]

    detail = serialize_node_basic(node, nodes_by_id)
    detail["prerequisites"] = prerequisites
    detail["dependents"] = dependents
    return detail


def get_knowledge_point(db: Session, node_id: str) -> SkillNode | None:
    return db.query(SkillNode).filter(SkillNode.id == node_id).first()


def list_knowledge_points(
    db: Session,
    doc_id: str | None = None,
    status: str | None = None,
    level: int | None = None,
    limit: int = 100,
    offset: int = 0,
):
    query = db.query(SkillNode)
    if doc_id is not None:
        query = query.filter(SkillNode.doc_id == doc_id)
    if status is not None:
        query = query.filter(SkillNode.status == status)

    all_nodes = db.query(SkillNode).all()
    nodes_by_id = {str(node.id): node for node in all_nodes}
    filtered_nodes = query.all()

    if level is not None:
        filtered_nodes = [
            node
            for node in filtered_nodes
            if calculate_node_level(node, nodes_by_id) == level
        ]

    total = len(filtered_nodes)
    page_nodes = filtered_nodes[offset : offset + limit]

    return {
        "items": [serialize_node_basic(node, nodes_by_id) for node in page_nodes],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_knowledge_point_detail(db: Session, node: SkillNode):
    all_nodes = db.query(SkillNode).all()
    return serialize_node_detail(node, all_nodes)


def update_knowledge_point_status(db: Session, node: SkillNode, status: str):
    node.status = status
    db.commit()
    db.refresh(node)

    return {
        "id": node.id,
        "title": get_node_title(node),
        "status": node.status,
        "mastery": node.mastery,
    }


def build_knowledge_point_summary(node: SkillNode):
    return {
        "id": node.id,
        "title": get_node_title(node),
        "summary": get_node_description(node),
        "status": node.status,
        "mastery": node.mastery,
    }
