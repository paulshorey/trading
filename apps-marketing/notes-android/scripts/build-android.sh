#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$ROOT_DIR/.android-sdk}}"
export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"

CMDLINE_TOOLS_DIR="$SDK_ROOT/cmdline-tools/latest"
SDKMANAGER_BIN="$CMDLINE_TOOLS_DIR/bin/sdkmanager"

ensure_cmdline_tools() {
  if [[ -x "$SDKMANAGER_BIN" ]]; then
    return
  fi

  echo "Bootstrapping Android command-line tools into $SDK_ROOT"
  mkdir -p "$SDK_ROOT/cmdline-tools"

  local tmp_dir
  tmp_dir="$(mktemp -d)"

  python3 - "$tmp_dir/url.txt" <<'PY'
import sys
import urllib.request
import xml.etree.ElementTree as ET

output_path = sys.argv[1]
repository_url = "https://dl.google.com/android/repository/repository2-1.xml"
document = urllib.request.urlopen(repository_url, timeout=30).read()
root = ET.fromstring(document)
namespace = {"sdk": "http://schemas.android.com/sdk/android/repo/repository2/01"}

archive_url = None
for remote_package in root.findall("sdk:remotePackage", namespace):
    if remote_package.attrib.get("path") != "cmdline-tools;latest":
        continue

    archives = remote_package.find("sdk:archives", namespace)
    if archives is None:
        continue

    for archive in archives.findall("sdk:archive", namespace):
        host_os = archive.findtext("sdk:host-os", namespaces=namespace)
        if host_os != "linux":
            continue
        complete = archive.find("sdk:complete", namespace)
        if complete is None:
            continue
        url = complete.attrib.get("url")
        if url:
            archive_url = f"https://dl.google.com/android/repository/{url}"
            break
    if archive_url:
        break

if not archive_url:
    raise SystemExit("Failed to locate Android command-line tools download URL.")

with open(output_path, "w", encoding="utf-8") as handle:
    handle.write(archive_url)
PY

  local archive_url
  archive_url="$(<"$tmp_dir/url.txt")"

  curl -L "$archive_url" -o "$tmp_dir/commandlinetools.zip"
  unzip -q "$tmp_dir/commandlinetools.zip" -d "$tmp_dir/unpacked"

  rm -rf "$CMDLINE_TOOLS_DIR"
  mv "$tmp_dir/unpacked/cmdline-tools" "$CMDLINE_TOOLS_DIR"
  rm -rf "$tmp_dir"
}

install_android_packages() {
  yes | "$SDKMANAGER_BIN" --sdk_root="$SDK_ROOT" --licenses >/dev/null || true
  "$SDKMANAGER_BIN" --sdk_root="$SDK_ROOT" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.0.0"
}

ensure_cmdline_tools
install_android_packages

"$ROOT_DIR/gradlew" --no-daemon :app:assembleDebug
