from pathlib import Path
import json,subprocess,numpy as np
root=Path.cwd();out=root/'outputs/Movie_Narrated';ff=str(root/'work/link-import/LinkImport/bin/ffmpeg');fp=str(root/'work/link-import/LinkImport/bin/ffprobe');movie=out/'The_Killers_60s_Narrated.mp4'
d=json.loads(subprocess.check_output([fp,'-v','error','-show_streams','-of','json',str(movie)]));v=next(s for s in d['streams'] if s['codec_type']=='video');a=next(s for s in d['streams'] if s['codec_type']=='audio');assert int(v['nb_frames'])==1440
assert v['avg_frame_rate']=='24000/1001';assert abs(float(a['duration'])-60.06)<.01
subprocess.run([ff,'-v','error','-xerror','-i',str(movie),'-f','null','-'],check=True)
def decode(p):
 return np.frombuffer(subprocess.check_output([ff,'-v','error','-i',str(p),'-vn','-ac','1','-ar','16000','-f','f32le','-']),dtype='<f4')
voice=decode(out/'Narration_KO.wav');bed=decode(out/'Original_Ducked.wav');mixed=decode(movie);rows=json.loads((out/'timing.json').read_text());checks=[]
for r in rows:
 start,end=round(r['start']*16000),round(r['end']*16000);x=voice[start:end];y=mixed[start:end];b=bed[start:end]
 active=np.abs(x)>.02
 vrms=float(np.sqrt(np.mean(x[active]**2)));brms=float(np.sqrt(np.mean(b[active]**2)))
 corr=float(np.corrcoef(x,y)[0,1]);assert corr>.9
 checks.append(dict(start=r['start'],end=r['end'],voice_correlation=corr,voice_over_background_db=20*np.log10(vrms/(brms+1e-12))))
result=dict(frames=1440,duration=60.06,voice='macOS Yuna synthetic Korean',peak=float(np.max(np.abs(mixed))),segments=checks)
(out/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
