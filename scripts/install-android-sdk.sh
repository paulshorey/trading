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

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command '$command_name'. $install_hint" >&2
    exit 1
  fi
}
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

  require_command "python3" "Install Python 3 before provisioning the Android SDK."
  require_command "curl" "Install curl before provisioning the Android SDK."
  require_command "unzip" "Install unzip before provisioning the Android SDK."
  echo "Installing Android command-line tools into $SDK_ROOT"
  mkdir -p "$SDK_ROOT/cmdline-tools" "$ANDROID_USER_HOME_DIR"
  touch "$ANDROID_USER_HOME_DIR/repositories.cfg"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  (
    trap 'rm -rf "$tmp_dir"' EXIT

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
  )
}

accept_android_licenses() {
  set +e
  set +o pipefail
  yes | "$SDKMANAGER_BIN" --sdk_root="$SDK_ROOT" --licenses >/dev/null
  local pipe_status=("${PIPESTATUS[@]}")
  set -e
  set -o pipefail

  local yes_exit="${pipe_status[0]:-0}"
  local sdkmanager_exit="${pipe_status[1]:-0}"

  if [[ "$sdkmanager_exit" -ne 0 ]]; then
    return "$sdkmanager_exit"
  fi

  if [[ "$yes_exit" -ne 0 && "$yes_exit" -ne 141 ]]; then
    return "$yes_exit"
  fi
}

install_android_packages() {
  if has_required_packages; then
    echo "Android SDK packages already available in $SDK_ROOT"
    return
  fi

  require_command "java" "Install a Java runtime before provisioning Android SDK packages."
  require_command "yes" "Install coreutils before provisioning Android SDK packages."

  mkdir -p "$SDK_ROOT" "$ANDROID_USER_HOME_DIR"
  touch "$ANDROID_USER_HOME_DIR/repositories.cfg"

  accept_android_licenses
  "$SDKMANAGER_BIN" --sdk_root="$SDK_ROOT" \
    "platform-tools" \
    "platforms;android-36" \
    "build-tools;36.0.0"
}

ensure_cmdline_tools
install_android_packages
