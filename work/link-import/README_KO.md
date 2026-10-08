# Link Import — Premiere Pro Mac 플러그인

YouTube, Instagram, TikTok의 공개 영상 링크 한 개를 다운로드하고 H.264/AAC MP4로 변환해 Premiere 프로젝트와 타임라인에 가져옵니다. Apple Silicon Mac용입니다. API 키나 Homebrew 설정은 필요 없습니다.

## 사용
1. Premiere 프로젝트를 열고 저장합니다.
2. **창 → 확장명 → Link Import · 링크 가져오기**를 엽니다.
3. 개별 영상 링크를 붙여넣고 최대 1080p 또는 2160p를 선택합니다.
4. 배치 방식을 선택한 뒤 **다운로드하고 가져오기**를 누릅니다.

기본값은 시퀀스 전체의 마지막 클립 뒤에 V1/A1로 추가합니다. 재생헤드 삽입은 뒤의 클립을 밀며, 기존 클립 위에 덮어쓰지 않습니다. 새 시퀀스 / 프로젝트에만 가져오기도 선택할 수 있습니다. 활성 시퀀스가 없으면 영상에 맞는 시퀀스를 만듭니다. 파일은 프로젝트의 Link Import 저장소에 모입니다.

다운로드 중 프로젝트나 활성 시퀀스가 바뀌면 타임라인 수정을 중단합니다. 파일은 보존되므로 로컬 영상 가져오기로 이어갈 수 있습니다. V1/A1이 잠겼다면 먼저 잠금을 해제하세요. 외부 전송 없이 로컬에서 변환하며 플랫폼으로부터 다운로드하는 데 인터넷이 필요합니다.

## 저장 위치
`~/Downloads/LinkImport/video-무작위문자/ready.mp4`

이 MP4가 Premiere 원본 미디어입니다. 편집 중 옮기거나 삭제하면 오프라인 미디어가 됩니다. 같은 폴더의 source 파일은 원본 다운로드입니다. 실패·취소 시 일부 파일을 보존합니다. 자동 정리는 하지 않습니다.

## 설치와 복구
현재 Mac에는 이미 설치했습니다. 백업 ZIP을 다른 위치에서 사용할 경우 전체를 압축 해제한 뒤 `Install_Mac.command`를 실행하세요. 엔진이 없으면 `Setup_Engines.command`가 고정 버전을 다운로드하고 SHA-256을 확인합니다. 최초 설치는 인터넷이 필요합니다. ZIP에는 제3자 실행 파일을 재배포하지 않으며 코드와 엔진 설치 도구를 포함합니다.

설치 위치: `~/Library/Application Support/Adobe/CEP/extensions/LinkImport`
기존 설치가 있으면 `~/Library/Application Support/LinkImport/Backups`로 이동합니다. CSXS.11/12의 PlayerDebugMode를 1로 설정하며 기존 값은 INSTALLATION_INFO.txt에 기록됩니다. 변경 후 Premiere를 재실행합니다. 이 설정은 같은 CEP 런타임의 미서명 확장 전체에 적용됩니다.

## 범위
- 개별 공개 영상만 지원합니다. 유튜브 영상+재생목록 링크는 해당 영상만 다운로드합니다.
- 최대 길이 2시간, 다운로드 스트림당 8GB 제한입니다. 변환 시 추가 여유 디스크 공간이 필요합니다.
- 비공개, 유료, DRM, 로그인 필요, 지역 차단 영상은 지원하지 않습니다. 브라우저 쿠키를 읽지 않습니다.
- Instagram·TikTok은 플랫폼의 차단이나 변경으로 공개 링크도 실패할 수 있습니다. 오류는 상세 로그에서 확인합니다.
- 다운로드 엔진 업데이트는 yt-dlp 공식 안정 배포판을 업데이트합니다. FFmpeg/Deno는 자동 갱신하지 않습니다.
- 원본보다 해상도를 키우지 않습니다. 원본이 무음이면 오디오를 만들어내지 않습니다.
- H.264 8비트 SDR 편집용 변환입니다. HDR 색 보존/톤매핑 워크플로는 지원하지 않습니다.
- 고정 프레임레이트 변환으로 프레임 경계에 맞추며, 소스 오디오·비디오 타임스탬프를 사용합니다. 촬영본과의 별도 싱크 교정 기능은 아닙니다.
- 다운로드할 권한이 있는 영상을 사용하세요.

## 구현과 검증
셸 문자열 실행 대신 spawn의 인자 배열, URL 도메인/개별 영상 검사, 로컬 설정/플러그인 무시, 재생목록 제한, 실제 다운로드 경로 확인, MP4 영상/오디오 검사, 프로젝트 변경 감지 및 타임라인 클립 수 검사를 포함합니다.

개발 검사는 `node --test tests/engine.test.cjs`로 실행합니다. 자동 검사는 실제 Premiere 검증과 별개입니다. 검증 결과는 VERIFICATION.md를 참고하세요.

## 출처
- Adobe 공식 CEP/Premiere 샘플: https://github.com/Adobe-CEP/Samples/tree/master/PProPanel
- yt-dlp 공식 배포/사용법: https://github.com/yt-dlp/yt-dlp
- Deno 공식 배포: https://github.com/denoland/deno
- FFmpeg/ffprobe Mac 바이너리 배포: https://github.com/eugeneware/ffmpeg-static

고정 버전·다운로드 주소·해시는 LinkImport/engines.json에, 제3자 고지는 LinkImport/licenses에 기록됩니다.
