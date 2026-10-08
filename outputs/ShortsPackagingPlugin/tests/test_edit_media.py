import sys,os,unittest,tempfile,subprocess,threading
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from shorts_automator import ShortsPackagingPlugin
FF=os.environ.get('FFMPEG','ffmpeg');FP=os.environ.get('FFPROBE','ffprobe')
class EditMedia(unittest.TestCase):
 def test_pcm_letterbox_and_edge_subjects(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);src=p/'edges.mov'
   subprocess.run([FF,'-v','error','-f','lavfi','-i','color=blue:s=320x180:r=24:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-vf','drawbox=x=0:y=0:w=40:h=180:c=red:t=fill,drawbox=x=280:y=0:w=40:h=180:c=green:t=fill,drawbox=x=0:y=0:w=320:h=22:c=black:t=fill,drawbox=x=0:y=158:w=320:h=22:c=black:t=fill','-c:v','libx264','-c:a','pcm_s16le',str(src)],check=True)
   plugin=ShortsPackagingPlugin(ffmpeg=FF,ffprobe=FP,width=180,height=320,preset='ultrafast')
   r=plugin.process_single_movie(src,p/'out');self.assertEqual(r.status,'completed',r.error)
   self.assertTrue(r.clips[0].endswith('.mov'));self.assertGreaterEqual(r.scene_crops[0]['top'],16);self.assertGreaterEqual(r.scene_crops[0]['bottom'],16)
   info=plugin._probe(r.clips[0],threading.Event());a=next(s for s in info['streams'] if s['codec_type']=='audio');self.assertEqual(a['codec_name'],'pcm_s16le')
   data=subprocess.check_output([FF,'-v','error','-ss','0.5','-i',r.clips[0],'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);im=np.frombuffer(data,dtype=np.uint8).reshape(320,180,3)
   self.assertGreater(int(im[160,5,0]),150);self.assertGreater(int(im[160,174,1]),70)
   self.assertGreater(float(im[:10].mean()),5) # filled background, not a black letterbox
   self.assertTrue(Path(r.xml_path).is_file())
   from export_delivery import export_mp4
   delivery=p/'delivery.mp4'
   export_mp4(r.clips[0],delivery,ffmpeg=FF,ffprobe=FP)
   with self.assertRaises(FileExistsError):export_mp4(r.clips[0],delivery,ffmpeg=FF,ffprobe=FP)
   with self.assertRaises(ValueError):export_mp4(delivery,p/'bad.mp4',ffmpeg=FF,ffprobe=FP)
   waves=[]
   for path in [r.clips[0],str(delivery)]:
    raw=subprocess.check_output([FF,'-v','error','-ss','0.2','-i',path,'-t','1','-vn','-ac','1','-ar','48000','-f','f32le','-'])
    waves.append(np.frombuffer(raw,dtype='<f4'))
   self.assertGreater(float(np.corrcoef(waves)[0,1]),.99)

 def test_legacy_and_bad_layout(self):
  p=ShortsPackagingPlugin(media_format='mp4',layout='center',trim_bars=False)
  self.assertEqual(p._bar_crop(None,0,1,320,180,threading.Event()),(0,0))
  with self.assertRaises(ValueError):ShortsPackagingPlugin(layout='bad')
if __name__=='__main__':unittest.main()
