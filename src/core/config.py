"""统一配置管理。

用 pydantic-settings 从 .env 读取，带默认值。集中管理原本散落在各模块的
硬编码配置（数据库路径、LightRAG URL 等）。所有模块通过 get_settings() 获取。
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置。优先级：环境变量 > .env 文件 > 默认值。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 应用
    app_name: str = "AI Tutor API"
    app_version: str = "2.0.0"
    debug: bool = False
    cors_origins: List[str] = Field(default_factory=lambda: ["*"])

    # 数据库
    database_url: str = "sqlite:///./data/aitutor.db"

    # LightRAG（骨架阶段不真实调用，仅占位）
    lightrag_base_url: str = "http://localhost:9621"
    lightrag_timeout: float = 300.0


@lru_cache
def get_settings() -> Settings:
    """返回单例配置。"""
    return Settings()
