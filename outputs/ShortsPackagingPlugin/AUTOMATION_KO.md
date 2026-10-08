# GitHub 기반 자동화 보완

기존 컷 분할 모듈에 나레이션 기준 조립, 음성 인식 자막, 대사 검색을 추가했습니다. 외부 프로젝트 소스를 복사한 것이 아니라 아래 패키지의 공개 API를 사용합니다.

## 채택한 프로젝트

| 프로젝트 | 적용 위치 | 버전 / 라이선스 |
| --- | --- | --- |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 영상·나레이션 트랙과 프레임 단위 편집 구조 | 0.18.1 / Apache-2.0 |
| [otio-fcp-adapter](https://github.com/OpenTimelineIO/otio-fcp-adapter) | FCP XML 읽기·쓰기 | 1.0.0 / Apache-2.0 |
| [pysubs2](https://github.com/tkarabela/pysubs2) | SRT 생성, 겹침·길이 검사 | 1.9.0 / MIT |
| [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) | Apple Silicon 로컬 한국어 음성 인식과 단어 시간 추정 | 0.4.3 / MIT |
| [RapidFuzz](https://github.com/rapidfuzz/RapidFuzz) | 자막에서 비슷한 대사의 위치 검색 | 3.14.6 / MIT |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | 기존 장면 경계 검출 | 0.6.7.1 / BSD-3-Clause |

[WhisperX](https://github.com/m-bain/whisperX)도 조사했지만, 이번 Mac 구현에는 MLX Whisper를 채택했습니다. 패키지 라이선스와 모델의 이용 조건은 별도로 확인해야 합니다.

## 설치

저장소 루트에서 Python 3.12로 실행합니다. FFmpeg/ffprobe는 기존 엔진 설치 스크립트로 준비합니다. ASR과 편집 환경을 나눈 이유는 PySceneDetect 0.6.x와 최신 Hugging Face CLI의 Click 버전 조건이 충돌하기 때문입니다.

```sh
python3.12 -m venv work/automation-venv
work/automation-venv/bin/python -m pip install -r outputs/ShortsPackagingPlugin/requirements-automation.txt
python3.12 -m venv work/asr-venv
work/asr-venv/bin/python -m pip install -r outputs/ShortsPackagingPlugin/requirements-asr-mac.txt
bash work/link-import/Setup_Engines.command
```

ASR은 Apple Silicon Mac에서 실행합니다. 첫 실행에는 Hugging Face 모델 다운로드가 필요하며 이후 로컬에서 음성을 처리합니다. 입력 전체를 메모리에 디코딩하므로 긴 영화는 구간별로 나누어 처리하는 것을 권장합니다. 자막 생성 CLI는 동기식이며 GUI에서는 별도 프로세스로 호출해야 합니다.

## 실행 순서

```sh
# 1. 실제 나레이션 음성에서 자막 생성
work/asr-venv/bin/python outputs/ShortsPackagingPlugin/caption_tools.py transcribe \
  /absolute/path/narration.wav /absolute/path/results \
  --ffmpeg "$PWD/work/link-import/LinkImport/bin/ffmpeg"

# 2. 반환된 captions-* 폴더의 SRT 사용. 클립은 원하는 순서로 명시합니다.
work/automation-venv/bin/python outputs/ShortsPackagingPlugin/narration_assembly.py \
  /absolute/path/narration.wav /absolute/path/results \
  /absolute/path/clip-001.mov /absolute/path/clip-002.mov \
  --captions /absolute/path/results/captions-ID/captions.srt \
  --fps 24000/1001 \
  --ffmpeg "$PWD/work/link-import/LinkImport/bin/ffmpeg" \
  --ffprobe "$PWD/work/link-import/LinkImport/bin/ffprobe"

# 3. 원본 대사 자막이 있으면 관련 대사의 시간 검색
work/automation-venv/bin/python outputs/ShortsPackagingPlugin/caption_tools.py search \
  /absolute/path/movie-subtitles.srt '찾을 대사'
```

대사 검색은 문자열 유사도 검색입니다. 영화 장면을 시각적으로 이해하거나 검색 결과를 자동으로 편집에 삽입하지 않습니다. 검색 시각의 기준은 입력한 자막 파일입니다.

## 결과와 UI 연동

각 조립은 독립된 `assembly-*` 폴더를 만들고 다음을 저장합니다.

- `final.mp4`: 기본 1080×1920 영상과 나레이션. 기본 화면 배치는 전체 화면 보존 + 블러 배경입니다.
- `master.mov`: H.264 영상과 PCM 음성 마스터.
- `assembly.xml`, `timeline.otio`: 영상과 나레이션을 따로 편집할 수 있는 타임라인.
- `clip-*.mp4`, `narration.wav`: 타임라인이 참조하는 미디어. XML만 옮기지 말고 폴더를 함께 보관하세요.
- `captions.srt`: 입력한 자막이 있을 때 저장. 영상에 자막을 굽거나 XML 자막 트랙을 만드는 기능은 아직 없습니다.
- `result.json`: 프레임 수·음성 길이·전체 디코딩 검사가 성공한 경우에만 생성. 실패는 `failure.json`에 기록됩니다.

`NarrationAssembler.start(clips, narration, output, on_progress=callback)`은 기존 모듈과 같은 백그라운드 Job을 반환합니다. 콜백에서 UI 위젯을 직접 갱신하지 말고 GUI 프레임워크의 메인 스레드 이벤트로 전달하세요. `job.cancel()`로 취소를 요청합니다. 이 조립 모듈의 `job.future.result()`는 성공 시 결과 딕셔너리를 반환하고, 취소 시 `Cancelled`, 실패 시 해당 예외를 발생시킵니다. 기존 컷 분할 모듈의 상태 객체 반환 방식과 구분하세요.

클립은 지정한 순서대로 배치하고 마지막 클립을 나레이션 길이에 맞춥니다. 영상이 부족하면 반복 재생하지 않고 오류를 반환합니다. 원본 영화 오디오는 음소거하며 나레이션은 모노로 정규화합니다. 기존 별도 믹싱 스크립트의 원음 덕킹은 이 모듈에 아직 통합하지 않았습니다.

## 검증 범위와 남은 작업

합성 영상 테스트는 23.976 fps, 끊김 없는 클립 배치, XML 왕복 읽기, 음성 존재, 자막 범위·겹침, 입력 오류와 시작 전 취소를 검사합니다. 한국어 약 10.7초 샘플로 실제 MLX Whisper 실행을 확인했습니다. ASR 결과의 `네 명` → `4명` 같은 표기 차이는 있을 수 있습니다.

자막 시간은 음성 인식의 추정값입니다. 타임스탬프가 유효하다고 발음별 싱크까지 검증된 것은 아닙니다. 새 OTIO 기반 XML의 실제 Premiere 가져오기는 별도 검수가 필요합니다. 이전 자체 XML 생성기의 Premiere 검수 기록과 구분해야 합니다.

의미 기반 장면 선택, 얼굴 추적 크롭, Typecast/ElevenLabs 보이스 연동, 자연스러움 평가, 통합 UI와 자동 업로드는 아직 구현하지 않았습니다.
