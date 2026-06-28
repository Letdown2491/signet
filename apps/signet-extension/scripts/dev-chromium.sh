#!/usr/bin/env bash
# Launch Flatpak Chromium with the dev build loaded by DIRECT path.
#
# Why this exists: Flatpak Chromium's "Load unpacked" file picker hands back an
# ephemeral document-portal path (/run/flatpak/doc/...), and Chromium can't load
# an extension tree from it ("Could not load manifest"). We bypass the picker and
# point --load-extension at the real path, which the sandbox can read thanks to
# the flatpak --filesystem override granted below.
#
# An isolated --user-data-dir is used so the flag applies even if your main
# Chromium window is already open, and so dev never touches your real profile.
set -euo pipefail

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.output/chrome-mv3-dev"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PROFILE_DIR="${HOME}/.var/app/org.chromium.Chromium/signet-dev"

if [[ ! -f "${EXT_DIR}/manifest.json" ]]; then
  echo "No dev build at ${EXT_DIR}." >&2
  echo "Run 'pnpm dev:extension' (in another terminal) first." >&2
  exit 1
fi

# Idempotent: let the sandbox read the repo so --load-extension can resolve.
flatpak override --user --filesystem="${REPO_ROOT}:ro" org.chromium.Chromium 2>/dev/null || true

exec flatpak run org.chromium.Chromium \
  --user-data-dir="${PROFILE_DIR}" \
  --load-extension="${EXT_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  "$@"
