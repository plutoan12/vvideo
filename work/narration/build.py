from pathlib import Path
import subprocess,json,numpy as np,sys
from fractions import Fraction
from xml.etree import ElementTree as ET
root=Path.cwd();out=root/'outputs/Movie_Narrated';work=root/'work/narration';ff=str(root/'work/link-import/LinkImport/bin/ffmpeg');fp=str(root/'work/link-import/LinkImport/bin/ffprobe')
rows=json.loads((work/'voice-parts.json').read_text());rate=48000;duration=60.06;total=round(rate*duration);mix=np.zeros(total,dtype='<f4');cursor=round(.65*rate)
for row in rows:
 raw=subprocess.check_output([ff,'-v','error','-i',row['path'],'-af','atempo=0.95','-ar',str(rate),'-ac','1','-f','f32le','-'])
 wave=np.frombuffer(raw,dtype='<f4');row['start']=cursor/rate;row['end']=(cursor+len(wave))/rate
 assert cursor+len(wave)<total
 mix[cursor:cursor+len(wave)]=wave;cursor+=len(wave)+round(.75*rate)
(work/'voice.raw').write_bytes(mix.tobytes())
subprocess.run([ff,'-v','error','-n','-f','f32le','-ar',str(rate),'-ac','1','-i',str(work/'voice.raw'),'-af','loudnorm=I=-16:TP=-2:LRA=7','-ar',str(rate),'-ac','2','-c:a','pcm_s16le',str(out/'Narration_KO.wav')],check=True)
source=root/'outputs/Movie_Fixed_Master.mov'
subprocess.run([ff,'-v','error','-n','-i',str(source),'-i',str(out/'Narration_KO.wav'),'-filter_complex',f'[0:a]volume=0.1,apad,atrim=duration={duration},afade=t=in:d=0.3,afade=t=out:st=58.5:d=1.56[bed];[bed][1:a]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[duck]','-map','[duck]','-ar',str(rate),'-ac','2','-c:a','pcm_s16le',str(out/'Original_Ducked.wav')],check=True)
subprocess.run([ff,'-v','error','-n','-i',str(source),'-an','-vf','tpad=stop_mode=clone:stop_duration=2','-frames:v','1440','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'Picture_60s.mp4')],check=True)
subprocess.run([ff,'-v','error','-n','-i',str(out/'Picture_60s.mp4'),'-i',str(out/'Narration_KO.wav'),'-i',str(out/'Original_Ducked.wav'),'-filter_complex','[1:a][2:a]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false:latency=true[a]','-map','0:v:0','-map','[a]','-c:v','copy','-c:a','pcm_s16le','-ar',str(rate),'-t',str(duration),str(out/'Narrated_Master.mov')],check=True)
sys.path.insert(0,str(root/'outputs/ShortsPackagingPlugin'))
from export_delivery import export_mp4
export_mp4(out/'Narrated_Master.mov',out/'The_Killers_60s_Narrated.mp4',ffmpeg=ff,ffprobe=fp)
from fcp_xml import write_xml,sub,add_rate
xml=out/'Narrated_Editable.xml';fps=Fraction(24000,1001)
write_xml([dict(path=str(out/'Picture_60s.mp4'),frames=1440,channels=0,sample_rate=48000)],xml,'The_Killers_Narrated_60s',fps,1080,1920)
tree=ET.parse(xml);audio=tree.getroot().find('sequence/media/audio')
for stem,label in [('Original_Ducked','원본 오디오 낮춤'),('Narration_KO','한국어 합성 나레이션')]:
 for ch in [1,2]:
  track=sub(audio,'track');item=sub(track,'clipitem',id=f'{stem}-{ch}');sub(item,'name',label);sub(item,'enabled','TRUE');sub(item,'duration',1440);add_rate(item,fps)
  for key,value in [('start',0),('end',1440),('in',0),('out',1440)]:sub(item,key,value)
  file=sub(item,'file',id=stem)
  if ch==1:
   sub(file,'name',stem+'.wav');sub(file,'pathurl',(out/(stem+'.wav')).as_uri());sub(file,'duration',1440);add_rate(file,fps)
   am=sub(sub(file,'media'),'audio');chars=sub(am,'samplecharacteristics');sub(chars,'depth',16);sub(chars,'samplerate',48000);sub(am,'channelcount',2)
  st=sub(item,'sourcetrack');sub(st,'mediatype','audio');sub(st,'trackindex',ch)
  effect=sub(sub(item,'filter'),'effect')
  for k,v in [('name','Audio Pan'),('effectid','audiopan'),('effectcategory','audiopan'),('effecttype','audiopan'),('mediatype','audio')]:sub(effect,k,v)
  par=sub(effect,'parameter')
  for k,v in [('parameterid','pan'),('name','Pan'),('valuemin',-1),('valuemax',1),('value',-1 if ch==1 else 1)]:sub(par,k,v)
ET.indent(tree,space='  ');tree.write(xml,encoding='UTF-8',xml_declaration=True)
(out/'timing.json').write_text(json.dumps([dict(text=r['text'],start=r['start'],end=r['end']) for r in rows],ensure_ascii=False,indent=2))
def tc(t):
 ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000);return f'{h:02}:{m:02}:{s:02},{ms:03}'
(out/'Narration_Paragraphs.srt').write_text('\n\n'.join(f'{i+1}\n{tc(r["start"])} --> {tc(r["end"])}\n{r["text"]}' for i,r in enumerate(rows))+'\n')
print('DONE',duration,'seconds; speech ends',rows[-1]['end'])
