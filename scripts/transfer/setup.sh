#!/usr/bin/env bash
# One-time setup. Run while the Mac still has internet: the NAS LAN has none.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 -m venv "$HERE/.venv"
"$HERE/.venv/bin/pip" install --quiet --disable-pip-version-check -r "$HERE/requirements.txt"

if [[ ! -f "$HERE/thora-transfer.toml" ]]; then
  cp "$HERE/thora-transfer.example.toml" "$HERE/thora-transfer.toml"
  echo "created $HERE/thora-transfer.toml (edit the [[sources]] paths once the NAS is mounted)"
fi

"$HERE/../thora-transfer" doctor || true
