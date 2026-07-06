"""Shared prompt fragments for demo-facing LLM behavior."""

DEMO_RESPONSE_LANGUAGE_RULE = (
    "Respond in English unless quoting source content, user-provided text, or code output.\n"
    "If the source document is in Chinese, explain it in English and preserve original terms, "
    "code strings, and quoted examples when needed."
)


__all__ = ["DEMO_RESPONSE_LANGUAGE_RULE"]
