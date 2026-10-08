#!/bin/bash
# Link Import 1.0.0 — macOS 사용자 계정용 CEP 설치 프로그램.
# 실행하면 아래 두 변경을 수행합니다. 실행 전 Premiere Pro를 종료하세요.
# 1. ~/Library/Application Support/Adobe/CEP/extensions/LinkImport 설치.
#    기존 폴더는 ~/Library/Application Support/LinkImport/Backups 로 이동.
# 2. 현재 사용자 com.adobe.CSXS.11 및 .12의 PlayerDebugMode를 문자열 1로 설정.
#    이 설정은 해당 CEP 런타임의 서명되지 않은 다른 확장에도 적용됩니다.
# 관리자 권한, 외부 다운로드, 별도 Node.js/npm은 사용하지 않습니다.
# macOS 기본 Bash 3.2와 시스템 명령만 사용합니다.

set -euo pipefail
umask 077

INSTALL_VERSION='1.0.0'
CEP_DIR=''
DEST_DIR=''
STAGE_DIR=''
BACKUP_DIR=''
LOCK_DIR=''
LOCK_HELD=0
INSTALL_COMMITTED=0

pause_if_terminal() {
  if [ -t 0 ] && [ -t 1 ]; then
    printf '\n이 창을 마치려면 Return 키를 누르세요. '
    IFS= read -r _reply || true
  fi
}

fail() {
  printf '\n오류: %s\n' "$1" >&2
  exit 1
}

on_exit() {
  local result=$?
  trap - EXIT HUP INT TERM
  set +e
  # 이전 설치를 옮긴 후 새 설치 이동에 실패했다면 원래 위치로 되돌립니다.
  if [ "$INSTALL_COMMITTED" -eq 0 ] && [ -n "$BACKUP_DIR" ] &&
     [ -d "$BACKUP_DIR/LinkImport" ]; then
    if [ ! -e "$DEST_DIR" ] && [ ! -L "$DEST_DIR" ]; then
      if /bin/mv "$BACKUP_DIR/LinkImport" "$DEST_DIR"; then
        printf '\n이전 설치를 원래 위치로 복구했습니다.\n'
        /bin/rmdir "$BACKUP_DIR" 2>/dev/null || true
      else
        printf '\n자동 복구에 실패했습니다. 이전 설치가 보존된 위치:\n%s/LinkImport\n' "$BACKUP_DIR" >&2
        result=1
      fi
    else
      printf '\n설치 대상이 존재하여 자동 복구를 중단했습니다. 이전 설치 백업:\n%s/LinkImport\n' "$BACKUP_DIR" >&2
      result=1
    fi
  fi
  # 이 실행에서 직접 만든 임시 폴더만 정리합니다.
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ] && [ ! -L "$STAGE_DIR" ]; then
    case "$STAGE_DIR" in
      "$CEP_DIR"/.LinkImport.install.*) /bin/rm -rf "$STAGE_DIR" ;;
    esac
  fi
  if [ "$LOCK_HELD" -eq 1 ]; then
    /bin/rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  if [ "$result" -ne 0 ]; then
    printf '\n설치를 마치지 못했습니다. 위 오류와 README_KO.md를 확인하세요.\n' >&2
  fi
  pause_if_terminal
  exit "$result"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Link Import %s — Mac 설치\n' "$INSTALL_VERSION"
printf 'Premiere Pro를 완전히 종료한 상태에서 실행하세요.\n'

[ "$(/usr/bin/uname -s)" = 'Darwin' ] || fail '이 설치 파일은 macOS에서만 실행할 수 있습니다.'
[ "$EUID" -ne 0 ] || fail 'sudo를 사용하지 말고 로그인한 사용자로 다시 실행하세요.'
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail '사용자 홈 폴더를 확인할 수 없습니다.'
[ -x /usr/bin/defaults ] || fail 'macOS defaults 명령을 찾을 수 없습니다.'

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/LinkImport"
for engine in yt-dlp ffmpeg ffprobe deno; do
  if [ ! -x "$SOURCE_DIR/bin/$engine" ]; then /bin/bash "$SCRIPT_DIR/Setup_Engines.command"; break; fi
done
CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST_DIR="$CEP_DIR/LinkImport"
BACKUP_ROOT="$HOME/Library/Application Support/LinkImport/Backups"
LOCK_DIR="$CEP_DIR/.LinkImport.install.lock"
STAMP="$(/bin/date -u '+%Y%m%dT%H%M%SZ')"

printf '\n설치 위치: %s\n' "$DEST_DIR"
printf '기존 설치 백업: %s\n' "$BACKUP_ROOT"
printf '설정 변경: 현재 사용자의 CSXS.11 / CSXS.12 PlayerDebugMode = 문자열 1\n'
printf '이 설정은 해당 CEP 런타임 전체의 서명되지 않은 확장 실행을 허용합니다.\n'
printf '변경 전 설정은 설치 폴더의 INSTALLATION_INFO.txt에 기록합니다.\n\n'

[ -d "$SOURCE_DIR" ] && [ ! -L "$SOURCE_DIR" ] || fail '같은 폴더의 LinkImport 원본을 찾을 수 없거나 심볼릭 링크입니다. ZIP을 먼저 압축 해제하세요.'
[ "$SOURCE_DIR" != "$DEST_DIR" ] || fail '설치 원본과 대상이 같습니다. 압축 해제한 패키지에서 실행하세요.'
for required_file in CSXS/manifest.xml index.html main.js; do
  [ -f "$SOURCE_DIR/$required_file" ] && [ ! -L "$SOURCE_DIR/$required_file" ] || fail "패키지 파일이 없거나 심볼릭 링크입니다: $required_file"
done
/usr/bin/grep -Fq 'ExtensionBundleId="com.local.linkimport"' "$SOURCE_DIR/CSXS/manifest.xml" || fail '설치 패키지의 확장 ID가 올바르지 않습니다.'
/usr/bin/grep -Fq "ExtensionBundleVersion=\"$INSTALL_VERSION\"" "$SOURCE_DIR/CSXS/manifest.xml" || fail '설치 프로그램과 패널 버전이 일치하지 않습니다.'

# 경로의 심볼릭 링크를 따라 다른 위치를 변경하지 않습니다.
for checked_path in \
  "$HOME/Library" \
  "$HOME/Library/Application Support" \
  "$HOME/Library/Application Support/Adobe" \
  "$HOME/Library/Application Support/Adobe/CEP" \
  "$CEP_DIR" "$DEST_DIR" \
  "$HOME/Library/Application Support/LinkImport" "$BACKUP_ROOT"; do
  [ ! -L "$checked_path" ] || fail "심볼릭 링크인 경로에는 설치하지 않습니다: $checked_path"
done
if [ -e "$DEST_DIR" ] && [ ! -d "$DEST_DIR" ]; then
  fail "설치 위치에 폴더가 아닌 파일이 있습니다: $DEST_DIR"
fi

/bin/mkdir -p "$CEP_DIR"
if /bin/mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_HELD=1
else
  fail "설치/제거가 이미 실행 중이거나 잠금 폴더를 만들 수 없습니다: $LOCK_DIR"
fi

# 완성된 복사본을 같은 파일 시스템에 준비한 뒤 폴더 이름을 바꿉니다.
STAGE_DIR="$(/usr/bin/mktemp -d "$CEP_DIR/.LinkImport.install.XXXXXX")"
/bin/cp -R "$SOURCE_DIR/." "$STAGE_DIR/"
[ -s "$STAGE_DIR/CSXS/manifest.xml" ] && [ -s "$STAGE_DIR/index.html" ] &&
  [ -s "$STAGE_DIR/main.js" ] || fail '임시 설치 복사본 검증에 실패했습니다.'

{
  printf 'Link Import installation\nversion=%s\ninstalled_at_utc=%s\n' "$INSTALL_VERSION" "$STAMP"
  printf 'bundle_id=com.local.linkimport\nextension_id=com.local.linkimport.panel\n'
  printf '\nPlayerDebugMode before this installation\n'
  for runtime in 11 12; do
    domain="com.adobe.CSXS.$runtime"
    if previous_value="$(/usr/bin/defaults read "$domain" PlayerDebugMode 2>/dev/null)"; then
      printf '%s.present=yes\n%s.value=%s\n' "$domain" "$domain" "$previous_value"
      previous_type="$(/usr/bin/defaults read-type "$domain" PlayerDebugMode 2>/dev/null || true)"
      printf '%s.type=%s\n' "$domain" "$previous_type"
    else
      printf '%s.present=no\n' "$domain"
    fi
  done
} > "$STAGE_DIR/INSTALLATION_INFO.txt"

if [ -d "$DEST_DIR" ]; then
  /bin/mkdir -p "$BACKUP_ROOT"
  [ "$(/usr/bin/stat -f '%d' "$CEP_DIR")" = "$(/usr/bin/stat -f '%d' "$BACKUP_ROOT")" ] || fail '안전한 폴더 이동을 위해 설치 위치와 백업 위치가 같은 디스크에 있어야 합니다.'
  BACKUP_DIR="$(/usr/bin/mktemp -d "$BACKUP_ROOT/BeforeInstall_$STAMP.XXXXXX")"
  /bin/mv "$DEST_DIR" "$BACKUP_DIR/LinkImport" || fail '기존 설치를 백업하지 못했습니다.'
fi

[ ! -e "$DEST_DIR" ] && [ ! -L "$DEST_DIR" ] || fail '설치 대상이 실행 중에 변경되었습니다. 다시 확인하세요.'
/bin/mv "$STAGE_DIR" "$DEST_DIR" || fail '새 패널을 설치 위치로 옮기지 못했습니다.'
STAGE_DIR=''
INSTALL_COMMITTED=1

debug_failures=0
for runtime in 11 12; do
  domain="com.adobe.CSXS.$runtime"
  if /usr/bin/defaults write "$domain" PlayerDebugMode -string 1; then
    printf '%s.PlayerDebugMode=1 (string)\n' "$domain" >> "$DEST_DIR/INSTALLATION_INFO.txt"
  else
    printf '\n패널 파일은 설치했으나 설정 변경에 실패했습니다: %s\n' "$domain" >&2
    printf '해결 명령: defaults write %s PlayerDebugMode -string 1\n' "$domain" >&2
    debug_failures=$((debug_failures + 1))
  fi
done

if [ -n "$BACKUP_DIR" ]; then
  printf '\n이전 설치 백업: %s/LinkImport\n' "$BACKUP_DIR"
fi
[ "$debug_failures" -eq 0 ] || fail '패널 파일 설치는 완료되었지만 CEP 설정 일부가 적용되지 않았습니다. 위 해결 명령과 호환성 문서를 확인하세요.'

printf '\n설치 완료: Link Import %s\n' "$INSTALL_VERSION"
printf 'Premiere Pro를 다시 열고 창(Window) > 확장 프로그램(Extensions) > Link Import를 선택하세요.\n'
printf '버전에 따라 확장 프로그램 메뉴에 Legacy가 표시될 수 있습니다.\n'
printf '메뉴가 보이지 않으면 Premiere를 완전히 종료해 다시 실행하고, 필요하면 Mac에서 로그아웃 후 다시 로그인하세요.\n'
exit 0
