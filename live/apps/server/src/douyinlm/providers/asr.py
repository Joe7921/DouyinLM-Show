from __future__ import annotations

import base64
import hashlib
import json
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from douyinlm.providers.base import TranscriptResult, TranscriptUtterance
from douyinlm.providers.errors import PipelineError, ProviderNotConfigured
from douyinlm.settings import Settings

_ASR_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"


class DoubaoASRAdapter:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    @property
    def configured(self) -> bool:
        return self._settings.asr_configured

    def recognize(self, audio_path: Path) -> TranscriptResult:
        api_key_secret = self._settings.resolved_asr_api_key
        app_id_secret = self._settings.resolved_asr_app_id
        access_token_secret = self._settings.resolved_asr_access_token
        if api_key_secret is None and (
            app_id_secret is None or access_token_secret is None
        ):
            raise ProviderNotConfigured(
                "asr_not_configured",
                "豆包语音需要新版 API Key，或旧版 APP ID 与 Access Token。",
            )
        audio_bytes = audio_path.read_bytes()
        audio_hash = hashlib.sha256(audio_bytes).hexdigest()
        request_id = str(uuid4())
        headers = {
            "X-Api-Resource-Id": self._settings.volc_asr_resource_id,
            "X-Api-Request-Id": request_id,
            "X-Api-Sequence": "-1",
        }
        if api_key_secret is not None:
            headers["X-Api-Key"] = api_key_secret.get_secret_value()
        else:
            assert app_id_secret is not None
            assert access_token_secret is not None
            headers["X-Api-App-Key"] = app_id_secret.get_secret_value()
            headers["X-Api-Access-Key"] = access_token_secret.get_secret_value()
        payload = {
            "user": {"uid": "douyinlm-local"},
            "audio": {"data": base64.b64encode(audio_bytes).decode("ascii")},
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_ddc": True,
            },
        }
        request_hash = _stable_hash(
            {
                "audio_hash": audio_hash,
                "resource_id": self._settings.volc_asr_resource_id,
                "request": payload["request"],
            }
        )
        started = time.perf_counter()
        try:
            with httpx.Client(
                timeout=self._settings.provider_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = client.post(_ASR_URL, json=payload, headers=headers)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise PipelineError(
                "asr_network_error",
                "豆包语音暂时无法连接。",
                retryable=True,
            ) from exc
        duration_ms = round((time.perf_counter() - started) * 1000)
        status_code = response.headers.get("X-Api-Status-Code")
        if response.status_code >= 500 or status_code == "55000031":
            raise PipelineError(
                "asr_busy",
                "豆包语音服务繁忙。",
                retryable=True,
            )
        if response.status_code >= 400 or status_code != "20000000":
            message = response.headers.get("X-Api-Message", "请求未通过")
            raise PipelineError(
                "asr_rejected",
                f"豆包语音识别失败：{message}",
                retryable=False,
            )
        try:
            body: dict[str, Any] = response.json()
            result = body.get("result", {})
            utterances = [
                TranscriptUtterance(
                    text=str(item.get("text", "")).strip(),
                    start_ms=max(0, int(item.get("start_time", 0))),
                    end_ms=max(0, int(item.get("end_time", 0))),
                    confidence=_mean_word_confidence(item.get("words", [])),
                )
                for item in result.get("utterances", [])
                if str(item.get("text", "")).strip()
            ]
            text = str(result.get("text", "")).strip()
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise PipelineError(
                "asr_invalid_response",
                "豆包语音返回了无法校验的结果。",
                retryable=False,
            ) from exc
        return TranscriptResult(
            text=text,
            utterances=utterances,
            request_hash=request_hash,
            response_hash=_stable_hash(body),
            response_id=response.headers.get("X-Tt-Logid") or request_id,
            duration_ms=duration_ms,
        )


def _mean_word_confidence(words: list[dict[str, Any]]) -> float | None:
    values = [float(word["confidence"]) for word in words if word.get("confidence") is not None]
    if not values:
        return None
    return max(0.0, min(1.0, sum(values) / len(values)))


def _stable_hash(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
