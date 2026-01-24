#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPS_DIR="${ROOT_DIR}/apps"

if ! command -v doppler >/dev/null 2>&1; then
  echo "Doppler CLI not found. Install it first:"
  echo "https://docs.doppler.com/docs/install-cli"
  exit 1
fi

if [ ! -d "${APPS_DIR}" ]; then
  echo "Apps directory not found: ${APPS_DIR}"
  exit 1
fi

DOPPLER_CONFIG="${DOPPLER_CONFIG:-dev}"
DOPPLER_PROJECT_PREFIX="${DOPPLER_PROJECT_PREFIX:-}"

shopt -s nullglob
app_dirs=("${APPS_DIR}"/*/)

if [ "${#app_dirs[@]}" -eq 0 ]; then
  echo "No app directories found under ${APPS_DIR}"
  exit 1
fi

echo "Syncing .env.local files from Doppler (config: ${DOPPLER_CONFIG})"

for app_dir in "${app_dirs[@]}"; do
  app_name="$(basename "${app_dir}")"
  project_name="${DOPPLER_PROJECT_PREFIX}${app_name}"
  output_file="${app_dir}/.env.local"

  echo " - ${app_name}: ${project_name} -> ${output_file}"
  doppler secrets download \
    --project "${project_name}" \
    --config "${DOPPLER_CONFIG}" \
    --format env \
    --no-file \
    > "${output_file}"
done

echo "Done."
