"""OpenAI speech generation with atomic output and no credential logging."""
import argparse
import math
import os
from pathlib import Path
import tempfile


def generate_natural_narration(text, output_filepath, voice='nova', speed=1.0,
                               *, model='tts-1', instructions=None, client=None):
    """Create an AI-generated MP3/WAV. Naturalness requires a listening review.

    Synchronous: call from a worker thread/process in a GUI. No hidden retries.
    Credentials come from OPENAI_API_KEY; never auto-load unrelated env files.
    """
    destination = Path(output_filepath).expanduser().absolute()
    if destination.suffix.lower() not in ('.wav', '.mp3'):
        raise ValueError('Output must be .wav or .mp3')
    if not text.strip() or len(text) > 4096:
        raise ValueError('Provide 1–4096 characters per request')
    if not math.isfinite(speed) or not 0.25 <= speed <= 4.0:
        raise ValueError('Speed must be between 0.25 and 4.0')
    if model not in ('tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'):
        raise ValueError('Unsupported speech model')
    legacy_voices = {'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'}
    voices = legacy_voices if model.startswith('tts-1') else legacy_voices | {
        'ash', 'ballad', 'coral', 'sage', 'verse', 'marin', 'cedar'}
    if voice not in voices:
        raise ValueError('Voice is not supported by this model')
    if instructions and model.startswith('tts-1'):
        raise ValueError('tts-1/tts-1-hd do not support acting instructions')
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(destination)
    owned = client is None
    if owned:
        from openai import OpenAI
        if not os.environ.get('OPENAI_API_KEY', '').strip():
            raise ValueError('OPENAI_API_KEY is not configured')
        client = OpenAI(base_url='https://api.openai.com/v1', timeout=120, max_retries=0)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.speech-', suffix=destination.suffix, dir=destination.parent)
    os.close(fd)
    staging = Path(name)
    params = dict(model=model, voice=voice, input=text, speed=speed,
                  response_format=destination.suffix[1:].lower())
    if instructions:
        params['instructions'] = instructions
    try:
        try:
            with client.audio.speech.with_streaming_response.create(**params) as response:
                response.stream_to_file(staging)
        except Exception as exc:
            # SDK errors can contain request/credential details; don't echo their body.
            status = getattr(exc, 'status_code', None)
            raise RuntimeError(f'Speech request failed (HTTP {status or "unavailable"}); no output published') from None
        if staging.stat().st_size < 44:
            raise RuntimeError('Speech response is empty or truncated')
        os.link(staging, destination)  # Never overwrite an existing result, even in a race.
        return str(destination)
    finally:
        staging.unlink(missing_ok=True)
        if owned:
            client.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('script', help='UTF-8 text file'); p.add_argument('output')
    p.add_argument('--model', default='tts-1'); p.add_argument('--voice', default='nova')
    p.add_argument('--speed', type=float, default=1.0); p.add_argument('--instructions')
    args = p.parse_args()
    try:
        print(generate_natural_narration(Path(args.script).read_text(encoding='utf-8-sig'),
              args.output, args.voice, args.speed, model=args.model, instructions=args.instructions))
    except (ValueError, RuntimeError, OSError) as exc:
        p.exit(1, f'{exc}\n')
