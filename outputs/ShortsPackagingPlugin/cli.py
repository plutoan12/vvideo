"""JSON-lines adapter for Electron/QProcess and terminal use."""
import argparse
import json
import signal
import threading
from dataclasses import asdict
from shorts_automator import ShortsPackagingPlugin


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="Video file, or a directory with --batch")
    parser.add_argument("output")
    parser.add_argument("--batch", action="store_true")
    parser.add_argument("--fps", default="24")
    parser.add_argument("--media-format", choices=["mov", "mp4"], default="mov")
    parser.add_argument("--layout", choices=["fit_blur", "center"], default="fit_blur")
    parser.add_argument("--keep-bars", action="store_true")
    parser.add_argument("--threshold", type=float, default=27.0)
    parser.add_argument("--min-duration", type=float, default=1.0)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()
    cancel = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: cancel.set())
    signal.signal(signal.SIGTERM, lambda *_: cancel.set())
    def emit(kind, data):
        print(json.dumps({"type": kind, "data": data}, ensure_ascii=False), flush=True)
    try:
        plugin = ShortsPackagingPlugin(fps=args.fps, threshold=args.threshold, min_duration=args.min_duration,
                                       ffmpeg=args.ffmpeg, ffprobe=args.ffprobe, media_format=args.media_format,
                                       layout=args.layout, trim_bars=not args.keep_bars)
        fn = plugin.run_batch if args.batch else plugin.process_single_movie
        result = fn(args.input, args.output, cancel_event=cancel,
                    on_progress=lambda e: emit("progress", asdict(e)))
        results = result if isinstance(result, list) else [result]
        emit("result", [asdict(r) for r in results])
        if cancel.is_set():
            return 130
        return 0 if results and all(r.status == "completed" for r in results) else 1
    except Exception as exc:
        emit("error", {"message": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
