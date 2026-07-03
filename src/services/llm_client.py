"""LLM 客户端 — OpenAI SDK 调用 LLM。

用于 AgentLoop 的查询评估、改写和综合回答。
配置从 .env 读取（LLM_BINDING / LLM_BINDING_HOST / LLM_BINDING_API_KEY / LLM_MODEL）。
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

from openai import AsyncOpenAI

from ..core.config import get_settings

logger = logging.getLogger("aitutor.llm_client")


class LLMClient:
    """OpenAI SDK 异步 LLM 客户端。"""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float = 120.0,
    ):
        settings = get_settings()
        self._base_url = base_url or settings.llm_binding_host
        self._api_key = api_key or settings.llm_binding_api_key
        self._model = model or settings.llm_model
        self._timeout = timeout
        self._client: AsyncOpenAI | None = None

    def _get_client(self) -> AsyncOpenAI:
        """懒创建 AsyncOpenAI 客户端。"""
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self._api_key,
                base_url=self._base_url,
                timeout=self._timeout,
            )
        return self._client

    async def close(self) -> None:
        """关闭 OpenAI 客户端。在 app lifespan shutdown 时调用。"""
        if self._client is not None:
            await self._client.close()
            self._client = None
            logger.info("LLM client closed")

    # ------------------------------------------------------------------
    #  非流式调用
    # ------------------------------------------------------------------

    async def call(
        self,
        system_prompt: str,
        user_prompt: str,
        response_format: dict[str, str] | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> str:
        """非流式 LLM 调用，返回完整文本。"""
        kwargs: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            response = await self._get_client().chat.completions.create(**kwargs)
            content = response.choices[0].message.content or ""
            logger.debug("LLM call: model=%s, chars=%d", self._model, len(content))
            return content
        except Exception as exc:
            logger.error("LLM call failed: %s", exc)
            raise

    # ------------------------------------------------------------------
    #  流式调用
    # ------------------------------------------------------------------

    async def stream(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ):
        """流式 LLM 调用，逐 chunk yield 文本。

        返回 async generator，消费者应使用 ``async for chunk in llm.stream(...)``
        而不是 ``await llm.stream(...)``。
        """
        response_stream = await self._get_client().chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )

        async for chunk in response_stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content
