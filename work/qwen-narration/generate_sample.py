from pathlib import Path
import json, time
import numpy as np
import mlx.core as mx
from scipy.io.wavfile import write
from mlx_audio.tts.utils import load_model
root=Path(__file__).resolve().parents[2]
out=root/'outputs/Narration_Voice_Sample'
model_id='mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'
text='같은 이야기를 네 명의 감독에게 맡기면, 어떤 영화가 나올까요? 더 킬러스는 그 차이를 보는 재미가 있는 영화입니다.'
instruct='Speak in natural Korean, as a calm movie reviewer talking to one listener. Warm, conversational, unhurried but not slow. Use subtle curiosity in the first question and relaxed sentence endings. Avoid an announcer tone and exaggerated emotion.'
print('Loading model', model_id, flush=True)
model=load_model(model_id)
print('Speakers:', model.get_supported_speakers(), flush=True)
mx.random.seed(42)
started=time.monotonic()
results=list(model.generate_custom_voice(text=text,speaker='Sohee',language='Korean',instruct=instruct,max_tokens=600,temperature=0.7,verbose=True))
audio=np.concatenate([np.asarray(r.audio).reshape(-1) for r in results])
sr=results[0].sample_rate
assert len(audio)>sr and np.isfinite(audio).all()
peak=float(np.abs(audio).max())
if peak>0.98: audio=audio*0.98/peak
write(out/'Qwen_Sohee_review_sample.wav',sr,(audio*32767).astype(np.int16))
metadata=dict(model=model_id,speaker='Sohee',synthetic=True,text=text,instruction=instruct,duration=len(audio)/sr,sample_rate=sr,elapsed_seconds=time.monotonic()-started,peak_before_normalization=peak)
(out/'Qwen_Sohee_review_sample.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
print(json.dumps(metadata,ensure_ascii=False,indent=2),flush=True)
