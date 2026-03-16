#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$ROOT_DIR/.android-sdk}}"
ANDROID_USER_HOME_DIR="${ANDROID_USER_HOME:-$ROOT_DIR/.android-user-home}"

export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"
export ANDROID_USER_HOME="$ANDROID_USER_HOME_DIR"

CMDLINE_TOOLS_DIR="$SDK_ROOT/cmdline-tools/latest"
SDKMANAGER_BIN="$CMDLINE_TOOLS_DIR/bin/sdkmanager"

has_required_packages() {
  [[ -x "$SDKMANAGER_BIN" ]] &&
    [[ -x "$SDK_ROOT/platform-tools/adb" ]] &&
    [[ -f "$SDK_ROOT/platforms/android-36/android.jar" ]] &&
    [[ -x "$SDK_ROOT/build-tools/36.0.0/d8" ]]
}

ensure_cmdline_tools() {
  if [[ -x "$SDKMANAGER_BIN" ]]; then
    return
  fi

  echo "Installing Android command-line tools into $SDK_ROOT"
  mkdir -p "$SDK_ROOT/cmdline-tools" "$ANDROID_USER_HOME_DIR"
  touch "$ANDROID_USER_HOME_DIR/repositories.cfg"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN

  python3 - "$tmp_dir/url.txt" <<'PY'
import sys
import urllib.request
import xml.etree.ElementTree as ET

output_path = sys.argv[1]
repository_url = "https://dl.google.com/android/repository/repository2-1.xml"
document = urllib.request.urlopen(repository_url, timeout=30).read()
root = ET.fromstring(document)

archive_url = None
best_version = None

for remote_package in root.iter("remotePackage"):
    package_path = remote_package.attrib.get("path", "")
    if not package_path.startswith("cmdline-tools;"):
        continue

    try:
        version = tuple(int(part) for part in package_path.split(";", 1)[1].split("."))
    except Exception:
        continue

    archives = remote_package.find("archives")
    if archives is None:
        continue

    candidate_url = None
    for archive in archives.findall("archive"):
        host_os = archive.findtext("host-os")
        if host_os != "linux":
            continue
        complete = archive.find("complete")
        if complete is None:
            continue
        url = complete.findtext("url")
        if url:
            candidate_url = f"https://dl.google.com/android/repository/{url}"
            break

    if candidate_url and (best_version is None or version > best_version):
        best_version = version
        archive_url = candidate_url

if not archive_url:
    raise SystemExit("Failed to locate Android command-line tools download URL.")

with open(output_path, "w", encoding="utf-8") as handle:
    handle.write(archive_url)
PY

  local archive_url
  archive_url="$(<"$tmp_dir/url.txt")"

  curl -fsSL "$archive_url" -o "$tmp_dir/commandlinetools.zip"
  unzip -q "$tmp_dir/commandlinetools.zip" -d "$tmp_dir/unpacked"

  rm -rf "$CMDLINE_TOOLS_DIR"
  mv "$tmp_dir/unpacked/cmdline-tools" "$CMDLINE_TOOLS_DIR"
}

install_android_packages() {
  if has_required_packages; then
    echo "Android SDK packages already available in $SDK_ROOT"
    return
  fi

  mkdir -p "$SDK_ROOT" "$ANDROID_USER_HOME_DIR"
  touch "$ANDROID_USER_HOME_DIR/repositories.cfg"

  yes | "$SDKMANAGER_BIN" --sdk_root="$SDK_ROOT" --licenses >/dev/null || true
  "$SDKMANAGER_BIN" --sdk_root="$SDK_ROOT" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.0.0"
}

ensure_cmdline_tools
install_android_packages
