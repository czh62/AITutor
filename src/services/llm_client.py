"""LLM 客户端 — OpenAI SDK 调用 LLM。

用于 AgentLoop 的查询评估、改写和综合回答。配置从 .env 读取
（LLM_BINDING / LLM_BINDING_HOST / LLM_BINDING_API_KEY / LLM_MODEL）。

支持两种调用形态：
- call() / stream()：旧版纯文本调用（保留，向后兼容）
- call_with_tools() / stream_with_tools()：OpenAI function-calling 格式（tool-calling loop 用）
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from ..core.config import get_settings

logger = logging.getLogger("aitutor.llm_client")


@dataclass
class LLMToolCall:
    """LLM 发出的工具调用（OpenAI tool_call 归一化）。"""

    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMResponse:
    """call_with_tools 的返回。content 与 tool_calls 可能其一为空。"""

    content: str = ""
    tool_calls: list[LLMToolCall] = field(default_factory=list)
    finish_reason: str = "stop"  # "stop" | "tool_calls" | "length" | ...


@dataclass
class LLMStreamChunk:
    """stream_with_tools 的单块。

    type: "content"（正文增量）/ "reasoning"（推理增量）/ "tool_call_delta"（工具调用增量）
    """

    type: str
    content: str = ""
    tool_call_delta: dict[str, Any] | None = None  # {index, id?, name?, arguments_delta?}


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

    # ------------------------------------------------------------------
    #  Tool-calling 调用（OpenAI function-calling 格式）
    # ------------------------------------------------------------------

    async def call_with_tools(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """非流式 tool-calling 调用。

        messages 是完整对话历史（含 system/user/assistant/tool），system_prompt 用于
        兜底（当 messages 未含 system 时前置）。tools 为 OpenAI tool schemas，None 表示
        强制纯文本回答（用于 forced_finish）。
        """
        full_messages = self._ensure_system(system_prompt, messages)
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": full_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        try:
            response = await self._get_client().chat.completions.create(**kwargs)
            choice = response.choices[0]
            msg = choice.message
            content = msg.content or ""
            tool_calls: list[LLMToolCall] = []
            if getattr(msg, "tool_calls", None):
                for tc in msg.tool_calls:
                    tool_calls.append(
                        LLMToolCall(
                            id=tc.id,
                            name=tc.function.name,
                            arguments=_parse_tool_args(tc.function.arguments),
                        )
                    )
            logger.debug(
                "LLM call_with_tools: model=%s, content_chars=%d, tool_calls=%d",
                self._model,
                len(content),
                len(tool_calls),
            )
            return LLMResponse(
                content=content,
                tool_calls=tool_calls,
                finish_reason=choice.finish_reason or "stop",
            )
        except Exception as exc:
            logger.error("LLM call_with_tools failed: %s", exc)
            raise

    async def stream_with_tools(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncIterator[LLMStreamChunk]:
        """流式 tool-calling 调用。

        yield LLMStreamChunk：content/reasoning 增量即时可用；tool_call_delta 按 index
        聚合，消费者需自行累积 index→{id,name,arguments} 映射（在 loop.py 中处理）。
        """
        full_messages = self._ensure_system(system_prompt, messages)
        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": full_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response_stream = await self._get_client().chat.completions.create(**kwargs)
        async for chunk in response_stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            # 推理内容（reasoning_content / reasoning，部分模型如 DeepSeek/Qwen 支持）
            reasoning = getattr(delta, "reasoning_content", None) or getattr(
                delta, "reasoning", None
            )
            if reasoning:
                yield LLMStreamChunk(type="reasoning", content=reasoning)
            # 正文内容
            if delta.content:
                yield LLMStreamChunk(type="content", content=delta.content)
            # 工具调用增量
            if getattr(delta, "tool_calls", None):
                for tc in delta.tool_calls:
                    delta_dict: dict[str, Any] = {"index": tc.index}
                    if tc.id:
                        delta_dict["id"] = tc.id
                    fn = getattr(tc, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            delta_dict["name"] = fn.name
                        if getattr(fn, "arguments", None):
                            delta_dict["arguments_delta"] = fn.arguments
                    yield LLMStreamChunk(type="tool_call_delta", tool_call_delta=delta_dict)

    @staticmethod
    def _ensure_system(
        system_prompt: str, messages: list[dict]
    ) -> list[dict]:
        """确保 messages 首条是 system（恢复场景 messages 已含 system 则原样返回）。"""
        if messages and messages[0].get("role") == "system":
            return messages
        return [{"role": "system", "content": system_prompt}, *messages]


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    """把 tool_call.function.arguments（str | dict）解析为 dict，失败返回空 dict。"""
    import json

    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
