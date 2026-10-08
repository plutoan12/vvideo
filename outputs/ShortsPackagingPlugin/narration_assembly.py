"""Narration-led assembly using OpenTimelineIO, pysubs2 and FFmpeg.

Input clip order is explicit, not semantic scene matching. Runs synchronously;
use start() for GUI integration. Each run gets its own output directory.
"""
import argparse
import json
import math
import tempfile
import threading
from fractions import Fraction
from pathlib import Path

from shorts_automator import ShortsPackagingPlugin, Progress
from premiere_xml import export_timeline_for_premiere
from export_delivery import export_mp4


def duration(stream):
    if stream.get('duration_ts') is not None and stream.get('time_base'):
        value = Fraction(stream['duration_ts']) * Fraction(stream['time_base'])
    elif stream.get('duration') not in (None, 'N/A'):
        value = Fraction(stream.get('duration', '0'))
    elif stream.get('tags', {}).get('DURATION'):
        hours, minutes, seconds = stream['tags']['DURATION'].split(':')
        value = int(hours) * 3600 + int(minutes) * 60 + Fraction(seconds)
    else:
        value = Fraction(0)
    if value <= 0:
        raise ValueError('Media stream must have a known positive duration')
    return value


def validate_captions(path, end_ms):
    import pysubs2
    captions = pysubs2.load(str(path), encoding='utf-8-sig')
    if not captions:
        raise ValueError('Subtitle file is empty')
    warnings = []
    previous_end = 0
    for index, cue in enumerate(captions, 1):
        if cue.start < previous_end or cue.end <= cue.start or cue.end > end_ms:
            raise ValueError(f'Caption {index}: overlapping, invalid or beyond narration')
        if not cue.plaintext.strip():
            raise ValueError(f'Caption {index}: empty text')
        if len(cue.plaintext.splitlines()) > 2 or any(len(x) > 24 for x in cue.plaintext.splitlines()):
            warnings.append(f'Caption {index}: review line length on a vertical canvas')
        previous_end = cue.end
    return captions, warnings


class NarrationAssembler(ShortsPackagingPlugin):
    def _media(self, path, cancel):
        return json.loads(self._run([self.ffprobe, '-v', 'error', '-show_streams',
                                    '-of', 'json', str(path)], cancel, 30))['streams']

    def start(self, clips, narration, output, **kwargs):
        return self._start(self.assemble, clips, narration, output, **kwargs)

    def assemble(self, clips, narration, output, *, captions=None, on_progress=None,
                 cancel_event=None):
        import opentimelineio as otio
        cancel = cancel_event if cancel_event is not None else threading.Event()
        self._check(cancel)
        clips = [Path(p).expanduser().resolve() for p in clips]
        voice = Path(narration).expanduser().resolve()
        if not clips or not all(p.is_file() for p in [voice, *clips]):
            raise ValueError('Provide existing narration and an explicit nonempty clip list')
        audios = [s for s in self._media(voice, cancel) if s['codec_type'] == 'audio']
        if len(audios) != 1 or audios[0]['channels'] not in (1, 2):
            raise ValueError('Narration must have one mono/stereo audio stream')
        voice_seconds = duration(audios[0])
        frames = math.ceil(voice_seconds * self.fps)
        plan, remaining = [], frames
        for path in clips:
            video = next((s for s in self._media(path, cancel) if s['codec_type']=='video'), None)
            if video is None:
                raise ValueError(f'No video: {path.name}')
            available = math.floor(duration(video) * self.fps)
            count = min(available, remaining)
            if count > 0:
                plan.append((path, count, video['height']))
                remaining -= count
            if remaining == 0:
                break
        if remaining:
            raise ValueError(f'Not enough selected footage: need {remaining} more frames; no automatic looping')
        subs, warnings = (None, []) if captions is None else validate_captions(captions, math.ceil(voice_seconds*1000))
        base = Path(output).expanduser().resolve(); base.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix='assembly-', dir=base))
        try:
            rt, tr = otio.opentime.RationalTime, otio.opentime.TimeRange
            rate = float(self.fps)
            timeline = otio.schema.Timeline(name='Narration_Assembly')
            vt = otio.schema.Track(name='Picture', kind=otio.schema.TrackKind.Video)
            at = otio.schema.Track(name='Narration', kind=otio.schema.TrackKind.Audio)
            timeline.tracks.extend([vt, at])
            def append(track, path, count):
                span = tr(rt(0, rate), rt(count, rate))
                track.append(otio.schema.Clip(name=path.name, source_range=span,
                    media_reference=otio.schema.ExternalReference(target_url=path.as_uri(), available_range=span)))
            rendered = []
            for i, (source, count, height) in enumerate(plan, 1):
                self._emit(on_progress, Progress('assembling', str(source), i-1, len(plan)))
                target = folder/f'clip-{i:04}.mp4'
                graph = self._video_filter(0, 0, height).replace('[v]',
                    f'[scaled];[scaled]fps={self.fps},tpad=stop_mode=clone:stop_duration=0.1,trim=end_frame={count},setpts=PTS-STARTPTS[v]')
                self._run([self.ffmpeg,'-nostdin','-v','error','-i',str(source),'-filter_complex',graph,
                    '-map','[v]','-an','-frames:v',str(count),'-c:v','libx264','-preset',self.preset,
                    '-crf',str(self.crf),'-pix_fmt','yuv420p',str(target)],cancel)
                check=next(s for s in self._media(target,cancel) if s['codec_type']=='video')
                if int(check['nb_frames']) != count:
                    raise RuntimeError('Normalized clip frame count mismatch')
                rendered.append(target);append(vt,target,count)
            seconds=float(Fraction(frames)/self.fps)
            wav=folder/'narration.wav'
            self._run([self.ffmpeg,'-nostdin','-v','error','-i',str(voice),'-map','0:a:0',
                '-af',f'apad,atrim=duration={seconds}', '-ar','48000','-ac','1','-c:a','pcm_s16le',str(wav)],cancel)
            append(at,wav,frames)
            otio.adapters.write_to_file(timeline,str(folder/'timeline.otio'))
            export_timeline_for_premiere(timeline, folder/'assembly.xml', self.fps,
                                         width=self.width, height=self.height)
            if subs is not None:subs.save(str(folder/'captions.srt'),encoding='utf-8')
            (folder/'concat.txt').write_text(''.join(f"file '{p.name}'\n" for p in rendered))
            master=folder/'master.mov'
            self._run([self.ffmpeg,'-nostdin','-v','error','-f','concat','-safe','1','-i',str(folder/'concat.txt'),
                '-i',str(wav),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','pcm_s16le',str(master)],cancel)
            final=Path(export_mp4(master,folder/'final.mp4',ffmpeg=self.ffmpeg,ffprobe=self.ffprobe,cancel_event=cancel))
            info=self._media(final,cancel)
            v=next(s for s in info if s['codec_type']=='video');a=next(s for s in info if s['codec_type']=='audio')
            if int(v['nb_frames']) != frames or abs(float(duration(a))-seconds)>1/float(self.fps):
                raise RuntimeError('Final audio/video timing mismatch')
            self._run([self.ffmpeg,'-nostdin','-v','error','-xerror','-i',str(final),'-f','null','-'],cancel)
            report=dict(status='completed',frames=frames,fps=str(self.fps),duration=seconds,
                narration_duration=float(voice_seconds),source_audio='muted',warnings=warnings,
                clips=[dict(source=str(p),frames=n) for p,n,_ in plan],
                final=str(final),xml=str(folder/'assembly.xml'),otio=str(folder/'timeline.otio'),
                checks=['clip frame counts','final frame count','audio duration','full decode'],
                limitations=['No semantic scene selection','No subtitle speech alignment validation','No narration naturalness assessment'])
            (folder/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
            self._emit(on_progress,Progress('completed',str(voice),len(plan),len(plan)))
            return report
        except Exception as exc:
            (folder/'failure.json').write_text(json.dumps({'error':str(exc)},ensure_ascii=False))
            raise


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('narration');p.add_argument('output');p.add_argument('clips',nargs='+')
    p.add_argument('--captions');p.add_argument('--fps',default='24000/1001')
    p.add_argument('--ffmpeg',default='ffmpeg');p.add_argument('--ffprobe',default='ffprobe')
    args=p.parse_args()
    assembler=NarrationAssembler(fps=args.fps,ffmpeg=args.ffmpeg,ffprobe=args.ffprobe)
    print(json.dumps(assembler.assemble(args.clips,args.narration,args.output,captions=args.captions),ensure_ascii=False))
