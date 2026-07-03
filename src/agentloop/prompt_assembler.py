"""ChatPromptAssembler — 块式系统提示词组装器。

参考 DeepTutor 的 ChatPromptAssembler：把命名块按固定顺序拼接成系统提示词，
每块以 ``## {block_name}`` 标题引导、块间用 ``---`` 分隔，空块跳过。

块顺序（对齐 DeepTutor 但精简）：general → runtime_policy → loop →
（force_web_search 可选）→ memory（可选）→ language。

system prompt 在整个 loop 期间保持字节稳定（所有轮次共享同一前缀），符合
DeepTutor 的「volatile 内容放进 user message 而非 system block」原则。
"""

from __future__ import annotations

from .prompts import (
    FORCE_WEB_SEARCH_BLOCK,
    GENERAL_BLOCK,
    LANGUAGE_BLOCK,
    LOOP_BLOCK,
    MEMORY_BLOCK_TEMPLATE,
    RUNTIME_POLICY_BLOCK_TEMPLATE,
)


class ChatPromptAssembler:
    """从命名块组装系统提示词。"""

    @staticmethod
    def assemble(
        *,
        max_rounds: int = 6,
        memory_context: str = "",
        force_web_search: bool = False,
    ) -> str:
        """组装系统提示词。

        Args:
            max_rounds: 最大轮次，注入 runtime_policy 块。
            memory_context: L2 记忆摘要文本（非空则注入 memory 块）。
            force_web_search: 用户强制搜索时注入 force_web_search 块。
        """
        blocks: list[tuple[str, str]] = [("general", GENERAL_BLOCK)]

        blocks.append(
            ("runtime_policy", RUNTIME_POLICY_BLOCK_TEMPLATE.format(max_rounds=max_rounds))
        )
        blocks.append(("loop", LOOP_BLOCK))

        if force_web_search:
            blocks.append(("force_web_search", FORCE_WEB_SEARCH_BLOCK))

        if memory_context.strip():
            blocks.append(
                ("memory", MEMORY_BLOCK_TEMPLATE.format(memory_context=memory_context.strip()))
            )

        blocks.append(("language", LANGUAGE_BLOCK))

        # 拼接：每块前加 ## 标题，块间用 --- 分隔
        parts: list[str] = []
        for name, content in blocks:
            parts.append(f"## {name}\n{content}")
        return "\n\n---\n\n".join(parts)


__all__ = ["ChatPromptAssembler"]
