import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from caption_tools import captions_from_words,search_dialogue
class CaptionTests(unittest.TestCase):
 def test_word_boundaries_and_gaps(self):
  s=captions_from_words([{'words':[dict(word='안녕',start=0,end=.3),dict(word='세상',start=.3,end=.7),dict(word='다음',start=1.5,end=2)]}],max_chars=5)
  self.assertEqual(len(s),2);self.assertEqual((s[0].start,s[0].end),(0,700));self.assertEqual(s[1].start,1500)
 def test_missing_words_fails(self):
  with self.assertRaises(ValueError):captions_from_words([{'text':'추정만 있는 문장'}])
 def test_invalid_timestamp(self):
  with self.assertRaises(ValueError):captions_from_words([{'words':[dict(word='오류',start=2,end=1)]}])
 def test_korean_search_returns_source_time(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'source.srt';p.write_text('1\n00:00:12,000 --> 00:00:14,000\n문을 열어 주세요\n\n2\n00:00:20,000 --> 00:00:22,000\n오늘 날씨가 좋네요\n')
   results=search_dialogue('문을 열어 주세요',p)
   self.assertEqual(results[0]['start_ms'],12000);self.assertTrue(results[0]['requires_review'])
   self.assertEqual(search_dialogue('xyzabcd',p,minimum=90),[])
