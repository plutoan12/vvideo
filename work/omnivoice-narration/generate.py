from pathlib import Path
import json,time,subprocess
import mlx.core as mx
import numpy as np
from scipy.io.wavfile import write
from mlx_audio.tts.utils import load_model
root=Path(__file__).resolve().parents[2]
out=root/'outputs/Narration_Voice_Sample/OmniVoice'
model_id='mlx-community/OmniVoice-bf16'
print('Loading',model_id,flush=True)
model=load_model(model_id)
text='같은 이야기인데, 감독이 바뀌면 얼마나 달라질까요? 더 킬러스는 그걸 비교해 보는 영화예요.'
records=[]
for name,instruct in [('Male','male, adult, low pitch'),('Female','female, adult, moderate pitch')]:
 mx.random.seed(42)
 start=time.monotonic()
 print('Generating',name,flush=True)
 results=list(model.generate(text=text,language='ko',instruct=instruct,duration_s=9.5,num_steps=64))
 data=np.concatenate([np.asarray(r.audio).reshape(-1) for r in results]);sr=results[0].sample_rate
 assert np.isfinite(data).all() and np.abs(data).max()>0.005
 raw=root/'work/omnivoice-narration'/f'{name}_raw.wav';write(raw,sr,data.astype(np.float32))
 dest=out/f'OmniVoice_{name}.wav'
 subprocess.run([str(root/'work/link-import/LinkImport/bin/ffmpeg'),'-v','error','-y','-i',str(raw),'-af','loudnorm=I=-18:TP=-2:LRA=11','-ar','24000','-c:a','pcm_s16le',str(dest)],check=True)
 record=dict(file=dest.name,model=model_id,instruct=instruct,text=text,synthetic=True,reference_audio=None,steps=64,duration=len(data)/sr,elapsed=time.monotonic()-start)
 records.append(record);print(json.dumps(record,ensure_ascii=False),flush=True)
(out/'settings.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
