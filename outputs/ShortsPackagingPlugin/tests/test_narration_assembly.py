import os, sys, json, tempfile, threading, unittest, subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from narration_assembly import NarrationAssembler, validate_captions
from shorts_automator import Cancelled
import opentimelineio as otio

FF=os.environ.get('FFMPEG','ffmpeg');FP=os.environ.get('FFPROBE','ffprobe')
class NarrationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name)
  cls.video=cls.root/'한글 & video.mp4';cls.voice=cls.root/'voice.wav'
  subprocess.run([FF,'-v','error','-f','lavfi','-i','color=blue:s=320x180:r=24:d=1.3','-c:v','libx264',str(cls.video)],check=True)
  subprocess.run([FF,'-v','error','-f','lavfi','-i','sine=frequency=700:sample_rate=48000:duration=2.013','-c:a','pcm_s16le',str(cls.voice)],check=True)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def worker(self):return NarrationAssembler(ffmpeg=FF,ffprobe=FP,width=180,height=320,fps='24000/1001',preset='ultrafast')
 def test_ntsc_roundtrip_and_audio(self):
  r=self.worker().assemble([self.video,self.video],self.voice,self.root/'out')
  self.assertEqual(r['frames'],49);self.assertEqual(sum(c['frames'] for c in r['clips']),49)
  timeline=otio.adapters.read_from_file(r['otio'])
  self.assertEqual(timeline.duration().value,49)
  xml=ET.parse(r['xml']);seq=xml.find('.//sequence')
  self.assertEqual(seq.findtext('duration'),'49')
  self.assertEqual(seq.findtext('./media/video/format/samplecharacteristics/width'),'180')
  self.assertEqual(len(seq.findall('./media/audio/track/clipitem')),1)
  track=seq.findall('./media/video/track/clipitem')
  self.assertEqual(track[0].findtext('end'),track[1].findtext('start'))
  parsed=otio.adapters.read_from_file(r['xml'],adapter_name='fcp_xml')
  self.assertAlmostEqual(parsed.duration().to_seconds(),49/(24000/1001),places=6)
  # Check the generated sine remains present, not just an audio stream header.
  raw=subprocess.check_output([FF,'-v','error','-i',r['final'],'-map','0:a:0','-f','s16le','-'])
  self.assertGreater(len(raw),48000);self.assertNotEqual(set(raw),{0})
 def test_insufficient_footage_does_not_publish(self):
  dest=self.root/'too-short'
  with self.assertRaisesRegex(ValueError,'Not enough'):self.worker().assemble([self.video],self.voice,dest)
  self.assertFalse(dest.exists())
 def test_cancel_before_start(self):
  event=threading.Event();event.set()
  with self.assertRaises(Cancelled):self.worker().assemble([self.video],self.voice,self.root/'cancel',cancel_event=event)
 def test_reject_missing_input(self):
  with self.assertRaises(ValueError):self.worker().assemble([],self.voice,self.root/'none')
 def test_subtitle_bounds_and_overlap(self):
  p=self.root/'bad.srt';p.write_text('1\n00:00:00,000 --> 00:00:03,000\n자막\n')
  with self.assertRaises(ValueError):validate_captions(p,2000)
  p.write_text('1\n00:00:00,000 --> 00:00:01,000\n첫 문장\n\n2\n00:00:00,500 --> 00:00:01,500\n겹침\n')
  with self.assertRaises(ValueError):validate_captions(p,2000)
 def test_valid_unicode_subtitle(self):
  p=self.root/'good.srt';p.write_text('\ufeff1\n00:00:00,000 --> 00:00:01,000\n한국어 자막\n')
  subs,warnings=validate_captions(p,2000)
  self.assertEqual(subs[0].plaintext,'한국어 자막');self.assertEqual(warnings,[])
