#!/usr/bin/env bash
# Country Map build pipeline.
#
# One-shot, reproducible: pinned upstream NE version, deterministic outputs.
# Replaces the legacy Jupyter notebook. See README.md for details.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Sanity checks
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }
command -v npx     >/dev/null || { echo "npx (Node.js) required for mapshaper" >&2; exit 1; }

python3 -c "import yaml" 2>/dev/null || {
  echo "PyYAML required: pip install pyyaml" >&2
  exit 1
}

exec python3 build.py "$@"
