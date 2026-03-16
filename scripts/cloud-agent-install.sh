#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ROOT_DIR/.android-sdk}"
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$ROOT_DIR/.android-user-home}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT_DIR/.gradle}"
export HUSKY="${HUSKY:-0}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
STORE_DIR="${PNPM_STORE_DIR:-$ROOT_DIR/.pnpm-store}"

mkdir -p \
  "$PNPM_HOME" \
  "$STORE_DIR" \
  "$ROOT_DIR/.turbo" \
  "$ANDROID_SDK_ROOT" \
  "$ANDROID_USER_HOME" \
  "$GRADLE_USER_HOME"

case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

corepack enable
corepack prepare pnpm@10.28.1 --activate

pnpm fetch --store-dir "$STORE_DIR"
pnpm install --frozen-lockfile --prefer-offline --store-dir "$STORE_DIR"

bash scripts/install-android-sdk.sh

(
  cd apps-marketing/notes-android
  ./gradlew --no-daemon :app:help >/dev/null
)
