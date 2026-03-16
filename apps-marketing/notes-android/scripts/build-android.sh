#!/usr/bin/env bash

set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$REPO_ROOT/.android-sdk}}"

export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$REPO_ROOT/.android-user-home}"

bash "$REPO_ROOT/scripts/install-android-sdk.sh"

"$APP_ROOT/gradlew" --no-daemon :app:assembleDebug
