"""Convert a Premiere ProRes/PCM master to H.264/AAC without manual sync offsets."""
import argparse
import os
from pathlib import Path
import tempfile
import threading
from shorts_automator import ShortsPackagingPlugin


def export_mp4(source, destination, *, ffmpeg='ffmpeg', ffprobe='ffprobe', cancel_event=None):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.suffix.lower() != '.mp4':
        raise ValueError('Destination must be .mp4')
    if destination.exists():
        raise FileExistsError(destination)
    cancel = cancel_event if cancel_event is not None else threading.Event()
    worker = ShortsPackagingPlugin(ffmpeg=ffmpeg, ffprobe=ffprobe)
    info = worker._probe(source, cancel)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    audios = [s for s in info['streams'] if s['codec_type'] == 'audio']
    if len(audios) > 1 or any(not s['codec_name'].startswith('pcm_') for s in audios):
        raise ValueError('Use a master with one PCM audio stream, or no audio')
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.delivery-', suffix='.mp4', dir=destination.parent)
    os.close(fd)
    staging = Path(name)
    try:
        worker._run([str(ffmpeg), '-nostdin', '-v', 'error', '-y', '-i', str(source),
                     '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast',
                     '-crf', '18', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
                     '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart',
                     str(staging)], cancel)
        check = worker._probe(staging, cancel)
        out = next(s for s in check['streams'] if s['codec_type'] == 'video')
        if (out['width'], out['height'], out['avg_frame_rate'], out.get('nb_frames')) != (
                video['width'], video['height'], video['avg_frame_rate'], video.get('nb_frames')):
            raise RuntimeError('Output video timing/format differs from master')
        if audios and not any(s['codec_type']=='audio' for s in check['streams']):
            raise RuntimeError('Output audio is missing')
        worker._check(cancel)
        os.link(staging, destination)  # Atomic creation; never overwrite an existing result.
        return str(destination)
    finally:
        staging.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('destination')
    parser.add_argument('--ffmpeg', default='ffmpeg');parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args()
    print(export_mp4(args.source,args.destination,ffmpeg=args.ffmpeg,ffprobe=args.ffprobe))
