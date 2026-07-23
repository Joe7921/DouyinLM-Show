from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from douyinlm.domain.schemas import TaxonomyDraft, VideoUnderstandingDraft


@dataclass(frozen=True)
class MediaProbe:
    format_name: str
    duration_ms: int
    width: int
    height: int
    has_audio: bool
    raw: dict[str, Any] = field(repr=False)


@dataclass(frozen=True)
class DerivedMedia:
    probe: MediaProbe
    proxy_path: Path
    audio_path: Path | None
    keyframe_paths: list[Path]


@dataclass(frozen=True)
class TranscriptUtterance:
    text: str
    start_ms: int
    end_ms: int
    confidence: float | None = None


@dataclass(frozen=True)
class TranscriptResult:
    text: str
    utterances: list[TranscriptUtterance]
    request_hash: str
    response_hash: str
    response_id: str | None
    duration_ms: int


@dataclass(frozen=True)
class UnderstandingResult:
    draft: VideoUnderstandingDraft
    request_hash: str
    response_hash: str
    response_id: str | None
    duration_ms: int


@dataclass(frozen=True)
class TaxonomyResult:
    draft: TaxonomyDraft
    request_hash: str
    response_hash: str
    response_id: str | None
    duration_ms: int
