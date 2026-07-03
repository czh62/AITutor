"""InlineThinkFilter — 流式 <thinking>/<think> 标签分离器。

完全复刻 DeepTutor 的 InlineThinkFilter：在 LLM 流式输出过程中，把
`<think>`/`<thinking>` 标签内的内容归为 "thinking"，标签外归为 "content"。

设计要点：
- 维护 _in_think 状态机（标签内/外）
- holdback 缓冲：尾部最多保留 _TAG_HOLDBACK_CHARS 字符，防止标签被流式分片截断
- feed(chunk) 返回 [(kind, text), ...]，kind ∈ {"content", "thinking"}
- flush() 在流结束时冲刷缓冲
"""

from __future__ import annotations

import re

# 开标签：<think> 或 <thinking>（容忍空白与属性）
_THINK_OPEN_RE = re.compile(r"<\s*think(?:ing)?\b[^>]*>", re.IGNORECASE)
# 闭标签：</think> 或 </thinking>
_THINK_CLOSE_RE = re.compile(r"<\s*/\s*think(?:ing)\s*>", re.IGNORECASE)

_TAG_HOLDBACK_CHARS = 24  # 尾部 holdback 上限，足以容纳最长标签 "</thinking>"


class InlineThinkFilter:
    """流式 <thinking>/<think> 标签分离器。

    用法：
        flt = InlineThinkFilter()
        for chunk in stream:
            for kind, text in flt.feed(chunk):
                # kind == "thinking" → 发 thinking 事件
                # kind == "content" → 发 content 事件
                ...
        for kind, text in flt.flush():
            ...
    """

    def __init__(self) -> None:
        self._in_think: bool = False
        self._buffer: str = ""

    def feed(self, chunk: str) -> list[tuple[str, str]]:
        """处理一个流式分片，返回 [(kind, text), ...]。"""
        if not chunk:
            return []
        self._buffer += chunk
        return self._drain(holdback=True)

    def flush(self) -> list[tuple[str, str]]:
        """流结束冲刷，返回剩余 [(kind, text), ...]。"""
        if not self._buffer:
            return []
        return self._drain(holdback=False)

    def _drain(self, *, holdback: bool) -> list[tuple[str, str]]:
        """从 _buffer 解析并产出 (kind, text) 对。

        holdback=True 时尾部保留 _TAG_HOLDBACK_CHARS 字符不输出（防标签截断）；
        holdback=False（flush）全部输出。
        """
        out: list[tuple[str, str]] = []
        buf = self._buffer
        pos = 0

        while pos < len(buf):
            if self._in_think:
                m = _THINK_CLOSE_RE.search(buf, pos)
                if m:
                    # 闭标签前的内容归 thinking
                    if m.start() > pos:
                        out.append(("thinking", buf[pos : m.start()]))
                    self._in_think = False
                    pos = m.end()
                else:
                    # 未找到闭标签：剩余部分（保留 holdback）归 thinking
                    safe_end = len(buf) - (_TAG_HOLDBACK_CHARS if holdback else 0)
                    if safe_end > pos:
                        out.append(("thinking", buf[pos:safe_end]))
                        pos = safe_end
                    break  # 留在 buffer 等更多输入或 flush
            else:
                m = _THINK_OPEN_RE.search(buf, pos)
                if m:
                    # 开标签前的内容归 content
                    if m.start() > pos:
                        out.append(("content", buf[pos : m.start()]))
                    self._in_think = True
                    pos = m.end()
                else:
                    # 未找到开标签：剩余部分（保留 holdback）归 content
                    safe_end = len(buf) - (_TAG_HOLDBACK_CHARS if holdback else 0)
                    if safe_end > pos:
                        out.append(("content", buf[pos:safe_end]))
                        pos = safe_end
                    break

        self._buffer = buf[pos:]
        return out

    @property
    def in_think(self) -> bool:
        return self._in_think


__all__ = ["InlineThinkFilter"]
