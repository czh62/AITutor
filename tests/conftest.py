from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

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

if "openai" not in sys.modules:
    openai = types.ModuleType("openai")

    class AsyncOpenAI:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def close(self):
            return None

    openai.AsyncOpenAI = AsyncOpenAI
    sys.modules["openai"] = openai
