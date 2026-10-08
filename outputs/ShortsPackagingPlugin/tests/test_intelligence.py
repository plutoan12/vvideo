import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from xml.etree import ElementTree as ET

import numpy as np
import opentimelineio as otio
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from natural_narration import generate_natural_narration
from semantic_scenes import SemanticSceneSelector, unit_vectors
from premiere_xml import export_timeline_for_premiere
from narration_assembly import duration
from fractions import Fraction


class SpeechTests(unittest.TestCase):
    def client(self, data=b'RIFF' + b'\0' * 100, fail=False):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        def stream(path):
            Path(path).write_bytes(data)
            if fail:
                raise RuntimeError('sensitive upstream error')
        response.stream_to_file.side_effect = stream
        create = Mock(return_value=response)
        return SimpleNamespace(audio=SimpleNamespace(speech=SimpleNamespace(
            with_streaming_response=SimpleNamespace(create=create))))

    def test_wav_format_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'voice.wav'; client = self.client()
            generate_natural_narration('한국어', path, client=client)
            self.assertEqual(client.audio.speech.with_streaming_response.create.call_args.kwargs['response_format'], 'wav')
            with self.assertRaises(FileExistsError):
                generate_natural_narration('한국어', path, client=client)
            self.assertEqual(client.audio.speech.with_streaming_response.create.call_count, 1)

    def test_failure_removes_partial_and_redacts(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'voice.wav'
            with self.assertRaises(RuntimeError) as caught:
                generate_natural_narration('한국어', path, client=self.client(fail=True))
            self.assertNotIn('sensitive', str(caught.exception))
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_empty_response_not_published(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                generate_natural_narration('한국어', Path(d)/'voice.mp3', client=self.client(b''))
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_invalid_request_never_calls_api(self):
        client = self.client()
        for kwargs in [dict(speed=float('nan')), dict(speed=0), dict(instructions='acting'), dict(voice='cedar')]:
            with self.assertRaises(ValueError):
                generate_natural_narration('한국어', 'unused.wav', client=client, **kwargs)
        client.audio.speech.with_streaming_response.create.assert_not_called()


class SemanticTests(unittest.TestCase):
    def selector(self):
        image = Mock(); text = Mock()
        text.encode.return_value = [[1, 0]]
        selector = SemanticSceneSelector(image_model=image, text_model=text)
        selector.entries = [dict(path=str(Path('a.mp4').resolve())), dict(path=str(Path('b.mp4').resolve()))]
        selector.embeddings = np.array([[[1, 0], [1, 0], [0, 1]], [[0, 1], [0, 1], [1, 0]]], dtype=float)
        return selector

    def test_mean_frames_rank_and_exclusion(self):
        selector = self.selector()
        self.assertTrue(selector.select_best_scene('한국어').endswith('a.mp4'))
        self.assertTrue(selector.select_best_scene('한국어', exclude=['a.mp4']).endswith('b.mp4'))
        self.assertIsNone(selector.select_best_scene('한국어', minimum=0.9))
        selector.image_model.encode.assert_not_called()

    def test_invalid_embeddings_and_query(self):
        for bad in [[[0, 0]], [[float('nan'), 1]]]:
            with self.assertRaises(ValueError): unit_vectors(bad)
        with self.assertRaises(ValueError): self.selector().rank(' ')

    def test_separate_image_encoder_and_rejected_files(self):
        selector = self.selector()
        selector.image_model.encode.return_value = [[1, 0]] * 3
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'valid.mp4'; path.touch()
            images = [Mock(), Mock(), Mock()]
            selector._frames = Mock(return_value=(2.0, images))
            result = selector.index([path, path, Path(d)/'missing'])
            self.assertEqual(result['indexed'], 1)
            self.assertEqual(len(result['rejected']), 1)
            selector.image_model.encode.assert_called_once()
            selector.text_model.encode.assert_not_called()
            self.assertEqual(selector.embeddings.shape, (1, 3, 2))


class PremiereTests(unittest.TestCase):
    def test_matroska_stream_duration_tag(self):
        self.assertEqual(duration({'tags': {'DURATION': '00:01:20.020000000'}}), Fraction('80.02'))
        with self.assertRaises(ValueError): duration({})

    def timeline(self, root, fps=24000/1001):
        rt, tr = otio.opentime.RationalTime, otio.opentime.TimeRange
        timeline = otio.schema.Timeline(name='Korean_Test')
        for kind, suffix in [('Video', '.mp4'), ('Audio', '.wav')]:
            path = root / ('한글 & 공백' + suffix); path.touch()
            span = tr(rt(0, fps), rt(24, fps))
            track = otio.schema.Track(kind=kind)
            track.append(otio.schema.Clip(source_range=span, media_reference=otio.schema.ExternalReference(
                target_url=path.as_uri(), available_range=span)))
            timeline.tracks.append(track)
        return timeline

    def test_explicit_wav_audio_geometry_and_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); timeline = self.timeline(root)
            xml = root/'out.xml'
            export_timeline_for_premiere(timeline, xml, '24000/1001')
            seq = ET.parse(xml).find('.//sequence')
            self.assertEqual(seq.findtext('rate/ntsc'), 'TRUE')
            self.assertEqual(seq.findtext('./media/audio/track/clipitem/sourcetrack/mediatype'), 'audio')
            self.assertEqual(seq.findtext('./media/video/format/samplecharacteristics/height'), '1920')
            self.assertEqual(seq.findtext('./media/audio/track/clipitem/file/media/audio/channelcount'), '1')
            read = otio.adapters.read_from_file(str(xml), adapter_name='fcp_xml')
            self.assertAlmostEqual(read.duration().to_seconds(), timeline.duration().to_seconds())
            self.assertIsNone(timeline.global_start_time)
            with self.assertRaises(FileExistsError): export_timeline_for_premiere(timeline, xml, '24000/1001')

    def test_mixed_rates_rejected_instead_of_relabelled(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with self.assertRaisesRegex(ValueError, 'Mixed frame rates'):
                export_timeline_for_premiere(self.timeline(root), root/'out.xml', 30)
            self.assertFalse((root/'out.xml').exists())

    def test_unknown_kind_and_effects_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); timeline = self.timeline(root)
            timeline.tracks[0].kind = 'unknown'
            with self.assertRaises(ValueError): export_timeline_for_premiere(timeline, root/'out.xml')
            timeline = self.timeline(root)
            timeline.tracks[0][0].effects.append(otio.schema.LinearTimeWarp(time_scalar=2))
            with self.assertRaises(ValueError): export_timeline_for_premiere(timeline, root/'out.xml', '24000/1001')


if __name__ == '__main__':
    unittest.main()
