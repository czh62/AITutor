"""StreamBus — NDJSON 流式事件总线。

参考 DeepTutor 的 StreamBus（fan-out 广播），大幅简化为单消费者版本：
- 用 asyncio.Queue 串联「生产者（loop/tools/think_filter）」与「消费者（HTTP response stream）」
- emit() 把事件序列化为 NDJSON 行后入队；finish() 发 done 事件 + None 哨兵结束迭代
- stream_lines() 是 async generator，供 StreamingResponse 直接消费

这种设计让 loop 内部的各组件（_run_loop、dispatch_tool_calls、InlineThinkFilter）
都能通过 bus 发射事件，而无需层层 yield，符合 DeepTutor 的「bus fan-out」解耦意图。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from .stream import StreamEventType, make_event


class StreamBus:
    """NDJSON 流式事件总线（单消费者）。"""

    def __init__(self) -> None:
        # NDJSON 行 + None 哨兵（标记流结束）
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._finished: bool = False

    async def emit(
        self,
        event_type: StreamEventType,
        *,
        round: int = 0,
        content: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """发射一个事件（序列化为 NDJSON 行入队）。

        已 finish 后的 emit 静默丢弃（防止 loop 异常路径在 done 之后继续发事件）。
        """
        if self._finished:
            return
        line = make_event(
            event_type, round=round, content=content, metadata=metadata
        ).to_ndjson()
        await self._queue.put(line)

    async def emit_error(self, message: str, *, round: int = 0) -> None:
        """便捷方法：发射 error 事件。"""
        await self.emit(StreamEventType.ERROR, round=round, content=message)

    async def finish(
        self,
        *,
        result_metadata: dict[str, Any] | None = None,
    ) -> None:
        """发射 result + done 事件并结束流。

        result_metadata 为 None 时跳过 result 事件（如 ask_user 暂停路径）。
        """
        if self._finished:
            return
        self._finished = True
        if result_metadata is not None:
            await self._queue.put(
                make_event(
                    StreamEventType.RESULT, metadata=result_metadata
                ).to_ndjson()
            )
        await self._queue.put(make_event(StreamEventType.DONE).to_ndjson())
        await self._queue.put(None)  # 哨兵：结束 stream_lines 迭代

    async def stream_lines(self) -> AsyncIterator[str]:
        """消费 NDJSON 行，直到 finish() 的 None 哨兵。供 StreamingResponse 使用。"""
        while True:
            line = await self._queue.get()
            if line is None:
                break
            yield line


__all__ = ["StreamBus"]
