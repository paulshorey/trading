#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ROOT_DIR/.android-sdk}"
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$ROOT_DIR/.android-user-home}"
export CI="${CI:-true}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT_DIR/.gradle}"
export HUSKY="${HUSKY:-0}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"

mkdir -p \
  "$ROOT_DIR/.turbo" \
  "$ANDROID_SDK_ROOT" \
  "$ANDROID_USER_HOME" \
  "$GRADLE_USER_HOME"

bash scripts/install-workspace-deps.sh "$@"

bash scripts/install-android-sdk.sh

(
  cd apps-marketing/notes-android
  ./gradlew --no-daemon :app:help >/dev/null
)
