from pathlib import Path
import json, time, subprocess
import numpy as np
import mlx.core as mx
from scipy.io.wavfile import write
from mlx_audio.tts.utils import load_model
root=Path(__file__).resolve().parents[2]
out=root/'outputs/Narration_Voice_Sample/Natural_Comparison'
out.mkdir(parents=True,exist_ok=True)
model_id='mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'
text='같은 이야기인데, 감독이 바뀌면 얼마나 달라질까요? 더 킬러스는 그걸 비교해 보는 영화예요.'
styles=[('A_Calm','담담한 톤','친한 사람 한 명에게 영화를 소개하듯 편안하고 담담하게 말한다. 부드러운 일상 대화체로, 보통 말하는 속도와 자연스러운 호흡을 유지한다. 첫 질문은 가볍게 궁금해하는 느낌으로 말하고 잠깐 쉰다. 마지막 문장은 힘을 빼고 편안하게 마무리한다. 뉴스나 광고를 읽는 억양, 과장된 감정, 음절마다 끊는 발음은 피한다.'),('B_Conversational','대화하는 톤','친구에게 재미있는 영화를 추천하는 자연스러운 한국어 대화처럼 말한다. 같은 이야기인데라는 부분은 가볍게 이야기를 꺼내듯, 얼마나 달라질까요라는 질문에는 은근한 호기심을 담는다. 질문 뒤 짧게 숨을 고른 다음 두 번째 문장을 따뜻하고 친근하게 이어간다. 보통 대화 속도로 말하고 끝맺음은 부드럽게 한다. 연기하듯 과장하거나 아나운서처럼 또박또박 낭독하지 않는다.')]
print('Loading cached model',flush=True)
model=load_model(model_id)
records=[]
for stem,label,instruct in styles:
 mx.random.seed(42)
 started=time.monotonic()
 results=list(model.generate_custom_voice(text=text,speaker='Sohee',language='Korean',instruct=instruct,max_tokens=500,temperature=0.7,verbose=False))
 audio=np.concatenate([np.asarray(r.audio).reshape(-1) for r in results]);sr=results[0].sample_rate
 assert np.isfinite(audio).all() and sr*2<len(audio)<sr*30
 raw=root/'work/qwen-narration'/f'{stem}_raw.wav'
 write(raw,sr,audio.astype(np.float32))
 target=out/f'{stem}.wav'
 subprocess.run([str(root/'work/link-import/LinkImport/bin/ffmpeg'),'-v','error','-y','-i',str(raw),'-af','loudnorm=I=-18:TP=-2:LRA=11','-ar','24000','-c:a','pcm_s16le',str(target)],check=True)
 record=dict(file=target.name,label=label,model=model_id,speaker='Sohee',synthetic=True,text=text,instruction=instruct,seed=42,temperature=0.7,duration=len(audio)/sr,elapsed_seconds=time.monotonic()-started)
 records.append(record); print(json.dumps(record,ensure_ascii=False),flush=True)
(out/'settings.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
(out/'대본.txt').write_text(text+'\n')
