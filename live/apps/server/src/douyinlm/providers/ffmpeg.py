from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

from douyinlm.providers.base import DerivedMedia, MediaProbe
from douyinlm.providers.errors import InvalidMedia, PipelineError, ProviderNotConfigured
from douyinlm.settings import Settings

_ALLOWED_FORMATS = {
    "matroska",
    "mov",
    "mp4",
    "webm",
}


class FFmpegAdapter:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def configured(self) -> bool:
        return (
            self._settings.resolved_ffmpeg_path is not None
            and self._settings.resolved_ffprobe_path is not None
        )

    def probe(self, source: Path) -> MediaProbe:
        ffprobe = self._settings.resolved_ffprobe_path
        if ffprobe is None:
            raise ProviderNotConfigured(
                "ffmpeg_not_configured",
                "FFmpeg 尚未安装，请运行 scripts\\install-ffmpeg.cmd。",
            )
        result = self._run(
            [
                str(ffprobe),
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(source),
            ],
            timeout=90,
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise InvalidMedia("ffprobe 无法读取视频容器信息。") from exc

        streams = payload.get("streams", [])
        video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
        if video_stream is None:
            raise InvalidMedia("文件不包含可解码的视频轨道。")

        format_name = str(payload.get("format", {}).get("format_name", ""))
        detected = set(format_name.lower().split(","))
        if not detected.intersection(_ALLOWED_FORMATS):
            raise InvalidMedia(f"不支持的视频容器：{format_name or '未知'}。")

        try:
            duration_ms = max(0, round(float(payload["format"].get("duration", 0)) * 1000))
            width = int(video_stream.get("width", 0))
            height = int(video_stream.get("height", 0))
        except (TypeError, ValueError, KeyError) as exc:
            raise InvalidMedia("视频时长或分辨率信息无效。") from exc
        if duration_ms <= 0 or width <= 0 or height <= 0:
            raise InvalidMedia("视频时长或分辨率必须大于 0。")

        return MediaProbe(
            format_name=format_name,
            duration_ms=duration_ms,
            width=width,
            height=height,
            has_audio=any(item.get("codec_type") == "audio" for item in streams),
            raw=payload,
        )

    def derive(self, source: Path, source_hash: str) -> DerivedMedia:
        ffmpeg = self._settings.resolved_ffmpeg_path
        if ffmpeg is None:
            raise ProviderNotConfigured(
                "ffmpeg_not_configured",
                "FFmpeg 尚未安装，请运行 scripts\\install-ffmpeg.cmd。",
            )
        probe = self.probe(source)
        proxy_dir = self._settings.resolved_data_dir / "proxies" / source_hash
        audio_dir = self._settings.resolved_data_dir / "audio" / source_hash
        frame_dir = self._settings.resolved_data_dir / "keyframes" / source_hash
        for directory in (proxy_dir, audio_dir, frame_dir):
            directory.mkdir(parents=True, exist_ok=True)

        proxy_path = proxy_dir / "proxy.mp4"
        if not proxy_path.is_file() or proxy_path.stat().st_size == 0:
            command = [
                str(ffmpeg),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                "-vf",
                "scale=w='min(1280,iw)':h=-2:force_original_aspect_ratio=decrease",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "27",
            ]
            if probe.has_audio:
                command.extend(["-c:a", "aac", "-b:a", "96k"])
            else:
                command.append("-an")
            command.extend(["-movflags", "+faststart", str(proxy_path)])
            self._run(command, timeout=900)

        audio_path: Path | None = None
        if probe.has_audio:
            audio_path = audio_dir / "audio.mp3"
            if not audio_path.is_file() or audio_path.stat().st_size == 0:
                self._run(
                    [
                        str(ffmpeg),
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(source),
                        "-vn",
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        "-c:a",
                        "libmp3lame",
                        "-b:a",
                        "48k",
                        str(audio_path),
                    ],
                    timeout=600,
                )

        keyframes = sorted(frame_dir.glob("frame-*.jpg"))
        if not keyframes:
            interval_seconds = max(
                3.0,
                probe.duration_ms / 1000 / max(1, self._settings.max_keyframes),
            )
            self._run(
                [
                    str(ffmpeg),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(source),
                    "-vf",
                    (
                        f"fps=1/{interval_seconds:.3f}:start_time=0,"
                        "scale=w='min(960,iw)':h=-2,format=yuvj420p"
                    ),
                    "-q:v",
                    "3",
                    "-frames:v",
                    str(self._settings.max_keyframes),
                    str(frame_dir / "frame-%03d.jpg"),
                ],
                timeout=600,
            )
            keyframes = sorted(frame_dir.glob("frame-*.jpg"))
        if not keyframes:
            self._run(
                [
                    str(ffmpeg),
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    "0",
                    "-i",
                    str(source),
                    "-vf",
                    "scale=w='min(960,iw)':h=-2,format=yuvj420p",
                    "-frames:v",
                    "1",
                    str(frame_dir / "frame-001.jpg"),
                ],
                timeout=120,
            )
            keyframes = sorted(frame_dir.glob("frame-*.jpg"))
        if not keyframes:
            raise InvalidMedia("视频无法提取任何关键帧。")

        return DerivedMedia(
            probe=probe,
            proxy_path=proxy_path,
            audio_path=audio_path,
            keyframe_paths=keyframes[: self._settings.max_keyframes],
        )

    @staticmethod
    def file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _run(command: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            return subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                creationflags=creation_flags,
            )
        except subprocess.TimeoutExpired as exc:
            raise PipelineError(
                "ffmpeg_timeout",
                "视频处理超时，请检查文件是否损坏。",
                retryable=True,
            ) from exc
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "unknown error").strip()[-800:]
            raise InvalidMedia(f"FFmpeg 处理失败：{detail}") from exc
