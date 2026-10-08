import sys,tempfile,unittest
from pathlib import Path
from xml.etree import ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fcp_xml import write_xml,frame_rate

class XMLTests(unittest.TestCase):
 def test_gapless_links_unicode_ntsc(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'assembly.xml'
   clips=[dict(path=str(Path(tmp)/'한 글 & 1.mp4'),frames=48,channels=2,sample_rate=48000),dict(path=str(Path(tmp)/'silent.mp4'),frames=24,channels=0,sample_rate=48000),dict(path=str(Path(tmp)/'last.mp4'),frames=72,channels=2,sample_rate=48000)]
   write_xml(clips,p,'쇼츠 & 소스','24000/1001',1080,1920)
   r=ET.parse(p).getroot();seq=r.find('sequence')
   self.assertEqual(seq.findtext('duration'),'144');self.assertEqual(seq.findtext('rate/ntsc'),'TRUE');self.assertEqual(seq.findtext('rate/timebase'),'24')
   video=seq.findall('media/video/track/clipitem')
   self.assertEqual([(int(x.findtext('start')),int(x.findtext('end'))) for x in video],[(0,48),(48,72),(72,144)])
   self.assertIn('%20',video[0].findtext('file/pathurl'));self.assertIn('%26',video[0].findtext('file/pathurl'))
   items={x.attrib['id']:x for x in seq.findall('.//clipitem')}
   for item in items.values():
    for link in item.findall('link'):
     ref=items[link.findtext('linkclipref')]
     self.assertEqual(item.findtext('start'),ref.findtext('start'))
     tr=int(link.findtext('trackindex'));ci=int(link.findtext('clipindex'))
     target=seq.findall('media/'+link.findtext('mediatype')+'/track')[tr-1].findall('clipitem')[ci-1]
     self.assertEqual(target.attrib['id'],ref.attrib['id'])
   for track, value in zip(seq.findall('media/audio/track'), ['-1', '1']):
    for item in track.findall('clipitem'):
     self.assertEqual(item.findtext('filter/effect/parameter/value'),value)
   with self.assertRaises(FileExistsError):write_xml(clips,p,'again',24,1080,1920)
 def test_empty_and_bad_fps(self):
  with self.assertRaises(ValueError):write_xml([], 'unused.xml','empty',24,1080,1920)
  with self.assertRaises(ValueError):frame_rate(27)
  self.assertEqual(str(frame_rate('29.97')),'30000/1001')

if __name__=='__main__':unittest.main()
