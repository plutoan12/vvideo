# 영화 소개 영상 전처리 모듈

`ShortsPackagingPlugin`은 영화 소개 영상 제작의 **장면 분할 → 검은 띠 정리 → 9:16 화면 배치 → 짧은 장면 제외 → XML 생성** 단계입니다. 소개 대본·내레이션·자막·이야기 순서 편집을 생성하지 않습니다.

## 2026-10-09 수정본의 기본 설정

- 편집 소스: `.mov`, H.264 영상 + 48kHz 스테레오 PCM 오디오.
- 화면: `layout="fit_blur"`. 원본 가로 화면 전체를 보여주고 남는 세로 공간은 흐린 배경으로 채웁니다. 인물 추적은 아니며, 가로 영상이 중앙에 작게 보이는 구성입니다.
- `trim_bars=True`: 컷의 20%·50%·80% 위치를 검사하고 공통으로 확인된 위아래 어두운 띠를 보수적으로 제거합니다. 좌우는 제거하지 않습니다. 모호하거나 비대칭인 경우 원본 영역을 유지합니다. 소량의 안전 여백이 남을 수 있고, 어두운 연출/자막/화면비 변경에는 검수가 필요합니다. `trim_bars=False`로 끌 수 있습니다.
- 이전 방식은 `media_format="mp4", layout="center", trim_bars=False`로 선택할 수 있습니다. 기본값 변경으로 출력 확장자는 MOV가 되었습니다.
- `result.json`에 설정과 컷별 `top`/`bottom` 제거 픽셀 수를 기록합니다.

### Premiere 최종 MP4 출력 경로

이 Mac의 Premiere H.264/AAC 직접 출력에서 약 21ms 오디오 지연이 측정됐습니다. PCM 편집 소스로 바꾸는 것만으로는 이 최종 출력 지연이 사라지지 않았습니다. 다음 경로로 검증했습니다.

1. 생성된 XML을 Premiere로 가져와 편집합니다.
2. Premiere에서 **QuickTime / Apple ProRes 422 HQ / 압축되지 않은 PCM 48kHz 스테레오** 마스터를 내보냅니다. 해상도와 fps는 시퀀스에 맞춥니다.
3. 포함된 도구로 MP4를 생성합니다.

```sh
python export_delivery.py master.mov final.mp4 --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

이 도구는 PCM 오디오 마스터를 요구하며, 임의의 21ms 오프셋을 적용하지 않습니다. FFmpeg로 H.264/AAC를 인코딩하고 프레임 수·fps·해상도를 확인합니다. 기존 출력은 덮어쓰지 않습니다. 편집 소스 9컷과 실제 Premiere 마스터 및 변환 MP4로 시간 정렬을 재검증했습니다. 모든 Premiere 버전·플레이어의 지연을 보장하는 기능은 아닙니다.

```sh
python cli.py input.mp4 output --fps 24000/1001 --media-format mov --layout fit_blur
# 이전 중앙 크롭:
python cli.py input.mp4 output --media-format mp4 --layout center --keep-bars
```

## 파일

- `shorts_automator.py`: 독립 Python 클래스, 동기/백그라운드 API
- `ui_adapter.py`: GUI 타이머에서 이벤트를 읽는 컨트롤러
- `cli.py`: Electron·QProcess 등에서 자식 프로세스로 실행하는 JSON Lines 인터페이스
- `requirements.txt`: Python 의존성
- `tests/test_integration.py`: 실제 FFmpeg 미디어 기반 테스트
- `demo/`: 직접 생성한 테스트 패턴을 1080×1920으로 변환한 샘플

VideoComeOn Local 저장소 경로가 확인되지 않아 저장소 코드나 등록 파일을 수정하지 않았습니다. 호스트 프레임워크에 맞춰 아래 인터페이스를 연결하면 됩니다. 이 패키지 자체가 Premiere CEP 확장 패널은 아닙니다.

## 준비

Python 3.10 이상과 실행 가능한 FFmpeg·ffprobe가 필요합니다. 이 Mac에서 Python 3.14, PySceneDetect 0.6.7.1, FFmpeg 6.0으로 검증했습니다. FFmpeg 바이너리는 ZIP에 포함하지 않습니다.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

호스트에 이미 OpenCV가 설치되어 있다면 GUI용 OpenCV와 headless 배포판을 동시에 설치하지 말고 의존성을 호스트 환경에 맞게 합칩니다. 위 명령은 독립 가상환경용입니다.

## Python 앱 연결

모듈 파일과 `ui_adapter.py`를 앱이 import할 수 있는 같은 디렉터리에 넣습니다. 예시 경로는 실제 입력·출력 경로로 바꿉니다.

```python
from shorts_automator import ShortsPackagingPlugin
from ui_adapter import PackagingController

plugin = ShortsPackagingPlugin(
    threshold=27.0,
    min_duration=1.5,
    preset="fast",
    crf=22,
    ffmpeg="/absolute/path/to/ffmpeg",  # PATH에 있으면 생략
    ffprobe="/absolute/path/to/ffprobe",
)
controller = PackagingController(plugin)
controller.start("/movies/source.mp4", "/movies/shorts")

# 아래는 GUI의 100~200ms 타이머 콜백에서 호출합니다.
# Tkinter root.after / Qt QTimer 등을 사용합니다.
events, done = controller.poll()
for event in events:
    print(event.stage, event.completed, event.total)
if done:
    result = controller.result()
    print(result.status, result.clips, result.error)

# 취소 버튼 또는 앱 종료 시:
# controller.cancel()
# poll()로 종료를 확인한 뒤 앱을 닫습니다.
```

배치는 `controller.start(input_folder, output_folder, batch=True)`로 실행합니다. 하위 폴더는 재귀 검색하지 않으며 mp4/mov/mkv/m4v/webm을 대소문자 구분 없이 처리합니다.

`process_single_movie()`와 `run_batch()`는 동기 메서드입니다. UI에서 직접 실행하지 마세요. 직접 `start_single()`·`start_batch()`를 써도 되며 반환된 `Job.future`의 `done()`이 참일 때만 `result()`를 호출합니다. 완료 전에 `result()`를 호출하면 호출 스레드가 기다립니다.

진행 콜백은 작업 스레드에서 실행되므로 UI 위젯을 직접 변경하지 않습니다. `PackagingController`가 Queue를 통해 UI 스레드로 전달합니다. `detecting`은 분석 프레임 수, `rendering`은 검증 후 완성된 컷 수입니다. 긴 컷 하나를 인코딩할 때는 해당 컷이 끝날 때까지 컷 수가 증가하지 않으므로 UI에는 진행 중 표시도 제공합니다. 전체 작업의 예상 완료시간을 의미하지 않습니다.

## Electron / 별도 Python 프로세스 연결

```sh
.venv/bin/python cli.py /movies/source.mp4 /movies/shorts --min-duration 1.5
.venv/bin/python cli.py /movies /movies/shorts --batch
```

자식 프로세스를 `shell: false`와 인자 배열로 실행하고 stdout의 각 줄을 JSON으로 읽습니다. `type=progress/result/error`로 구분합니다. stderr는 진단 로그입니다. 취소 시 SIGTERM/SIGINT를 보내면 진행 중 FFmpeg를 종료하고 결과를 기록합니다. 종료 코드 0은 모두 성공, 1은 실패·빈 결과, 130은 취소입니다. 배치 완료 이벤트만으로 성공 판단하지 말고 각 결과의 status를 확인합니다.

## 결과와 안전한 파일 처리

- 출력 디렉터리 안에 매번 고유한 `shorts-*` 폴더를 만듭니다.
- 기존 MP4를 검색해 삭제하지 않습니다. 원본도 변경하지 않습니다.
- 짧은 컷은 인코딩 전에 제외합니다. 모든 컷이 짧으면 `empty` 결과입니다.
- 장면 전환이 없으면 영상 전체를 한 장면으로 처리합니다.
- 완료된 파일은 기본 `scene-0001.mov` 형식 (MP4 옵션 사용 시 `.mp4`)이며, 영상·오디오 존재와 해상도·길이를 검사한 뒤 확정합니다.
- 실패·취소 시 이번 실행의 미완성 `.partial.mp4`만 삭제하고 이미 완료된 컷은 보존합니다. `result.json`에 완료 파일 목록과 상태를 기록합니다.
- `MovieResult`를 bool로 평가하면 completed일 때만 True입니다. `run_batch()`는 영화별 결과 리스트를 반환합니다. 취소로 아직 시작하지 않은 파일은 리스트에 포함하지 않습니다.

## 범위

기본 fit_blur는 가로 화면의 좌우를 보존합니다. 선택 가능한 center 모드는 인물 추적이 아니므로 옆 인물이 잘릴 수 있습니다. 기본 출력은 H.264/PCM MOV, 1080×1920, 첫 번째 영상·첫 번째 오디오 스트림입니다. 무음 영상도 허용하며 자막·첨부파일·다른 오디오 트랙은 가져오지 않습니다. HDR 톤매핑, VFR 영화의 프레임 단위 경계 정확도, 회전 메타데이터·비정방형 픽셀·특수 코덱 전반은 실제 소스로 추가 검증해야 합니다.

## 테스트

```sh
FFMPEG=/absolute/path/to/ffmpeg FFPROBE=/absolute/path/to/ffprobe \
.venv/bin/python -m unittest discover -s tests -v
```

장면 목록·장면이 없는 영상 처리·취소 API는 [PySceneDetect 공식 문서](https://www.scenedetect.com/docs/0.6.7/api/scene_manager.html)를 기준으로 구현했습니다.

## FCP 7 XML 자동 생성 (추가)

성공한 각 실행 폴더에 `원본이름_assembly.xml`이 함께 만들어집니다. `MovieResult.xml_path`에서 경로를 얻습니다. Premiere의 **파일 → 가져오기**(Mac ⌘I / Windows Ctrl+I)에서 XML을 선택한 뒤 `원본이름_SourceTimeline` 시퀀스를 엽니다.

- `fcp_xml.py`는 표준 라이브러리 ElementTree로 FCP 7 계열 `xmeml version=5`를 생성합니다. 최신 Final Cut의 `.fcpxml`과 다른 형식입니다.
- 기본 출력·시퀀스는 1080×1920, **24fps CFR**입니다. `ShortsPackagingPlugin(fps=30)` 또는 CLI `--fps 30000/1001`로 변경할 수 있습니다. 24/25/30/50/60 및 24000/1001·30000/1001·60000/1001 지원.
- 분할 영상 자체를 지정한 fps로 변환합니다. XML에만 다른 fps를 적는 방식이 아닙니다. 원본 fps를 변경하면 프레임 중복/제거가 발생할 수 있습니다.
- 컨테이너의 오디오 포함 길이 대신 **실제 영상 프레임 수**로 순서대로 이어 붙입니다. 영상 트랙은 V1, 스테레오 음원은 연결된 A1/A2 채널로 기록하며 무음 클립에는 오디오 항목이 없습니다.
- 이 파이프라인의 오디오는 기본 48kHz 스테레오 PCM, MP4 옵션에서는 AAC로 변환됩니다. 다채널 원본은 스테레오로 다운믹스됩니다.
- XML에는 이번 실행에서 완료한 클립 목록만 넣습니다. XML 실패를 전체 성공으로 보고하지 않습니다.
- 미디어 절대 경로를 URL 인코딩하므로 한글·공백·&가 처리됩니다. 파일을 이동하거나 다른 컴퓨터에서 샘플 XML을 열면 다시 연결하거나 새 위치에서 XML을 재생성해야 합니다.

완료된 클립에서 XML만 생성하려면:

```python
xml_path = plugin.generate_fcp_xml(
    ["/output/scene-0001.mp4", "/output/scene-0002.mp4"],
    "/output/source_assembly.xml",
    sequence_name="Movie_SourceTimeline",
)
```

폴더 경로도 받을 수 있지만, 지정한 목록 방식이 의도한 클립만 포함하는 데 유리합니다. 기존 XML은 덮어쓰지 않습니다. 미디어 해상도·fps가 설정과 다르거나 정확한 프레임 수가 없으면 오류를 반환합니다. XML 생성 자체는 외부 라이브러리가 없지만, 미디어 검사에는 ffprobe, 전체 전처리에는 PySceneDetect·FFmpeg가 필요합니다.

규격 참고: [Apple FCP XML 인코딩 기본](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Basics/Basics.html).

## 이전 검수 기록: 2026-10-08

FCP XML의 A1/A2 오디오에 각각 왼쪽/오른쪽 팬을 명시했습니다. 이전 XML은 Premiere에서 양쪽 신호가 섞여 출력될 수 있으므로 새 모듈로 XML을 다시 생성하고 가져오세요. 이미 생성된 MP4는 재렌더링할 필요가 없습니다. ZIP에 포함한 xml-demo 및 ntsc-demo XML도 수정했습니다.

실제 Premiere 출력으로 29.97fps, 180프레임, 1080×1920, 스테레오 채널 분리를 확인했습니다. 자세한 측정과 한계는 EXTENDED_VERIFICATION.md를 참조하세요. 데모 XML은 이 Mac의 절대 경로를 사용하므로 폴더를 옮기면 XML을 다시 생성하거나 미디어를 재연결해야 합니다.
