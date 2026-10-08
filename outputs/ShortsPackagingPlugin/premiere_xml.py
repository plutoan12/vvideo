"""FCP XML export for conformed video and mono 48 kHz narration tracks."""
import math
from pathlib import Path
from urllib.parse import urlparse, unquote
from xml.etree import ElementTree as ET

from fcp_xml import frame_rate, add_rate, sub


def export_timeline_for_premiere(timeline, output_xml, fps=24, *, width=1080, height=1920):
    """Validate, don't silently retime. Source media must already match these settings.

    Only flat Clip/Gap tracks are supported; no transitions, speed effects or
    nested compositions. Track kind must be explicit, never guessed from suffix.
    Original timeline remains untouched. Existing XML is never overwritten.
    """
    import opentimelineio as otio
    fps = frame_rate(fps)
    if width <= 0 or height <= 0 or width % 2 or height % 2:
        raise ValueError('Dimensions must be positive even integers')
    work = timeline.deepcopy()
    if not work.tracks or work.tracks.effects:
        raise ValueError('Provide flat tracks without stack effects')
    work.global_start_time = otio.opentime.RationalTime(0, float(fps))
    kinds = {}
    clip_count = 0
    def check_time(time):
        if not math.isfinite(time.value) or time.value < 0 or not math.isclose(time.value, round(time.value), abs_tol=1e-7):
            raise ValueError('Clip positions must use nonnegative whole frames')
        if not math.isclose(time.rate, float(fps), rel_tol=0, abs_tol=1e-6):
            raise ValueError('Mixed frame rates: conform media and all ranges before export')
    for track in work.tracks:
        if not isinstance(track, otio.schema.Track) or track.kind not in ('Video', 'Audio'):
            raise ValueError('Every track must explicitly be Video or Audio')
        if track.effects or track.source_range is not None:
            raise ValueError('Track effects/trims are unsupported')
        for item in track:
            if not isinstance(item, (otio.schema.Clip, otio.schema.Gap)) or item.effects:
                raise ValueError('Only clips and gaps without effects are supported')
            span = item.source_range
            if span is None or span.duration.value <= 0:
                raise ValueError('Every item needs a positive source range')
            check_time(span.start_time); check_time(span.duration)
            if isinstance(item, otio.schema.Gap):
                continue
            clip_count += 1
            ref = item.media_reference
            if not isinstance(ref, otio.schema.ExternalReference) or ref.available_range is None:
                raise ValueError('Clip needs an external reference and available range')
            check_time(ref.available_range.start_time); check_time(ref.available_range.duration)
            # Compare integer frame coordinates; OTIO's seconds-based contains()
            # can reject identical fractional-rate ranges through float rounding.
            available = ref.available_range
            if (round(span.start_time.value) < round(available.start_time.value) or
                round(span.start_time.value) + round(span.duration.value) >
                round(available.start_time.value) + round(available.duration.value)):
                raise ValueError('Source range exceeds available media')
            url = urlparse(ref.target_url)
            if url.scheme != 'file' or url.netloc not in ('', 'localhost') or not Path(unquote(url.path)).is_file():
                raise ValueError('Clip media must be an existing local file URI')
            if ref.target_url in kinds and kinds[ref.target_url] != track.kind:
                raise ValueError('Use separate conformed video and narration files')
            kinds[ref.target_url] = track.kind
    if not clip_count:
        raise ValueError('No clips to export')
    xml = ET.fromstring(otio.adapters.write_to_string(work, adapter_name='fcp_xml'))
    sequence = xml.find('.//sequence')
    def chars(parent, kind):
        for old in parent.findall('samplecharacteristics'):
            parent.remove(old)
        node = sub(parent, 'samplecharacteristics')
        if kind == 'Video':
            add_rate(node, fps)
            for key, value in [('width', width), ('height', height), ('anamorphic', 'FALSE'),
                               ('pixelaspectratio', 'square'), ('fielddominance', 'none')]:
                sub(node, key, value)
        else:
            sub(node, 'depth', 16); sub(node, 'samplerate', 48000)
    video = sequence.find('./media/video')
    if video is not None:
        fmt = video.find('format')
        if fmt is None: fmt = sub(video, 'format')
        chars(fmt, 'Video')
    audio = sequence.find('./media/audio')
    if audio is not None:
        sub(audio, 'numOutputChannels', 2)
        chars(sub(audio, 'format'), 'Audio')
    for file in sequence.findall('.//file'):
        uri = file.findtext('pathurl')
        if not uri: continue
        kind = kinds[uri]
        media = file.find('media')
        media.clear()
        stream = sub(media, kind.lower())
        chars(stream, kind)
        if kind == 'Audio': sub(stream, 'channelcount', 1)
    for kind in ('video', 'audio'):
        for item in sequence.findall(f'./media/{kind}/track/clipitem'):
            for duplicate in item.findall('rate')[1:]: item.remove(duplicate)
            sub(item, 'enabled', 'TRUE')
            source = item.find('sourcetrack')
            if source is None: source = sub(item, 'sourcetrack')
            source.clear()
            sub(source, 'mediatype', kind); sub(source, 'trackindex', 1)
    ET.indent(xml)
    destination = Path(output_xml).expanduser().absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as stream:
        stream.write(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n')
        stream.write(ET.tostring(xml, encoding='utf-8'))
    return str(destination)
