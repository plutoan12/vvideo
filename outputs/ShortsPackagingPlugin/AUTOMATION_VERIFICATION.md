# Automation verification — 2026-10-09

Environment: Apple Silicon Mac, Python 3.12, separate automation environment installed from `requirements-automation.txt`. `pip check` passed. The existing TTS environment was restored after dependency experimentation and also passed `pip check`.

## Automated checks

`python -m unittest discover -s outputs/ShortsPackagingPlugin/tests -v`, with explicit `FFMPEG` and `FFPROBE` paths: **23 tests passed** in 19.172 seconds. This includes 13 existing tests and 10 added assembly/caption tests. JavaScript panels were unchanged and were not re-tested in this increment.

New checks include fractional-frame-rate assembly, FCP XML roundtrip, gapless clip positions, actual decoded audio presence, insufficient footage, missing input, cancellation before work, caption bounds/overlap, Unicode subtitles, timestamp validity and Korean lexical search.

## Actual media smoke test

- Input: existing local Qwen Korean narration sample and existing local movie picture sample.
- MLX Whisper: `mlx-community/whisper-small-mlx`, Korean, word timestamps enabled. Generated four SRT cues; recognizable wording matched the short source script, with numeric normalization (`네 명` → `4명`). This was a text comparison, not a listening or word-alignment audit.
- Assembly: 1080×1920, 24000/1001 fps, 258 frames, 10.76075 seconds.
- Source narration: 10.72 seconds; silence padded to the next video frame boundary.
- Audio: original picture audio muted; mono narration present.
- Export checks: normalized clip frame counts, final frame count, audio duration tolerance of one frame, complete FFmpeg decode all passed.
- Artifacts remain local in the workspace's `outputs/Automation_Check/`; movie media and machine-specific XML paths are not committed.

The new OTIO XML has not been imported into Premiere in this increment. This test does not establish semantic scene relevance, perceptual sync, subtitle word accuracy or natural-sounding narration. It uses one short sample, not a full movie.
