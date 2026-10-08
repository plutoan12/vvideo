from pathlib import Path
import subprocess,json,numpy as np
root=Path('${USER_HOME}/Downloads/LinkImport/video-tM8fqM')
ff=str(Path('work/link-import/LinkImport/bin/ffmpeg').resolve())
def decode(name,t,d,video=False):
 args=[ff,'-v','error','-ss',str(t),'-i',str(root/name),'-t',str(d)]
 if video: args+=['-an','-vf','scale=160:90','-pix_fmt','gray','-f','rawvideo','-']
 else: args+=['-vn','-ac','1','-ar','8000','-f','f32le','-']
 b=subprocess.check_output(args)
 return np.frombuffer(b,dtype=np.uint8).reshape(-1,90,160).astype(float) if video else np.frombuffer(b,dtype='<f4').astype(float)
results=[]
for t in [5,95,195]:
 a=decode('source.mkv',t,8);b=decode('ready.mp4',t,8)
 # Search +/- 100 ms, comparing central 6 s for constant overlap.
 n=min(len(a),len(b));a=a[:n];b=b[:n];x=a[800:-800]; x=x-x.mean()
 fftn=1<<(len(b)+len(x)-1).bit_length()
 conv=np.fft.irfft(np.fft.rfft(b,fftn)*np.fft.rfft(x[::-1],fftn),fftn)
 scores=conv[len(x)-1:len(x)-1+1601]
 offset=int(np.argmax(scores));y=b[offset:offset+len(x)]
 corr=float(np.corrcoef(x,y)[0,1])
 v=decode('source.mkv',t,3,True);w=decode('ready.mp4',t,3,True)
 errors={}
 for lag in range(-3,4):
  i=3;j=min(len(v),len(w))-3
  errors[lag]=float(np.mean((v[i:j]-w[i+lag:j+lag])**2))
 best=min(errors,key=errors.get)
 r={'at_seconds':t,'audio_offset_ms':(offset-800)/8,'audio_correlation':corr,'video_best_offset_frames':best,'video_rmse_at_zero':errors[0]**.5}
 results.append(r);print(json.dumps(r),flush=True)
Path('work/link-import/sync-audit.json').write_text(json.dumps(results,indent=2))
