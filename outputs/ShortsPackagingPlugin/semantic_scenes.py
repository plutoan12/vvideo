"""Local Korean text-to-scene ranking with paired CLIP encoders.

Scores are similarities, not probabilities. Selection needs editorial review.
"""
import argparse
import io
import json
import math
from pathlib import Path
import subprocess

import numpy as np

IMAGE_MODEL = 'sentence-transformers/clip-ViT-B-32'
TEXT_MODEL = 'sentence-transformers/clip-ViT-B-32-multilingual-v1'


def unit_vectors(values):
    values = np.asarray(values, dtype=np.float32)
    if values.ndim != 2 or not np.isfinite(values).all():
        raise ValueError('Invalid embeddings')
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if (norms <= 0).any():
        raise ValueError('Zero embedding')
    return values / norms


class SemanticSceneSelector:
    """Load two models once per instance and reuse indexed frames across queries.

    Uses FFmpeg for timestamp-based extraction, including variable-rate sources.
    CPU by default for reproducibility; device='mps' is an optional Mac setting.
    No movie frames are uploaded. First use downloads model weights.
    """
    def __init__(self, *, ffmpeg='ffmpeg', ffprobe='ffprobe', device='cpu',
                 image_model=None, text_model=None):
        if (image_model is None) != (text_model is None):
            raise ValueError('Provide both encoders or neither')
        self.ffmpeg, self.ffprobe, self.device = ffmpeg, ffprobe, device
        self.image_model, self.text_model = image_model, text_model
        self.entries = []
        self.embeddings = None

    def _load(self):
        if self.image_model is None:
            from sentence_transformers import SentenceTransformer
            self.image_model = SentenceTransformer(IMAGE_MODEL, device=self.device, trust_remote_code=False)
            self.text_model = SentenceTransformer(TEXT_MODEL, device=self.device, trust_remote_code=False)

    def _frames(self, path):
        from PIL import Image
        raw = subprocess.check_output([self.ffprobe, '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=duration:format=duration', '-of', 'json', str(path)], timeout=30)
        info = json.loads(raw)
        if not info.get('streams'):
            raise ValueError('No video stream')
        seconds = float(info['streams'][0].get('duration', info.get('format', {}).get('duration', 0)))
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError('Unknown video duration')
        frames = []
        for fraction in (0.2, 0.5, 0.8):
            timestamp = seconds * fraction
            data = subprocess.check_output([self.ffmpeg, '-nostdin', '-v', 'error', '-ss', str(timestamp),
                '-i', str(path), '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease',
                '-f', 'image2pipe', '-vcodec', 'png', '-'], timeout=60)
            with Image.open(io.BytesIO(data)) as im:
                frames.append(im.convert('RGB'))
        return seconds, frames

    def index(self, clips):
        """Replace the index atomically. Report invalid clips instead of selecting them."""
        paths = list(dict.fromkeys(Path(p).expanduser().resolve() for p in clips))
        if not paths:
            raise ValueError('Provide clips to index')
        self._load()
        entries, vectors, rejected = [], [], []
        for path in paths:
            try:
                if not path.is_file():
                    raise FileNotFoundError(path)
                seconds, images = self._frames(path)
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                rejected.append(dict(path=str(path), reason=type(exc).__name__))
                continue
            try:
                encoded = unit_vectors(self.image_model.encode(images, convert_to_numpy=True, show_progress_bar=False))
            finally:
                for im in images:
                    im.close()
            if len(encoded) != 3:
                raise ValueError('Expected three frame embeddings')
            entries.append(dict(path=str(path), duration=seconds, sample_fractions=[0.2, 0.5, 0.8]))
            vectors.append(encoded)
        if not entries:
            raise ValueError('No readable video clips; index not replaced')
        self.entries, self.embeddings = entries, np.stack(vectors)
        return dict(indexed=len(entries), rejected=rejected)

    def rank(self, text, *, top_k=5, minimum=None, exclude=()):
        if not text.strip() or top_k < 1:
            raise ValueError('Nonempty text and positive top_k required')
        if minimum is not None and (not math.isfinite(minimum) or not -1 <= minimum <= 1):
            raise ValueError('Minimum cosine similarity must be in [-1, 1]')
        if self.embeddings is None:
            raise ValueError('Index clips before ranking')
        query = unit_vectors(self.text_model.encode([text], convert_to_numpy=True, show_progress_bar=False))[0]
        scores = (self.embeddings @ query).mean(axis=1)
        excluded = {str(Path(p).expanduser().resolve()) for p in exclude}
        result = []
        for i in np.argsort(-scores, kind='stable'):
            score = float(scores[i])
            if self.entries[i]['path'] in excluded or (minimum is not None and score < minimum):
                continue
            result.append(dict(self.entries[i], score=score, requires_review=True))
            if len(result) == top_k:
                break
        return result

    def select_best_scene(self, text, *, minimum=None, exclude=()):
        candidates = self.rank(text, top_k=1, minimum=minimum, exclude=exclude)
        return candidates[0]['path'] if candidates else None


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('text'); p.add_argument('clips', nargs='+')
    p.add_argument('--ffmpeg', default='ffmpeg'); p.add_argument('--ffprobe', default='ffprobe')
    p.add_argument('--device', default='cpu'); p.add_argument('--minimum', type=float)
    args = p.parse_args()
    selector = SemanticSceneSelector(ffmpeg=args.ffmpeg, ffprobe=args.ffprobe, device=args.device)
    report = selector.index(args.clips)
    report.update(query=args.text, candidates=selector.rank(args.text, minimum=args.minimum),
                  image_model=IMAGE_MODEL, text_model=TEXT_MODEL)
    print(json.dumps(report, ensure_ascii=False, indent=2))
