# vvideo

Premiere Pro용 Mac 패널과 영화 소개 영상 자동화 실험을 모은 저장소입니다.
2026-10-09까지 만든 소스·검수 기록·합성음성 비교 샘플을 보관합니다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `work/gpt-translator/` | GPT Translator CEP 패널, SRT 번역, 타임코드 보존, Mac 설치/제거 스크립트 |
| `work/link-import/` | 영상 URL 다운로드와 Premiere 가져오기 CEP 패널, 엔진 설치 스크립트 |
| `outputs/ShortsPackagingPlugin/` | 장면 분할, 세로 영상 처리, 짧은 컷 제외, FCP XML, 백그라운드 호출, 최종 MP4 변환 |
| `work/narration/` | macOS 음성 생성, 원음 덕킹, 나레이션 믹싱, 편집 XML 및 검증 실험 |
| `work/qwen-narration/` | Qwen3-TTS 소희 음성 생성 및 말투 비교 |
| `work/omnivoice-narration/` | OmniVoice 남성/여성 음성 생성 |
| `outputs/Narration_Voice_Sample/` | 실제 생성한 합성음성 비교 파일 및 설정 |
| `outputs/Movie_Audit*`, `outputs/Movie_Narrated/` | 기존 샘플 영상의 검수 기록과 대본 |

기존 스크립트의 상대경로를 보존하려고 원래 `work/`, `outputs/` 구조를 유지했습니다. 통합 제품 설치 프로그램이나 VideoComeOn Local 연동이 완성된 상태는 아닙니다.

## 실행 안내

- 번역 패널: `work/gpt-translator/README.md`와 `docs/CEP_COMPATIBILITY.md` 참고. API 키는 사용자가 로컬에서 설정합니다.
- 링크 패널: `work/link-import/README_KO.md` 참고. 실행 바이너리는 저장소에서 제외했습니다. Apple Silicon Mac에서 `bash work/link-import/Setup_Engines.command`로 버전과 해시를 고정한 엔진을 준비합니다.
- 쇼츠 모듈: `outputs/ShortsPackagingPlugin/README_KO.md` 참고. Python 의존성과 FFmpeg/ffprobe가 필요합니다.
- 추가 자동화: [실행 안내](outputs/ShortsPackagingPlugin/AUTOMATION_KO.md). OpenTimelineIO 기반 나레이션 길이 조립, MLX Whisper 한국어 자막, pysubs2 자막 검사, RapidFuzz 대사 검색을 지원합니다. 편집과 ASR은 각각 별도 가상환경을 사용합니다.
- Qwen/OmniVoice: Apple Silicon용 Python 3.12 가상환경을 `work/qwen-tts-venv`에 만들고 `mlx-audio==0.5.8`, `scipy`를 설치합니다. 위 엔진 준비 후 저장소 루트에서 해당 폴더의 `generate*.py`를 실행합니다. 첫 실행 시 Hugging Face 모델을 다운로드하며 이후 로컬에서 생성합니다.
- macOS 나레이션 조립 실험은 별도로 준비한 `outputs/Movie_Fixed_Master.mov` 등 로컬 입력 파일을 전제로 합니다. 영화 파일은 이 저장소에 포함하지 않습니다.

## 현재 상태와 한계

- 컷 분할, 세로 화면 처리, PCM 오디오와 FCP XML, Premiere 샘플 가져오기 및 렌더 검증을 수행했습니다. 세부 범위는 각 검수 문서에 기록했습니다.
- 영화 전체를 자동으로 이해하고 대본과 장면을 맞추는 완성형 리뷰 제작기는 아닙니다. 영상 검수는 일부 구간 샘플에 한정됩니다.
- 음성 샘플은 모두 합성음성입니다. 기본 macOS 음성, Edge 현수, Qwen 소희, OmniVoice를 비교했습니다. 사용자 피드백상 나레이션 자연스러움은 아직 개선 중이며 최종 보이스는 확정하지 않았습니다.
- Typecast/ElevenLabs 직접 API 연동은 아직 구현하지 않았습니다. vidIQ 음성 생성은 크레딧 부족으로 완료되지 않았습니다.
- 기술적인 디코딩/길이 검증은 청취 품질 보증이 아닙니다.

## 보관 범위

API 키, `.env` 파일, 개인 인증정보, 가상환경, 캐시, 다운로드 모델, FFmpeg 등 바이너리, 영화 원본/편집본, Premiere 프로젝트는 제외했습니다. 영화 영상 결과물은 원래 Mac 작업 폴더에 그대로 있습니다.
검수 문서의 개인 절대경로는 `${WORKSPACE}` 또는 `${USER_HOME}`으로 치환했습니다. 생성 샘플의 JSON과 대본은 재현 참고 자료입니다.

## 테스트

```sh
(cd work/gpt-translator && node --test tests/*.test.js)
node --test work/link-import/tests/engine.test.cjs
# requirements-automation.txt와 ffmpeg/ffprobe가 준비된 환경:
python -m unittest discover -s outputs/ShortsPackagingPlugin/tests -v
```

## 외부 구성요소

- [PySceneDetect](https://github.com/Breakthrough/PySceneDetect)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/), [Deno](https://github.com/denoland/deno)
- [edge-tts](https://github.com/rany2/edge-tts)
- [MLX-Audio](https://github.com/Blaizzy/mlx-audio), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [OmniVoice](https://github.com/k2-fsa/OmniVoice)

외부 코드·모델에는 각 프로젝트의 라이선스가 적용됩니다. 엔진 관련 고지는 `work/link-import/LinkImport/licenses/`에 보관했습니다.
