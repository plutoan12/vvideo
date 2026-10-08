#!/bin/bash
# GPT Translator 1.0.0 — 삭제 대신 설치 폴더를 날짜가 붙은 백업으로 이동합니다.
# 실행 전 Premiere Pro를 종료하세요. 다른 확장, SRT 파일, CEP 공통 설정은
# 변경하지 않습니다. PlayerDebugMode의 수동 복원은 호환성 문서를 참고하세요.

set -euo pipefail
umask 077

LOCK_DIR=''
LOCK_HELD=0

on_exit() {
  local result=$?
  trap - EXIT HUP INT TERM
  if [ "$LOCK_HELD" -eq 1 ]; then
    /bin/rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  if [ -t 0 ] && [ -t 1 ]; then
    printf '\n이 창을 마치려면 Return 키를 누르세요. '
    IFS= read -r _reply || true
  fi
  exit "$result"
}

fail() {
  printf '\n오류: %s\n' "$1" >&2
  exit 1
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'GPT Translator 1.0.0 — Mac 설치 해제\n'
printf 'Premiere Pro를 완전히 종료한 상태에서 실행하세요.\n'
printf 'GPT_Translator 설치 폴더를 백업으로 이동합니다. PlayerDebugMode 설정은 유지됩니다.\n'

[ "$(/usr/bin/uname -s)" = 'Darwin' ] || fail '이 파일은 macOS에서만 실행할 수 있습니다.'
[ "$EUID" -ne 0 ] || fail 'sudo를 사용하지 말고 로그인한 사용자로 다시 실행하세요.'
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail '사용자 홈 폴더를 확인할 수 없습니다.'

CEP_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST_DIR="$CEP_DIR/GPT_Translator"
BACKUP_ROOT="$HOME/Library/Application Support/GPT_Translator/Backups"
LOCK_DIR="$CEP_DIR/.GPT_Translator.install.lock"
STAMP="$(/bin/date -u '+%Y%m%dT%H%M%SZ')"

for checked_path in \
  "$HOME/Library" \
  "$HOME/Library/Application Support" \
  "$HOME/Library/Application Support/Adobe" \
  "$HOME/Library/Application Support/Adobe/CEP" \
  "$CEP_DIR" "$DEST_DIR" \
  "$HOME/Library/Application Support/GPT_Translator" "$BACKUP_ROOT"; do
  [ ! -L "$checked_path" ] || fail "심볼릭 링크인 경로는 이동하지 않습니다: $checked_path"
done

if [ ! -e "$DEST_DIR" ]; then
  printf '\nGPT Translator 설치가 없습니다. 변경한 항목이 없습니다.\n'
  exit 0
fi
[ -d "$DEST_DIR" ] || fail "설치 위치에 폴더가 아닌 파일이 있습니다: $DEST_DIR"
[ -f "$DEST_DIR/CSXS/manifest.xml" ] && [ ! -L "$DEST_DIR/CSXS/manifest.xml" ] || fail 'GPT Translator 매니페스트를 확인할 수 없습니다. 폴더는 그대로 보존했습니다.'
/usr/bin/grep -Fq 'ExtensionBundleId="com.bangbaek.gpt-translator"' "$DEST_DIR/CSXS/manifest.xml" || fail '이 폴더는 GPT Translator 확장으로 확인되지 않습니다. 폴더는 그대로 보존했습니다.'

if /bin/mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_HELD=1
else
  fail "설치/제거가 이미 실행 중이거나 잠금 폴더를 만들 수 없습니다: $LOCK_DIR"
fi
/bin/mkdir -p "$BACKUP_ROOT"
[ "$(/usr/bin/stat -f '%d' "$CEP_DIR")" = "$(/usr/bin/stat -f '%d' "$BACKUP_ROOT")" ] || fail '안전한 폴더 이동을 위해 설치 위치와 백업 위치가 같은 디스크에 있어야 합니다.'
BACKUP_DIR="$(/usr/bin/mktemp -d "$BACKUP_ROOT/Uninstalled_$STAMP.XXXXXX")"
/bin/mv "$DEST_DIR" "$BACKUP_DIR/GPT_Translator" || fail '설치 폴더를 백업으로 이동하지 못했습니다.'

printf '\n설치 해제 완료. 패널 원본은 다음 위치에 보존했습니다:\n%s/GPT_Translator\n' "$BACKUP_DIR"
printf '\n복원하려면 Premiere Pro를 종료하고 설치 위치가 비어 있는지 확인한 뒤 실행하세요:\n'
printf 'mv %q %q\n' "$BACKUP_DIR/GPT_Translator" "$DEST_DIR"
printf '\nCEP 공통 PlayerDebugMode 설정은 다른 확장에 영향을 줄 수 있어 변경하지 않았습니다.\n'
printf '변경 전 값은 백업 안의 INSTALLATION_INFO.txt에서 확인할 수 있습니다.\n'
printf '수동 복원: 패키지의 docs/CEP_COMPATIBILITY.md를 참고하세요.\n'
exit 0
