from __future__ import annotations

from pathlib import Path


def extract_document_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        return _read_text(path)
    if suffix == ".pdf":
        return _read_pdf(path)
    if suffix == ".docx":
        return _read_docx(path)
    raise ValueError("unsupported_file_type")


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8", errors="replace")


def _read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("缺少 PDF 解析依赖 pypdf，请安装后重试") from exc

    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()


def _read_docx(path: Path) -> str:
    try:
        from docx import Document
    except ImportError as exc:
        raise RuntimeError("缺少 DOCX 解析依赖 python-docx，请安装后重试") from exc

    document = Document(str(path))
    return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()
