import sys
import types

import pytest

if "pydantic_settings" not in sys.modules:
    pydantic_settings = types.ModuleType("pydantic_settings")

    class BaseSettings:
        def __init__(self, **kwargs):
            for cls in reversed(type(self).mro()):
                for name in getattr(cls, "__annotations__", {}):
                    if not hasattr(type(self), name):
                        continue
                    value = getattr(type(self), name)
                    default_factory = getattr(value, "default_factory", None)
                    if default_factory is not None:
                        value = default_factory()
                    elif value.__class__.__name__ == "FieldInfo":
                        value = getattr(value, "default", None)
                    setattr(self, name, value)
            for name, value in kwargs.items():
                setattr(self, name, value)

    def SettingsConfigDict(**kwargs):
        return kwargs

    pydantic_settings.BaseSettings = BaseSettings
    pydantic_settings.SettingsConfigDict = SettingsConfigDict
    sys.modules["pydantic_settings"] = pydantic_settings

from src.api.documents import validate_mastery_upload_file
from src.core.exceptions import ValidationError
from src.schemas.documents import UploadResult


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        ("notes.txt", "text/plain"),
        ("lesson.md", "text/markdown"),
        ("paper.pdf", "application/pdf"),
        (
            "chapter.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
    ],
)
def test_validate_mastery_upload_file_accepts_supported_types(filename, content_type):
    validate_mastery_upload_file(filename, content_type)


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        (
            "slides.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        ("image.png", "image/png"),
        ("archive.zip", "application/zip"),
        ("no_extension", "text/plain"),
    ],
)
def test_validate_mastery_upload_file_rejects_unsupported_types(filename, content_type):
    with pytest.raises(ValidationError):
        validate_mastery_upload_file(filename, content_type)


def test_upload_result_preserves_track_id():
    result = UploadResult(status="success", message="ok", track_id="upload_abc")
    assert result.track_id == "upload_abc"
