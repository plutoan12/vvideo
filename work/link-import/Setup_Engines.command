#!/bin/bash
set -euo pipefail
umask 077
[ "$(uname -m)" = arm64 ] || { echo '이 패키지는 Apple Silicon Mac용입니다.'; exit 1; }
ROOT="$(cd "$(dirname "$0")" && pwd)/LinkImport"
mkdir -p "$ROOT/bin"
TEMP_DIR="$(mktemp -d "$ROOT/.engine-download.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
echo 'yt-dlp 다운로드 중…'
curl --fail --location --proto "=https" --retry 2 --max-time 300 https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos -o "$TEMP_DIR/archive"
mv "$TEMP_DIR/archive" "$TEMP_DIR/yt-dlp"
[ "$(shasum -a 256 "$TEMP_DIR/yt-dlp" | cut -d " " -f 1)" = 0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202 ] || { echo "엔진 검증 실패"; exit 1; }
chmod 755 "$TEMP_DIR/yt-dlp"
mv "$TEMP_DIR/yt-dlp" "$ROOT/bin/yt-dlp"
echo 'deno 다운로드 중…'
curl --fail --location --proto "=https" --retry 2 --max-time 300 https://github.com/denoland/deno/releases/download/v2.9.7/deno-aarch64-apple-darwin.zip -o "$TEMP_DIR/archive"
unzip -oq "$TEMP_DIR/archive" deno -d "$TEMP_DIR"
[ "$(shasum -a 256 "$TEMP_DIR/deno" | cut -d " " -f 1)" = b73737579d5a84c160e3316487594783fa5c15f4e13252a6a07050b755317f1a ] || { echo "엔진 검증 실패"; exit 1; }
chmod 755 "$TEMP_DIR/deno"
mv "$TEMP_DIR/deno" "$ROOT/bin/deno"
echo 'ffmpeg 다운로드 중…'
curl --fail --location --proto "=https" --retry 2 --max-time 300 https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz -o "$TEMP_DIR/archive"
gzip -dc "$TEMP_DIR/archive" > "$TEMP_DIR/ffmpeg"
[ "$(shasum -a 256 "$TEMP_DIR/ffmpeg" | cut -d " " -f 1)" = a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584 ] || { echo "엔진 검증 실패"; exit 1; }
chmod 755 "$TEMP_DIR/ffmpeg"
mv "$TEMP_DIR/ffmpeg" "$ROOT/bin/ffmpeg"
echo 'ffprobe 다운로드 중…'
curl --fail --location --proto "=https" --retry 2 --max-time 300 https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64.gz -o "$TEMP_DIR/archive"
gzip -dc "$TEMP_DIR/archive" > "$TEMP_DIR/ffprobe"
[ "$(shasum -a 256 "$TEMP_DIR/ffprobe" | cut -d " " -f 1)" = bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64 ] || { echo "엔진 검증 실패"; exit 1; }
chmod 755 "$TEMP_DIR/ffprobe"
mv "$TEMP_DIR/ffprobe" "$ROOT/bin/ffprobe"
echo "엔진 준비 완료"
