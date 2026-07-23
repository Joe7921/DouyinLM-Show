from __future__ import annotations


class PipelineError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class ApiRequestError(PipelineError):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(code, message, retryable=retryable)
        self.status_code = status_code


class ProviderNotConfigured(PipelineError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, retryable=False)


class InvalidMedia(PipelineError):
    def __init__(self, message: str) -> None:
        super().__init__("invalid_media", message, retryable=False)
