from pathlib import Path
import subprocess,sys
root=Path.cwd();out=root/'outputs/Movie_Narrated';ff=str(root/'work/link-import/LinkImport/bin/ffmpeg');fp=str(root/'work/link-import/LinkImport/bin/ffprobe')
subprocess.run([ff,'-v','error','-y','-i',str(root/'outputs/Movie_Fixed_Master.mov'),'-i',str(out/'Narration_KO.wav'),'-filter_complex','[0:a]loudnorm=I=-28:TP=-8:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=60.06,afade=t=in:d=0.3,afade=t=out:st=58.5:d=1.56[bed];[bed][1:a]sidechaincompress=threshold=0.1:ratio=3:attack=20:release=350[duck]','-map','[duck]','-ar','48000','-ac','2','-c:a','pcm_s16le',str(out/'Original_Ducked.wav')],check=True)
subprocess.run([ff,'-v','error','-n','-i',str(out/'Picture_60s.mp4'),'-i',str(out/'Narration_KO.wav'),'-i',str(out/'Original_Ducked.wav'),'-filter_complex','[1:a][2:a]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false:latency=true[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','pcm_s16le','-ar','48000','-t','60.06',str(out/'Narrated_Master.mov')],check=True)
sys.path.insert(0,str(root/'outputs/ShortsPackagingPlugin'))
from export_delivery import export_mp4
export_mp4(out/'Narrated_Master.mov',out/'The_Killers_60s_Narrated.mp4',ffmpeg=ff,ffprobe=fp)
