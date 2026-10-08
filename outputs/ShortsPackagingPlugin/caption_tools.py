"""Whisper captions and lexical subtitle search; no claimed visual understanding."""
import argparse
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path
import pysubs2


def captions_from_words(segments, max_chars=24, max_seconds=3.0):
    if max_chars < 1 or not math.isfinite(max_seconds) or max_seconds <= 0:
        raise ValueError('Caption limits must be positive')
    subs=pysubs2.SSAFile(); words=[]; previous=0
    def flush():
        if not words:return
        subs.append(pysubs2.SSAEvent(start=round(words[0]['start']*1000),
                    end=round(words[-1]['end']*1000),text=' '.join(w['word'].strip() for w in words)))
        words.clear()
    for segment in segments:
        for word in segment.get('words',[]):
            start,end=float(word['start']),float(word['end']);text=word['word'].strip()
            if not all(math.isfinite(x) for x in (start,end)) or start<0 or end<start:
                raise ValueError('Invalid word timestamp')
            if not text:continue
            start=max(start,previous)  # Resolve tiny overlapping ASR timestamp estimates.
            if end-start<0.001:continue
            word=dict(start=start,end=end,word=text)
            if words and (len(' '.join(w['word'] for w in words))+1+len(text)>max_chars or end-words[0]['start']>max_seconds or start-words[-1]['end']>0.5):flush()
            words.append(word);previous=end
        flush()
    if not subs:raise ValueError('No timestamped speech recognized')
    return subs


def transcribe(audio, output, *, ffmpeg='ffmpeg', model='mlx-community/whisper-small-mlx', language='ko'):
    import numpy as np
    import mlx_whisper
    audio=Path(audio).expanduser().resolve()
    if not audio.is_file():raise FileNotFoundError(audio)
    # Feed decoded samples directly so callers can select their own FFmpeg binary.
    raw=subprocess.run([ffmpeg,'-nostdin','-v','error','-i',str(audio),'-map','0:a:0',
        '-ar','16000','-ac','1','-f','f32le','-'],capture_output=True,check=True,timeout=7200).stdout
    samples=np.frombuffer(raw,dtype=np.float32)
    if not samples.size:raise ValueError('Empty audio')
    result=mlx_whisper.transcribe(samples,path_or_hf_repo=model,language=language,
        word_timestamps=True,condition_on_previous_text=False,verbose=False)
    subs=captions_from_words(result['segments'])
    if subs[-1].end>math.ceil(len(samples)/16):raise ValueError('ASR timestamp beyond audio duration')
    base=Path(output).expanduser().resolve();base.mkdir(parents=True,exist_ok=True)
    folder=Path(tempfile.mkdtemp(prefix='captions-',dir=base))
    subs.save(str(folder/'captions.srt'),encoding='utf-8')
    (folder/'transcript.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    return str(folder)


def search_dialogue(query, subtitle_file, limit=5, minimum=60):
    from rapidfuzz import fuzz, process
    if not query.strip() or limit<1 or not 0<=minimum<=100:raise ValueError('Invalid search options')
    subs=pysubs2.load(str(subtitle_file),encoding='utf-8-sig')
    normalize=lambda s: re.sub(r'\s+',' ',s.casefold()).strip()
    choices=[normalize(c.plaintext) for c in subs]
    matches=process.extract(normalize(query),choices,scorer=fuzz.WRatio,limit=limit,score_cutoff=minimum)
    return [dict(start_ms=subs[i].start,end_ms=subs[i].end,text=subs[i].plaintext,
                 score=round(score,2),method='lexical_fuzzy_match',requires_review=True)
            for _,score,i in matches]


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    t=sub.add_parser('transcribe');t.add_argument('audio');t.add_argument('output')
    t.add_argument('--ffmpeg',default='ffmpeg');t.add_argument('--model',default='mlx-community/whisper-small-mlx')
    s=sub.add_parser('search');s.add_argument('subtitles');s.add_argument('query')
    args=p.parse_args()
    result=transcribe(args.audio,args.output,ffmpeg=args.ffmpeg,model=args.model) if args.command=='transcribe' else search_dialogue(args.query,args.subtitles)
    print(json.dumps(result,ensure_ascii=False))
