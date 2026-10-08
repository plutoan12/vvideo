import sys, os, tempfile, unittest, subprocess, threading, json, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from shorts_automator import ShortsPackagingPlugin
FF=os.environ.get('FFMPEG', 'ffmpeg')
FP=os.environ.get('FFPROBE', 'ffprobe')

class Integration(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory()
  cls.root=Path(cls.tmp.name)
  cls.source=cls.root/'movie.mp4'
  args=[FF,'-v','error','-f','lavfi','-i','color=red:s=320x180:r=30:d=2','-f','lavfi','-i','color=blue:s=320x180:r=30:d=0.5','-f','lavfi','-i','color=green:s=320x180:r=30:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4.5','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-c:a','aac',str(cls.source)]
  subprocess.run(args,check=True)
  cls.silent=cls.root/'portrait.MP4'
  subprocess.run([FF,'-v','error','-f','lavfi','-i','color=yellow:s=180x320:r=30:d=2','-c:v','libx264',str(cls.silent)],check=True)
 @classmethod
 def tearDownClass(cls): cls.tmp.cleanup()
 def plugin(self,**kw):
  options=dict(ffmpeg=FF,ffprobe=FP,width=180,height=320,preset='ultrafast');options.update(kw)
  return ShortsPackagingPlugin(**options)
 def test_split_crop_audio_and_isolation(self):
  out=self.root/'out';out.mkdir(exist_ok=True)
  existing=out/'keep.mp4';existing.write_bytes(b'untouched')
  events=[];p=self.plugin()
  r=p.process_single_movie(self.source,out,on_progress=events.append)
  self.assertEqual(r.status,'completed',r.error);self.assertEqual(len(r.clips),2);self.assertEqual(r.skipped,1)
  self.assertEqual(existing.read_bytes(),b'untouched')
  for clip in r.clips:
   d=p._probe(clip,threading.Event());v=next(s for s in d['streams'] if s['codec_type']=='video')
   self.assertEqual((v['width'],v['height']),(180,320));self.assertTrue(any(s['codec_type']=='audio' for s in d['streams']))
   self.assertAlmostEqual(float(d['format']['duration']),2,delta=.08)
  r2=p.process_single_movie(self.source,out)
  self.assertNotEqual(r.output_dir,r2.output_dir);self.assertTrue(all(Path(x).exists() for x in r.clips))
  self.assertEqual(events[-1].stage,'completed')
 def test_silent_single_scene_portrait(self):
  r=self.plugin().process_single_movie(self.silent,self.root/'silent')
  self.assertEqual(r.status,'completed',r.error);self.assertEqual(len(r.clips),1)
 def test_all_short(self):
  r=self.plugin(min_duration=10).process_single_movie(self.source,self.root/'empty')
  self.assertEqual(r.status,'empty');self.assertFalse(r);self.assertEqual(r.clips,[])
 def test_missing_input(self):
  r=self.plugin().process_single_movie(self.root/'missing.mp4',self.root/'missing')
  self.assertEqual(r.status,'failed');self.assertFalse((self.root/'missing').exists())
 def test_background_cancel_during_render(self):
  cancel=threading.Event()
  def progress(e):
   if e.stage=='rendering':cancel.set()
  r=self.plugin().process_single_movie(self.source,self.root/'cancel',on_progress=progress,cancel_event=cancel)
  self.assertEqual(r.status,'cancelled');self.assertEqual([x for x in Path(r.output_dir).iterdir() if x.suffix in {'.mp4','.mov'}],[])
 def test_background_and_batch(self):
  p=self.plugin();job=p.start_single(self.silent,self.root/'background')
  r=job.future.result(timeout=30);self.assertEqual(r.status,'completed',r.error)
  results=p.run_batch(self.root,self.root/'batch')
  self.assertEqual(len(results),2);self.assertTrue(all(r.status=='completed' for r in results))
 def test_process_timeout(self):
  p=self.plugin(process_timeout=.2)
  with self.assertRaises(TimeoutError):p._run([sys.executable,'-c','import time; time.sleep(5)'],threading.Event())
 def test_active_process_cancel(self):
  p=self.plugin();cancel=threading.Event();timer=threading.Timer(.2,cancel.set);timer.start()
  from shorts_automator import Cancelled
  with self.assertRaises(Cancelled):p._run([sys.executable,'-c','import time; time.sleep(5)'],cancel)
  timer.join()
 def test_validation(self):
  for kwargs in [{'threshold':float('nan')},{'min_duration':-1},{'crf':60},{'preset':'bad'}]:
   with self.assertRaises(ValueError):self.plugin(**kwargs)

if __name__=='__main__':unittest.main(verbosity=2)
