from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models.database import SkillNode, get_db


router = APIRouter(prefix="/api/qa", tags=["qa"])


class AskRequest(BaseModel):
    question: str
    doc_id: str | None = None


class AskNodeRequest(BaseModel):
    question: str


def normalize_question(question: str) -> str:
    normalized = question.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    return normalized


def get_node_title(node: SkillNode) -> str:
    return getattr(node, "title", None) or getattr(node, "name", None) or ""


def get_node_description(node: SkillNode) -> str:
    return getattr(node, "description", None) or ""


def build_general_prompt(question: str, doc_id: str | None = None) -> str:
    if doc_id:
        return f"Answer the question using knowledge from document {doc_id}: {question}"
    return f"Answer the knowledge question: {question}"


def build_node_prompt(node: SkillNode, question: str) -> str:
    title = get_node_title(node)
    description = get_node_description(node)
    return (
        f"The user is studying knowledge point: {title}\n"
        f"Knowledge point description: {description}\n"
        f"Answer the question based on this context: {question}"
    )


async def generate_answer(question: str, context: str, doc_id: str | None = None):
    return {
        "answer": f"Mock answer for: {question}",
        "sources": [],
        "fallback": False,
    }


def stable_qa_error() -> HTTPException:
    return HTTPException(status_code=502, detail="QA service unavailable")


@router.post("/ask")
async def ask(request: AskRequest):
    question = normalize_question(request.question)
    context = build_general_prompt(question, request.doc_id)

    try:
        result = await generate_answer(question=question, context=context, doc_id=request.doc_id)
    except Exception:
        raise stable_qa_error()

    return {
        "question": question,
        "answer": result.get("answer", ""),
        "doc_id": request.doc_id,
        "sources": result.get("sources", []),
        "fallback": result.get("fallback", False),
    }


@router.post("/ask-node/{node_id}")
async def ask_node(node_id: str, request: AskNodeRequest, db: Session = Depends(get_db)):
    question = normalize_question(request.question)
    node = db.query(SkillNode).filter(SkillNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Knowledge point not found")

    context = build_node_prompt(node, question)

    try:
        result = await generate_answer(question=question, context=context, doc_id=node.doc_id)
    except Exception:
        raise stable_qa_error()

    return {
        "node_id": node.id,
        "title": get_node_title(node),
        "question": question,
        "answer": result.get("answer", ""),
        "sources": result.get("sources", []),
        "fallback": result.get("fallback", False),
    }
