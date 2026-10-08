# TTS · 한국어 장면 검색 · Premiere XML 보완

## 바뀐 부분

- `natural_narration.py`: OpenAI TTS. 기본은 요청한 `tts-1`, `nova`, 속도 1.0입니다. WAV/MP3를 확장자와 일치하게 생성하며 기존 파일을 덮어쓰지 않습니다. 중간 실패 파일은 제거하고, API 오류 본문과 인증정보는 출력하지 않습니다. 자동 재시도는 꺼 두었습니다.
- `semantic_scenes.py`: 한국어 텍스트 모델과 이미지 모델을 별도로 사용합니다. 컷마다 20%, 50%, 80% 지점의 프레임을 추출하고 코사인 유사도의 평균으로 정렬합니다. 모델은 객체당 한 번 로드하며 같은 인덱스에 여러 문장을 검색할 수 있습니다. 파일이 잘못되면 제외 사유를 반환합니다.
- `premiere_xml.py`: 명시적인 Video/Audio 트랙, 정수 프레임 범위, 미디어 참조를 검증하고 FCP XML을 내보냅니다. 모노 WAV도 오디오로 처리합니다. 프레임레이트가 다르면 숫자만 바꾸지 않고 오류를 반환합니다. `narration_assembly.py`에서 자동 호출합니다.
- MKV의 스트림 `DURATION` 태그를 읽도록 기존 조립 모듈을 보완했습니다.

## 설치와 호출

저장소 루트, Python 3.12 기준입니다. 기존 편집 환경과 분리합니다.

```sh
python3.12 -m venv work/intelligence-venv
work/intelligence-venv/bin/python -m pip install -r outputs/ShortsPackagingPlugin/requirements-intelligence.txt

# OPENAI_API_KEY가 설정된 프로세스에서 실행. 키를 코드나 Git에 넣지 않습니다.
work/intelligence-venv/bin/python outputs/ShortsPackagingPlugin/natural_narration.py \
  /absolute/path/script.txt /absolute/path/narration.wav --model tts-1 --voice nova

# 영상은 로컬에서 분석. 첫 실행에는 모델 다운로드가 필요합니다.
work/intelligence-venv/bin/python outputs/ShortsPackagingPlugin/semantic_scenes.py \
  '어두운 방 안에서 대화하는 사람들' /absolute/path/scene-001.mp4 /absolute/path/scene-002.mp4 \
  --ffmpeg "$PWD/work/link-import/LinkImport/bin/ffmpeg" \
  --ffprobe "$PWD/work/link-import/LinkImport/bin/ffprobe" > /absolute/path/candidates.json
```

생성한 음성과 선택한 `candidates[].path`를 기존 `narration_assembly.py`에 전달하면 XML·OTIO·최종 MP4를 만듭니다. 전체 명령은 `AUTOMATION_KO.md`를 참고하세요. 편집 환경과 지능 모듈 환경 사이에는 파일 경로와 JSON을 전달하므로 의존성 충돌을 피할 수 있습니다.

파이썬에서는 `SemanticSceneSelector.index(clips)` 후 `rank(text)` 또는 `select_best_scene(text)`를 호출합니다. `minimum`으로 최소 유사도를, `exclude`로 이미 사용한 컷을 지정할 수 있습니다. 조건에 맞는 컷이 없으면 순위는 빈 목록, 최상위 선택은 `None`입니다. `index()`는 다음 호출까지 메모리에만 유지됩니다. GUI에서는 별도 작업 프로세스에서 호출하세요. 인덱싱/모델 다운로드의 중간 취소 및 진행률 UI는 아직 없습니다.

## 목소리 설정

`tts-1-hd`와 `gpt-4o-mini-tts`도 선택할 수 있습니다. `tts-1` 계열은 감정 지시문을 지원하지 않으므로 `--instructions`와 함께 쓰면 호출 전에 오류를 반환합니다. `gpt-4o-mini-tts`는 `--instructions`를 지원하지만, 이번 실제 API 검증은 `tts-1/nova`만 수행했습니다. 모델별 한국어 자연스러움 비교를 완료했다는 의미는 아닙니다.

TTS는 합성음성이며, 이 모듈을 포함한 서비스에서 사용자가 AI 음성임을 알 수 있게 표시해야 합니다. 음성 생성은 대본을 OpenAI API로 전송하고 사용량이 발생합니다. 장면 검색은 영상 프레임을 외부 API로 전송하지 않습니다. CLI는 `.env`를 자동 탐색하지 않으며 호출자가 승인된 키를 환경변수로 전달합니다.

## 검수 결과 (2026-10-09)

- 전체 Python 테스트 **34개 통과**. 실제 FFmpeg 조립, XML 왕복, NTSC 경계, MKV 길이, API 실패 후 정리, 덮어쓰기 방지, 인코더 분리, 후보 제외/임계값 등을 포함합니다.
- 기존 키로 한국어 `tts-1/nova` 샘플 생성: PCM WAV, 24 kHz, 모노, 8.825초. 자연스러움 청취 평가는 미완료입니다.
- 영화 샘플 3개를 실제 CLIP 모델로 검색했습니다. 시험 문장 `어두운 방 안에서 대화하는 사람들`의 순위: late 0.24177, early 0.23754, middle 0.21210. 상위 두 점수 차이가 작으며 정확도를 입증하는 평가가 아닙니다.
- 검색 1위 컷과 새 음성으로 1080×1920, 24000/1001 fps, **212프레임 / 8.84217초** 편집본 생성. 프레임 수, 음성 길이, 전체 디코딩 검사 통과.
- **Premiere Pro 2026 실제 가져오기 성공.** 별도 `VVideo_XML_Check_20261009` 프로젝트에서 `Narration_Assembly`를 열고 V1 영상, A1 파형, 시작 0, 종료 타임코드 `00:00:08:20`을 확인했습니다. 저장된 프로젝트의 FrameRect도 1080×1920으로 확인했습니다. Premiere 자체 재렌더 및 발음별 싱크 청취 검사는 수행하지 않았습니다.

음성과 결과 영상, Premiere 프로젝트는 로컬에 보관합니다. API 키·원본 영화·모델 가중치는 Git에 포함하지 않습니다.

## 한계

CLIP은 화면과 문장의 시각적 유사도를 비교합니다. 등장인물 관계, 사건의 인과관계, 반전·스포일러를 이해하는 영화 편집기는 아닙니다. 점수는 확률이 아니며 모든 결과에 `requires_review=true`를 붙입니다. 문장별 나레이션 시간에 맞춘 다중 컷 자동 배치까지 통합하지는 않았습니다. 현재 조립은 선택된 컷 순서를 따릅니다.

XML 내보내기는 같은 프레임레이트로 변환한 영상과 별도 48 kHz 모노 나레이션 전용입니다. 일반 OTIO 파일의 중첩, 전환, 속도 효과, 트랙 트림은 지원하지 않으며 명시적으로 거부합니다. 형식 메타데이터를 실제 미디어에 맞추는 작업은 호출자의 책임이고, 기본 조립 모듈은 변환 후 검사합니다.

## 공식 자료

- [OpenAI TTS](https://developers.openai.com/api/docs/guides/text-to-speech), [OpenAI Python SDK](https://github.com/openai/openai-python)
- [다국어 CLIP 모델의 두 인코더 사용 예제](https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1), [Sentence Transformers](https://github.com/huggingface/sentence-transformers)
- [OTIO FCP 어댑터](https://github.com/OpenTimelineIO/otio-fcp-adapter)
