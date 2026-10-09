# 검증 기록

검증 환경: Apple Silicon Mac, Premiere Pro 26.5.2, CEP Node 17.7.2.

- URL 검증·안전한 인자·프로젝트/시퀀스 변경·잠긴 트랙·영상/오디오 삽입 결과·시퀀스 끝 계산·저장소 전용 동작: 자동 검사 8개 통과.
- 엔진: yt-dlp 2026.08.19, Deno 2.9.7, FFmpeg/ffprobe 실행 버전 6.0 (ffmpeg-static 배포 태그 b6.1.1).
- 엔진 다운로드 및 설치본 SHA-256 검증 통과.
- JavaScript 구문 검사, 설치/엔진 준비 Bash 구문 검사 통과.
- 사용자 제공 YouTube 영상 GgeOkQ3ikgo (재생목록 매개변수 포함): 한 개만 다운로드 성공.
- 실제 변환 결과: 1920×1080, H.264, 30fps CFR, AAC 48kHz stereo, 약 207.58초, 72,276,725 bytes.
- Premiere의 Link Import 패널 실행 및 엔진 초기화 확인.
- 패널의 실제 다운로드→변환→새 시퀀스 배치 검증: 성공. 시퀀스 Link Import 1791457520670에서 V1 영상과 A1 오디오 파형, 프로그램 모니터 영상 확인. 길이 00:03:27:17 (30fps).
- 테스트 프로젝트를 outputs/LinkImport_Test.prproj에 별도 저장하고 Premiere 창 제목으로 확인.
- 영상과 오디오의 타임라인 배치를 확인했으며 전체 구간의 입 모양/음성 싱크를 감상 검수한 것은 아닙니다.
- Instagram/TikTok 실제 다운로드: 테스트 링크 미제공으로 미검증.
- 4K, HDR, 로그인 영상, 네트워크 장시간 장애, 재생헤드 삽입의 복잡한 멀티트랙 프로젝트: 실제 호스트 미검증.

자동 검사는 실제 호스트 검증을 대체하지 않습니다.

## 2026-10-09 — Link Import 1.1 batch update

- Added newline-separated URL input, maximum 50 distinct normalized URLs, serial downloads and per-link results.
- Successful downloads are imported together; individual download failures are reported and skipped. Cancellation stops the queue and prevents the import phase while retaining downloaded files.
- Host batch insertion keeps input order for append, fixed-position ripple insertion, one new sequence, and bin-only modes. Partial host failures stop further insertion and report that completed items remain.
- `node --test tests/*.test.cjs`: 21 tests passed (8 existing, 13 added). Includes simulated panel callbacks and a simulated Premiere timeline; no live network download in this increment.
- `node --check LinkImport/main.js`, installer shell syntax, and Git whitespace checks passed.
- Existing installed code matched the prior repository version. Changed panel files were backed up outside the CEP extensions directory and updated; installed bytes matched repository bytes. Download engines were preserved.
- Close/reopen the panel, or save projects and restart Premiere if it retains the old version. Actual multiple-URL download and host timeline insertion still require a live user workflow check; mocked host tests are not a substitute for it.
