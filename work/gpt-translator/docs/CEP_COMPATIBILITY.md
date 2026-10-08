# GPT Translator 1.0.0 — Mac 설치와 CEP 호환성

이 패키지는 Premiere Pro 안에서 여는 독립 CEP 패널입니다. 번들 ID는 `com.bangbaek.gpt-translator`, 패널 ID는 `com.bangbaek.gpt-translator.panel`입니다. Adobe 서명 ZXP가 아닌 소스 폴더 형태로 제공되므로, 설치 프로그램은 해당 사용자 계정에서 CEP 11·12의 서명되지 않은 확장 실행 설정을 활성화합니다.

## 지원 대상으로 설정한 환경

| 항목 | 설정 또는 근거 |
| --- | --- |
| 호스트 | Adobe Premiere Pro, 호스트 ID `PPRO` |
| 패널을 표시할 버전 범위 | 매니페스트의 `[23.0,99.9]` |
| Premiere Pro 23.x·24.x | CEP 11 계열을 대상으로 설계. Adobe 표의 CEP 11 도입 버전 15.4와 CEP 12 도입 버전 25.0 사이에 해당한다는 근거로 판단 |
| Premiere Pro 25.0 | Adobe가 CEP 12 탑재를 명시 |
| 최소 CEP 런타임 | `RequiredRuntime Name="CSXS" Version="11.0"` |
| 매니페스트 형식 | `Version="7.0"`, Adobe v7 XSD로 검증 |
| 패널 이름 | `GPT Translator` |
| 배포 버전 | 번들·패널·설치 프로그램 모두 `1.0.0` |

Adobe의 [CEP 12 호스트/런타임 표](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#applications-integrated-with-cep)는 Premiere Pro 15.4의 CEP 11 도입과 25.0의 CEP 12 도입을 명시합니다. 같은 문서의 구성 요소 표는 CEP 11.1을 Chromium 88·Node.js 15.9.0, CEP 12.0을 Chromium 99·Node.js 17.7.1로 설명합니다.

`[23.0,99.9]`는 호스트가 패널을 검색할 때 허용하는 버전 범위입니다. 모든 후속 Premiere 버전에서 실행을 검증했다는 뜻은 아닙니다. Adobe [매니페스트 스키마의 RangedVersion 정의](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_7.x/ExtensionManifest_v_7_0.xsd)에 따라 대괄호 범위는 양 끝을 포함하고, 런타임의 단일 `11.0`은 최소 버전입니다. CEP 정책이나 API가 바뀐 새 호스트는 별도 확인이 필요합니다.

개발 환경에서는 Linux에서 셸 문법과 XML 스키마를 검증했습니다. **macOS의 실제 설치, Premiere 패널 실행, Intel Mac·Apple Silicon Mac별 호스트 동작은 이 환경에서 실측하지 않았습니다.** Mac의 OS 지원 범위는 설치된 Premiere 버전의 요구 사항을 따릅니다.

## 설치 프로그램이 변경하는 항목

Premiere Pro를 완전히 종료한 다음, ZIP 전체를 압축 해제하고 `Install_Mac.command`를 두 번 클릭하세요. `GPT_Translator` 폴더와 `.command` 파일의 상대 위치를 유지해야 합니다.

| 변경 항목 | 내용 |
| --- | --- |
| 패널 설치 | `~/Library/Application Support/Adobe/CEP/extensions/GPT_Translator` |
| 이전 설치 보관 | `~/Library/Application Support/GPT_Translator/Backups/BeforeInstall_날짜.임의문자/GPT_Translator` |
| 설치 기록 | 설치된 폴더 안의 `INSTALLATION_INFO.txt`: 버전, UTC 시각, 확장 ID, 변경 전 PlayerDebugMode 값과 자료형 |
| CEP 11 설정 | `defaults write com.adobe.CSXS.11 PlayerDebugMode -string 1` |
| CEP 12 설정 | `defaults write com.adobe.CSXS.12 PlayerDebugMode -string 1` |

이 PlayerDebugMode 설정은 GPT Translator 한 개에만 적용되는 설정이 아닙니다. 같은 사용자 계정의 해당 CEP 런타임에서 서명되지 않은 확장 프로그램을 로드할 수 있게 합니다. Adobe의 [서명되지 않은 확장 디버깅 안내](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions)에 따른 개발용 설치 방식입니다.

설치 프로그램은 지원 대상으로 삼은 두 런타임의 설정만 사용합니다. 설치된 Adobe 앱을 추측해 CSXS.13 이상에 임의 설정을 추가하지 않습니다. 사용자 폴더에 설치하므로 `sudo`, 관리자 암호, Homebrew, 별도 Node.js 또는 npm 설치가 필요하지 않습니다. 설치 과정은 다운로드를 수행하지 않습니다.

복사본은 CEP 확장 폴더 안의 임시 디렉터리에서 준비합니다. 필요한 파일을 확인한 뒤 기존 설치를 백업하고 완성된 복사본을 대상 이름으로 이동합니다. 새 폴더 이동이 실패하면 이전 설치를 되돌리며, 자동 복구가 불가능하면 백업 경로를 출력합니다. 기존 설치와 백업 위치가 다른 디스크일 때는 이전 설치 이동 전에 중단합니다. 심볼릭 링크인 설치 경로도 수정하지 않습니다.

이전 버전 백업은 CEP가 확장 프로그램을 검색하는 폴더 밖에 보관합니다. 따라서 보관용 매니페스트가 또 하나의 패널로 검색되지 않습니다. 사용자용 CEP 확장 폴더는 Adobe의 [확장 폴더 안내](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#extension-folders)에 근거합니다.

설치가 끝나면 Premiere Pro를 다시 열고 **창(Window) → 확장 프로그램(Extensions) → GPT Translator**를 선택하세요. 메뉴 이름에는 버전에 따라 Legacy 표시가 있을 수 있습니다.

## macOS에서 `.command` 파일이 열리지 않을 때

Finder에서 파일을 오른쪽 클릭하고 **열기**를 선택하세요. macOS가 계속 차단하거나 해당 방식이 제공되지 않으면, 파일을 한 번 열어 본 뒤 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**에서 이 파일에 대한 실행 여부를 선택할 수 있습니다. 출처와 내용을 확인한 파일에만 적용하세요. 최신 절차는 [Apple의 Mac에서 앱 안전하게 열기 안내](https://support.apple.com/ko-kr/102445)를 따릅니다.

압축 해제 도구가 실행 권한을 보존하지 않아 “권한이 없다”는 오류가 나온 경우에는 터미널에서 다음을 실행할 수 있습니다. 아래 경로는 실제 압축 해제 위치로 바꾸세요.

```bash
chmod u+x "/압축을 푼 경로/Install_Mac.command"
chmod u+x "/압축을 푼 경로/Uninstall_Mac.command"
```

설치 프로그램에는 Gatekeeper 전체 비활성화, 광범위한 격리 속성 제거, 관리자 권한 실행 단계가 들어 있지 않습니다.

## 설치 해제와 이전 설치 복원

Premiere Pro를 종료하고 `Uninstall_Mac.command`를 실행하면 설치 폴더를 다음 위치로 이동합니다.

```text
~/Library/Application Support/GPT_Translator/Backups/Uninstalled_날짜.임의문자/GPT_Translator
```

설치된 패널 파일은 이 백업에 남습니다. 다른 CEP 확장, 사용자가 저장한 SRT 파일, Adobe 공통 설정은 변경하지 않습니다. 이 확장 ID로 확인할 수 없는 폴더나 심볼릭 링크는 이동하지 않습니다.

설치 해제 후 되돌리거나 `BeforeInstall_...`의 이전 버전으로 복원하려면, 먼저 현재 GPT Translator를 설치 해제해 대상 폴더를 비우세요. 다음 명령의 백업 경로를 실제 출력된 경로로 바꿉니다. 폴더 이동은 Premiere가 종료된 상태에서 진행하세요.

```bash
translator_backup="$HOME/Library/Application Support/GPT_Translator/Backups/Uninstalled_날짜.임의문자/GPT_Translator"
translator_destination="$HOME/Library/Application Support/Adobe/CEP/extensions/GPT_Translator"
test -d "$translator_backup" && \
  test ! -e "$translator_destination" && \
  test ! -L "$translator_destination" && \
  mv "$translator_backup" "$translator_destination"
```

### PlayerDebugMode를 수동으로 되돌리기

제거 프로그램은 PlayerDebugMode를 자동으로 지우지 않습니다. 다른 개발용 CEP 확장도 같은 설정을 쓸 수 있기 때문입니다. 설치 시점의 값은 설치 또는 백업 폴더 안의 `INSTALLATION_INFO.txt`를 확인하세요. 재설치를 여러 번 했다면 가장 처음 설치 직전의 기록은 초기 백업 안에 있을 수 있습니다.

이전에 `0` 문자열이었고 그 값으로 복원하려면 다음처럼 설정합니다. CEP 11 또는 CEP 12 중 필요한 항목만 실행하세요.

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode -string 0
defaults write com.adobe.CSXS.12 PlayerDebugMode -string 0
```

이전에 키가 없었음을 확인했고 다른 개발용 확장도 더 이상 이 설정을 필요로 하지 않는 경우에는 해당 키를 삭제할 수 있습니다.

```bash
defaults delete com.adobe.CSXS.11 PlayerDebugMode
defaults delete com.adobe.CSXS.12 PlayerDebugMode
```

키가 없으면 `defaults delete`가 “존재하지 않는다”는 메시지를 낼 수 있습니다. 기존 값이 다른 문자열이었다면 그 값을 사용하고, 기존 자료형이 boolean·integer였다면 기록에 맞춰 각각 `-bool`·`-int` 옵션으로 복원하세요. 현재 설정은 다음으로 확인할 수 있습니다.

```bash
defaults read com.adobe.CSXS.11 PlayerDebugMode
defaults read com.adobe.CSXS.12 PlayerDebugMode
```

Adobe 앱을 다시 실행해 변경을 반영하세요. 설정이 바로 반영되지 않는 경우 로그아웃 후 다시 로그인하거나 Mac을 재시동할 수 있습니다.

## 패널이 안 보이거나 시작하지 못할 때

1. Premiere의 실제 버전이 `23.0` 이상인지 확인합니다. 같은 Mac의 다른 Adobe 앱에서 이 패널을 찾을 수는 없습니다.
2. 설치 위치 안에 `CSXS/manifest.xml`, `index.html`, `js/app.js`가 있는지 확인합니다. `GPT_Translator/GPT_Translator`처럼 폴더가 중복되어 있으면 ZIP의 `Install_Mac.command`로 다시 설치합니다.
3. 설치 터미널에 PlayerDebugMode 변경 실패가 표시되었는지 확인합니다. 표시된 정확한 도메인의 명령만 다시 실행합니다. 설치 파일 이동이 끝난 뒤 설정 변경만 실패한 경우에는 패널 파일과 이전 버전 백업이 보존됩니다.
4. Premiere를 완전히 종료했다가 다시 엽니다. 계속 보이지 않으면 로그아웃 후 다시 로그인하거나 Mac을 재시동합니다.
5. 과거 설치가 시스템 공용 CEP 확장 폴더에 별도로 남아 있다면 번들 ID 중복 여부를 확인합니다. 이 설치 프로그램은 다른 위치의 확장을 자동으로 제거하지 않습니다.
6. 설치/제거 잠금 오류가 발생한 경우 다른 설치 창이 실행 중인지 먼저 확인합니다. 중단된 실행에서 빈 잠금 폴더만 남았고 어떤 설치/제거도 실행 중이지 않은 경우에만 다음을 실행한 뒤 다시 설치합니다.

```bash
rmdir "$HOME/Library/Application Support/Adobe/CEP/extensions/.GPT_Translator.install.lock"
```

위 명령은 비어 있는 잠금 디렉터리 한 개에만 적용됩니다. 대상이 비어 있지 않거나 다른 종류의 파일이면 실패하므로, 해당 오류를 무시하고 범위를 넓혀 지우지 마세요.

## 개발자용 API 확인 기록

매니페스트는 `./index.html`을 진입점으로 사용하고 `--enable-nodejs`, `--mixed-context`를 지정합니다. 원격 디버깅 포트와 웹 보안 해제 플래그는 추가하지 않았습니다. Adobe가 설명하는 Node.js 혼합 컨텍스트 구성에 맞춘 설정입니다.

[Adobe의 CSInterface.js 원본](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/CSInterface.js)에서 `SystemPath.EXTENSION`은 문자열 `extension`입니다. 공식 `getSystemPath` 래퍼는 네이티브 브리지의 결과를 URI 디코딩한 뒤 운영체제별 `file://` 접두사를 정리합니다. 직접 브리지를 이용할 때도 파일 URI를 실제 파일 경로로 정규화해야 합니다. `getHostEnvironment` 래퍼는 네이티브 브리지의 JSON 문자열을 파싱해 반환합니다.

[Adobe의 CEPEngine_extensions.js 원본](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/CEPEngine_extensions.js)에서 확인한 대화상자 API는 다음과 같습니다.

| API | 주요 인자 | 반환값 |
| --- | --- | --- |
| `window.cep.fs.showOpenDialogEx` | 다중 선택 여부, 폴더 선택 여부, 제목, 시작 경로, 확장자 배열, Windows 설명, Mac 버튼 문구 | `{ data: 선택한 절대경로 배열, err: 상태 코드 }` |
| `window.cep.fs.showSaveDialogEx` | 제목, 시작 경로, 확장자 배열, 기본 파일명, Windows 설명, Mac 버튼 문구, Mac 파일명 라벨 | `{ data: 저장 경로 문자열, err: 상태 코드 }`; 취소하면 빈 문자열 |

확장자 배열은 `['srt']`처럼 점 없이 지정합니다. 열기 대화상자의 배열과 저장 대화상자의 문자열을 서로 같은 형식으로 처리하면 안 됩니다. `CEPEngine_extensions.js`는 CEP 엔진이 제공하는 네이티브 API 구현의 참고 자료이며, 일반 브라우저 스크립트처럼 패널 HTML에 추가하는 파일이 아닙니다.

이 문서에 적힌 API·런타임 자료는 2026-10-08에 Adobe 공식 저장소에서 확인했습니다. 코드와 설치 구조의 정적 검증은 실제 Premiere 호스트에서 파일 열기, API 통신, 결과 저장을 확인하는 실행 검증을 대신하지 않습니다.
