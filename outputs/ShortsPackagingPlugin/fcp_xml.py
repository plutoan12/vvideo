"""FCP 7 xmeml writer; only Python standard library dependencies."""
from fractions import Fraction
from pathlib import Path
from xml.etree import ElementTree as ET


def frame_rate(value):
    aliases = {'23.976': '24000/1001', '29.97': '30000/1001', '59.94': '60000/1001'}
    rate = Fraction(aliases.get(str(value), str(value)))
    if rate not in [Fraction(n) for n in (24, 25, 30, 50, 60)] + [Fraction(n,1001) for n in (24000,30000,60000)]:
        raise ValueError('Supported fps: 24/25/30/50/60 or 24000/1001, 30000/1001, 60000/1001')
    return rate


def sub(parent, name, value=None, **attrs):
    node = ET.SubElement(parent, name, attrs)
    if value is not None:
        node.text = str(value)
    return node


def add_rate(parent, fps):
    rate = sub(parent, 'rate')
    sub(rate, 'timebase', round(fps))
    sub(rate, 'ntsc', 'TRUE' if fps.denominator == 1001 else 'FALSE')


def write_xml(clips, destination, name, fps, width, height):
    """clips: explicit ordered dicts with path, frames, channels, sample_rate.

    File rate must already match fps; caller validates media. Never overwrite XML.
    """
    fps = frame_rate(fps)
    if not clips:
        raise ValueError('No clips for XML')
    root = ET.Element('xmeml', version='5')
    seq = sub(root, 'sequence', id='sequence-1')
    sub(seq, 'name', name)
    sub(seq, 'duration', sum(c['frames'] for c in clips))
    add_rate(seq, fps)
    media = sub(seq, 'media')
    video = sub(media, 'video')
    chars = sub(sub(video, 'format'), 'samplecharacteristics')
    add_rate(chars, fps)
    for k,v in [('width',width),('height',height),('anamorphic','FALSE'),
                ('pixelaspectratio','square'),('fielddominance','none')]:
        sub(chars,k,v)
    vt = sub(video,'track')
    audio = sub(media,'audio')
    max_channels = max(c['channels'] for c in clips)
    sub(audio,'numOutputChannels',max(2,max_channels))
    achars=sub(sub(audio,'format'),'samplecharacteristics')
    sub(achars,'depth',16);sub(achars,'samplerate',48000)
    ats=[sub(audio,'track') for _ in range(max_channels)]
    counts=[0]*max_channels
    cursor=0
    for i,c in enumerate(clips,1):
        frames=c['frames']
        if frames <= 0 or c['channels'] not in (0,1,2):
            raise ValueError('Invalid frame count or unsupported audio channels')
        ids=[(f'v-{i}','video',1,i)]
        for ch in range(c['channels']):
            counts[ch]+=1
            ids.append((f'a-{i}-{ch+1}','audio',ch+1,counts[ch]))
        path=Path(c['path']).resolve()
        for j,(cid,kind,track_index,clip_index) in enumerate(ids):
            item=sub(vt if kind=='video' else ats[track_index-1],'clipitem',id=cid)
            sub(item,'name',path.name);sub(item,'enabled','TRUE')
            sub(item,'duration',frames);add_rate(item,fps)
            for k,v in [('start',cursor),('end',cursor+frames),('in',0),('out',frames)]:sub(item,k,v)
            file=sub(item,'file',id=f'file-{i}')
            if j==0:
                sub(file,'name',path.name);sub(file,'pathurl',path.as_uri())
                add_rate(file,fps);sub(file,'duration',frames)
                fm=sub(file,'media');fv=sub(fm,'video');fc=sub(fv,'samplecharacteristics')
                add_rate(fc,fps)
                for k,v in [('width',width),('height',height),('pixelaspectratio','square'),('fielddominance','none')]:sub(fc,k,v)
                if c['channels']:
                    fa=sub(fm,'audio');ac=sub(fa,'samplecharacteristics')
                    sub(ac,'depth',16);sub(ac,'samplerate',c['sample_rate'])
                    sub(fa,'channelcount',c['channels'])
            st=sub(item,'sourcetrack');sub(st,'mediatype',kind);sub(st,'trackindex',track_index if kind=='audio' else 1)
            if kind == 'audio' and c['channels'] == 2:
                # Separate mono source channels must be panned to retain stereo.
                effect = sub(sub(item, 'filter'), 'effect')
                for key, value in [('name', 'Audio Pan'), ('effectid', 'audiopan'),
                                   ('effectcategory', 'audiopan'), ('effecttype', 'audiopan'),
                                   ('mediatype', 'audio')]:
                    sub(effect, key, value)
                parameter = sub(effect, 'parameter')
                for key, value in [('parameterid', 'pan'), ('name', 'Pan'),
                                   ('valuemin', -1), ('valuemax', 1),
                                   ('value', -1 if track_index == 1 else 1)]:
                    sub(parameter, key, value)
            for ref,typ,tr,ci in ids:
                link=sub(item,'link');sub(link,'linkclipref',ref);sub(link,'mediatype',typ)
                sub(link,'trackindex',tr);sub(link,'clipindex',ci)
                if typ=='audio':sub(link,'groupindex',1)
        cursor+=frames
    ET.indent(root, space='  ')
    content=b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n'+ET.tostring(root,encoding='utf-8')+b'\n'
    destination=Path(destination).expanduser().resolve()
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('xb') as f:f.write(content)
    return str(destination)
