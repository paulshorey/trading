#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../../.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$REPO_ROOT/.android-sdk}}"
ANDROID_USER_HOME_DIR="${ANDROID_USER_HOME:-$REPO_ROOT/.android-user-home}"
GRADLE_USER_HOME_DIR="${GRADLE_USER_HOME:-$REPO_ROOT/.gradle}"

export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"
export ANDROID_USER_HOME="$ANDROID_USER_HOME_DIR"
export GRADLE_USER_HOME="$GRADLE_USER_HOME_DIR"

mkdir -p "$GRADLE_USER_HOME_DIR"
bash "$REPO_ROOT/scripts/install-android-sdk.sh"
"$ROOT_DIR/gradlew" --no-daemon :app:assembleDebug
