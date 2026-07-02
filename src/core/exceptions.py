"""统一异常体系。

所有业务异常继承 AppException，由 main.py 注册的全局 handler 统一转换为
稳定 JSON 响应。避免在各 endpoint 里重复写 try/except + HTTPException，
也避免把内部错误信息泄露给客户端（对齐旧 backend/qa.py 的做法）。
"""

from __future__ import annotations

from typing import Optional


class AppException(Exception):
    """业务异常基类。

    Attributes:
        status_code: HTTP 状态码。
        detail: 返回给客户端的稳定错误描述。
        code: 机器可读错误码，便于前端区分。
    """

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, detail: str, *, code: Optional[str] = None, status_code: Optional[int] = None):
        self.detail = detail
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        super().__init__(detail)


class NotFoundError(AppException):
    status_code = 404
    code = "not_found"

    def __init__(self, detail: str = "Resource not found", *, code: Optional[str] = None):
        super().__init__(detail, code=code)


class ValidationError(AppException):
    status_code = 400
    code = "validation_error"


class ServiceUnavailableError(AppException):
    """对应旧 backend 的 stable_qa_error() 语义：下游服务不可用。"""

    status_code = 502
    code = "service_unavailable"

    def __init__(self, detail: str = "Service unavailable", *, code: Optional[str] = None):
        super().__init__(detail, code=code)


class ConflictError(AppException):
    status_code = 409
    code = "conflict"
