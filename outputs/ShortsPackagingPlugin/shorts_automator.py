"""Scene packaging module. Callbacks run on worker threads; marshal to the UI."""
from __future__ import annotations

import json
import logging
import math
import os
import subprocess
import tempfile
import threading
import time
from concurrent.futures import Future
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Optional

from fcp_xml import frame_rate, write_xml

LOG = logging.getLogger(__name__)


class Cancelled(Exception):
    """Cooperative cancellation, distinct from processing failure."""


@dataclass(frozen=True)
class Progress:
    stage: str
    source: str
    completed: int = 0
    total: int = 0
    message: str = ""


@dataclass
class MovieResult:
    source: str
    status: str
    output_dir: str = ""
    clips: list[str] = field(default_factory=list)
    skipped: int = 0
    error: str = ""
    xml_path: str = ""
    settings: dict = field(default_factory=dict)
    scene_crops: list = field(default_factory=list)

    def __bool__(self):
        return self.status == "completed"


@dataclass(frozen=True)
class Job:
    future: Future
    cancel_event: threading.Event

    def cancel(self):
        """Request cancellation; future resolves to a cancelled result."""
        self.cancel_event.set()


class ShortsPackagingPlugin:
    """Independent jobs, fit/center layouts and H.264 with PCM/AAC.

    Construct with FFmpeg/ffprobe executable paths if they are not on PATH.
    Synchronous methods must run outside a GUI thread; start_* does that for you.
    """

    def __init__(self, threshold=27.0, min_duration=1.0, preset="fast", crf=22,
                 width=1080, height=1920, ffmpeg="ffmpeg", ffprobe="ffprobe",
                 process_timeout=7200, fps=24, media_format="mov",
                 layout="fit_blur", trim_bars=True):
        if not math.isfinite(threshold) or not 0 < threshold <= 255:
            raise ValueError("threshold must be in (0, 255]")
        if not math.isfinite(min_duration) or min_duration < 0:
            raise ValueError("min_duration must be finite and nonnegative")
        if preset not in {"ultrafast", "superfast", "veryfast", "faster", "fast",
                          "medium", "slow", "slower", "veryslow"}:
            raise ValueError("Invalid x264 preset")
        if not isinstance(crf, int) or not 0 <= crf <= 51:
            raise ValueError("crf must be an integer in [0, 51]")
        if (not isinstance(width, int) or not isinstance(height, int) or
                width <= 0 or height <= 0 or width % 2 or height % 2 or
                width * 16 != height * 9):
            raise ValueError("Output must have even dimensions and a 9:16 ratio")
        if not math.isfinite(process_timeout) or process_timeout <= 0:
            raise ValueError("process_timeout must be positive")
        if media_format not in {"mov", "mp4"} or layout not in {"fit_blur", "center"}:
            raise ValueError("Unsupported media_format or layout")
        self.media_format, self.layout, self.trim_bars = media_format, layout, bool(trim_bars)
        self.fps = frame_rate(fps)
        self.threshold, self.min_duration = threshold, min_duration
        self.preset, self.crf = preset, crf
        self.width, self.height = width, height
        self.ffmpeg, self.ffprobe = str(ffmpeg), str(ffprobe)
        self.process_timeout = process_timeout

    @staticmethod
    def _emit(callback, event):
        if callback:
            try:
                callback(event)
            except Exception:
                LOG.exception("Progress callback failed")

    @staticmethod
    def _check(cancel):
        if cancel.is_set():
            raise Cancelled("Cancelled by user")

    def _run(self, args, cancel, timeout=None):
        self._check(cancel)
        # Files avoid pipe deadlocks and bound memory when FFmpeg emits long errors.
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            with subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=out,
                                  stderr=err, shell=False) as proc:
                deadline = time.monotonic() + (timeout or self.process_timeout)
                try:
                    while proc.poll() is None:
                        self._check(cancel)
                        if time.monotonic() > deadline:
                            raise TimeoutError("Media process timed out")
                        cancel.wait(0.1)
                    self._check(cancel)
                    if proc.returncode:
                        err.seek(0, os.SEEK_END)
                        err.seek(max(0, err.tell() - 8000))
                        raise RuntimeError(err.read().decode("utf-8", "replace"))
                    out.seek(0)
                    return out.read()
                finally:
                    if proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait()

    def _probe(self, path, cancel):
        data = self._run([self.ffprobe, "-v", "error", "-show_streams",
                          "-show_format", "-of", "json", str(path)], cancel, 30)
        info = json.loads(data)
        if not any(s["codec_type"] == "video" for s in info["streams"]):
            raise ValueError("No video stream")
        return info

    def _detect(self, source, cancel, callback):
        from scenedetect import SceneManager, open_video
        from scenedetect.detectors import ContentDetector

        video = open_video(str(source))
        manager = SceneManager()
        # Detect real short cuts; filter them explicitly rather than silently merge.
        manager.add_detector(ContentDetector(threshold=self.threshold, min_scene_len=1))
        done = threading.Event()

        def monitor():
            while not done.wait(0.2):
                if cancel.is_set():
                    manager.stop()
                self._emit(callback, Progress("detecting", str(source),
                           video.position.get_frames(), video.duration.get_frames()))

        watcher = threading.Thread(target=monitor, daemon=True)
        watcher.start()
        try:
            manager.detect_scenes(video=video, show_progress=False)
            self._check(cancel)
            scenes = manager.get_scene_list(start_in_scene=True)
            return [(a.get_seconds(), b.get_seconds()) for a, b in scenes]
        finally:
            done.set()
            watcher.join()
            # VideoStreamCv2 owns its capture; dropping it releases the decoder.
            del video

    def _bar_crop(self, source, start, end, width, height, cancel):
        """Conservative per-scene vertical trim; never infer side crops from darkness."""
        if not self.trim_bars:
            return 0, 0
        import numpy as np
        trims = []
        for fraction in (0.2, 0.5, 0.8):
            raw = self._run([self.ffmpeg, "-v", "error", "-ss", str(start+(end-start)*fraction),
                             "-i", str(source), "-frames:v", "1", "-vf", "scale=320:-2",
                             "-pix_fmt", "gray", "-f", "rawvideo", "-"], cancel)
            pixels = np.frombuffer(raw, dtype=np.uint8)
            if not pixels.size or pixels.size % 320:
                return 0, 0
            pixels = pixels.reshape(-1, 320)
            active = np.flatnonzero((pixels > 16).sum(axis=1) >= 2)
            if not len(active) or active[-1]-active[0] < len(pixels)*0.5:
                return 0, 0  # Dark/faded/ambiguous scene: preserve the complete frame.
            trims.append((int(active[0]), len(pixels)-1-int(active[-1]),len(pixels)))
        # Union of visible areas, plus a 2-source-pixel safety margin.
        top = max(0, int(min(t/h for t,b,h in trims)*height)-2)//2*2
        bottom = max(0, int(min(b/h for t,b,h in trims)*height)-2)//2*2
        if max(top,bottom)>height*0.25 or abs(top-bottom)>height*0.04:
            return 0, 0
        return top, bottom

    def _video_filter(self, top, bottom, height):
        base = f"crop=iw:{height-top-bottom}:0:{top}," if top or bottom else ""
        base += "scale=trunc(iw*sar/2)*2:ih,setsar=1"
        if self.layout == "center":
            return (f"[0:v:0]{base},scale={self.width}:{self.height}:"
                    f"force_original_aspect_ratio=increase,crop={self.width}:{self.height},setsar=1[v]")
        radius = min(20, self.width // 4, self.height // 4)
        # Foreground preserves the entire visible width; background fills the canvas.
        return (f"[0:v:0]{base},split=2[fg][bg];"
                f"[bg]scale={self.width}:{self.height}:force_original_aspect_ratio=increase,"
                f"crop={self.width}:{self.height},boxblur={radius}:2[blur];"
                f"[fg]scale={self.width}:{self.height}:force_original_aspect_ratio=decrease:"
                "force_divisible_by=2[fit];"
                "[blur][fit]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")

    def process_single_movie(self, video_path, output_dir, *, on_progress=None,
                             cancel_event=None):
        cancel = cancel_event if cancel_event is not None else threading.Event()
        source = Path(video_path).expanduser().resolve()
        result = MovieResult(str(source), "failed", settings=dict(
            fps=str(self.fps), media_format=self.media_format, layout=self.layout, trim_bars=self.trim_bars))
        staging = None
        try:
            self._check(cancel)
            if not source.is_file():
                raise FileNotFoundError(str(source))
            info = self._probe(source, cancel)
            source_video = next(s for s in info["streams"] if s["codec_type"] == "video")
            has_audio = any(s["codec_type"] == "audio" for s in info["streams"])
            self._emit(on_progress, Progress("detecting", str(source), message="Analyzing scenes"))
            scenes = self._detect(source, cancel, on_progress)
            if not scenes:
                raise ValueError("Video contains no decodable scenes")
            kept = [(a, b) for a, b in scenes if b - a + 1e-8 >= self.min_duration]
            result.skipped = len(scenes) - len(kept)
            base = Path(output_dir).expanduser().resolve()
            base.mkdir(parents=True, exist_ok=True)
            run_dir = Path(tempfile.mkdtemp(prefix="shorts-", dir=base))
            result.output_dir = str(run_dir)
            for index, (start, end) in enumerate(kept, 1):
                self._check(cancel)
                final = run_dir / f"scene-{index:04d}.{self.media_format}"
                staging = run_dir / f"scene-{index:04d}.partial.{self.media_format}"
                self._emit(on_progress, Progress("rendering", str(source), index - 1,
                                                len(kept), final.name))
                top, bottom = self._bar_crop(source, start, end, source_video["width"],
                                              source_video["height"], cancel)
                result.scene_crops.append(dict(start=start, end=end, top=top, bottom=bottom))
                vf = self._video_filter(top, bottom, source_video["height"])
                audio_args = (["-c:a", "pcm_s16le"] if self.media_format == "mov"
                              else ["-c:a", "aac", "-b:a", "192k"])
                self._run([self.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
                           "-n", "-ss", f"{start:.9f}", "-i", str(source),
                           "-t", f"{end-start:.9f}", "-filter_complex", vf, "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-preset", self.preset,
                           "-crf", str(self.crf), "-r", str(self.fps), "-fps_mode", "cfr", "-pix_fmt", "yuv420p", *audio_args, "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
                           str(staging)], cancel)
                check = self._probe(staging, cancel)
                v = next(s for s in check["streams"] if s["codec_type"] == "video")
                if (v["width"], v["height"]) != (self.width, self.height):
                    raise RuntimeError("Unexpected output dimensions")
                if has_audio and not any(s["codec_type"] == "audio" for s in check["streams"]):
                    raise RuntimeError("Audio missing from output")
                actual_duration = float(check["format"].get("duration", 0))
                if actual_duration <= 0 or abs(actual_duration - (end-start)) > 0.25:
                    raise RuntimeError("Unexpected output duration")
                self._check(cancel)
                staging.replace(final)
                staging = None
                result.clips.append(str(final))
                self._emit(on_progress, Progress("rendering", str(source), index, len(kept)))
            self._check(cancel)
            if result.clips:
                self._emit(on_progress, Progress("xml", str(source), message="Writing source timeline"))
                result.xml_path = self.generate_fcp_xml(
                    result.clips, run_dir / f"{source.stem}_assembly.xml",
                    sequence_name=f"{source.stem}_SourceTimeline", cancel_event=cancel)
            result.status = "completed" if kept else "empty"
        except Cancelled as exc:
            result.status, result.error = "cancelled", str(exc)
        except Exception as exc:
            result.error = str(exc)
            LOG.exception("Movie packaging failed: %s", source)
        finally:
            if staging is not None:
                staging.unlink(missing_ok=True)  # Only this job's incomplete file.
            if result.output_dir:
                manifest = Path(result.output_dir) / "result.json"
                try:
                    manifest.write_text(json.dumps(asdict(result), ensure_ascii=False,
                                                   indent=2), encoding="utf-8")
                except OSError as exc:
                    result.status, result.error = "failed", f"Cannot save result manifest: {exc}"
            self._emit(on_progress, Progress(result.status, str(source), len(result.clips),
                                            len(result.clips), result.error))
        return result

    def generate_fcp_xml(self, clips_dir, xml_output_path,
                         sequence_name="Shorts_Source_Assembly", *, cancel_event=None):
        """Export ordered paths or a folder of finished MP4/MOV clips at configured fps."""
        cancel = cancel_event if cancel_event is not None else threading.Event()
        if isinstance(clips_dir, (str, Path)):
            folder = Path(clips_dir).expanduser().resolve()
            paths = sorted(p for p in folder.iterdir() if p.is_file() and
                           p.suffix.lower() in {".mp4", ".mov"} and ".partial." not in p.name)
        else:
            paths = [Path(p).expanduser().resolve() for p in clips_dir]
        clips = []
        for path in paths:
            self._check(cancel)
            info = self._probe(path, cancel)
            video = next(s for s in info["streams"] if s["codec_type"] == "video")
            if frame_rate(video["avg_frame_rate"]) != self.fps:
                raise ValueError("XML requires media at configured fps; render through pipeline first")
            if (video["width"], video["height"]) != (self.width, self.height):
                raise ValueError("XML media dimensions do not match sequence")
            frames = int(video.get("nb_frames", 0))
            if frames <= 0:
                raise ValueError("Exact video frame count unavailable")
            audios = [s for s in info["streams"] if s["codec_type"] == "audio"]
            if len(audios) > 1:
                raise ValueError("Multiple audio streams unsupported; render through pipeline first")
            clips.append(dict(path=str(path), frames=frames,
                              channels=int(audios[0]["channels"]) if audios else 0,
                              sample_rate=int(audios[0]["sample_rate"]) if audios else 48000))
        self._check(cancel)
        return write_xml(clips, xml_output_path, sequence_name, self.fps, self.width, self.height)

    def run_batch(self, input_folder, base_output_folder, *, on_progress=None,
                  cancel_event=None):
        cancel = cancel_event if cancel_event is not None else threading.Event()
        folder = Path(input_folder).expanduser().resolve()
        if not folder.is_dir():
            raise NotADirectoryError(str(folder))
        movies = sorted(p for p in folder.iterdir() if p.is_file() and
                        p.suffix.lower() in {".mp4", ".mov", ".mkv", ".m4v", ".webm"})
        results = []
        for index, movie in enumerate(movies):
            if cancel.is_set():
                break
            self._emit(on_progress, Progress("batch", str(movie), index, len(movies)))
            result = self.process_single_movie(movie, base_output_folder,
                         on_progress=on_progress, cancel_event=cancel)
            results.append(result)
            if result.status == "cancelled":
                break
        self._emit(on_progress, Progress("batch_cancelled" if cancel.is_set() else
                   "batch_finished", str(folder), len(results), len(movies)))
        return results

    @staticmethod
    def _start(fn, *args, **kwargs):
        cancel = threading.Event()
        future = Future()
        def work():
            if not future.set_running_or_notify_cancel():
                return
            try:
                future.set_result(fn(*args, cancel_event=cancel, **kwargs))
            except BaseException as exc:
                future.set_exception(exc)
        threading.Thread(target=work, name="shorts-packaging", daemon=False).start()
        return Job(future, cancel)

    def start_single(self, video_path, output_dir, *, on_progress=None):
        return self._start(self.process_single_movie, video_path, output_dir,
                           on_progress=on_progress)

    def start_batch(self, input_folder, base_output_folder, *, on_progress=None):
        return self._start(self.run_batch, input_folder, base_output_folder,
                           on_progress=on_progress)
