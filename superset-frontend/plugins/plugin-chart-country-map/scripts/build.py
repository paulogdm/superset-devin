#!/usr/bin/env python3
"""
Country Map build pipeline — Natural Earth → GeoJSON.

Replaces the legacy Jupyter notebook. Reads YAML configs from config/,
downloads pinned Natural Earth shapefiles, applies declarative transforms,
optionally runs procedural escape-hatch scripts, and writes per-worldview
GeoJSON outputs to output/.

Run with: ./build.sh  (which is just `python3 build.py` with sensible env)

This is the POC version — currently implements:
  - NE shapefile download + cache (pinned to v5.1.2)
  - Shapefile → GeoJSON conversion via mapshaper CLI
  - name_overrides.yaml application
  - One worldview (UA) at Admin 0

Future commits will add: multiple worldviews, Admin 1, flying_islands,
territory_assignments, regional_aggregations, composite_maps, simplification,
procedural/ orchestration.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

# ----------------------------------------------------------------------
# Constants / paths
# ----------------------------------------------------------------------

NE_REPO = "nvkelso/natural-earth-vector"
NE_PINNED_TAG = "v5.1.2"
NE_PINNED_SHA = "f1890d9f152c896d250a77557a5751a93d494776"
NE_RAW_URL = f"https://raw.githubusercontent.com/{NE_REPO}/{NE_PINNED_SHA}/10m_cultural"

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_DIR = SCRIPT_DIR / "config"
OUTPUT_DIR = SCRIPT_DIR / "output"
CACHE_DIR = SCRIPT_DIR / ".cache"

SHAPEFILE_EXTS = ["shp", "shx", "dbf", "prj", "cpg"]

# Worldview codes shipped by NE as suffixes on the Admin 0 file name. Empty
# string = the "Default" (ungrouped) NE editorial. The new plugin's
# documented default is "ukr".
WORLDVIEWS_ADMIN_0 = [
    "",       # Default
    "ukr",    # Ukraine — Superset's documented default
]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ----------------------------------------------------------------------
# NE download
# ----------------------------------------------------------------------


def fetch_ne_shapefile(admin_level: int, worldview: str = "") -> Path:
    """Download (or use cached) shapefile components for one NE layer.

    Returns the path to the `.shp` file; sibling `.shx`/`.dbf`/`.prj`/`.cpg`
    files live alongside as mapshaper requires.
    """
    if admin_level == 0:
        suffix = f"_{worldview}" if worldview else ""
        basename = f"ne_10m_admin_0_countries{suffix}"
    elif admin_level == 1:
        # NE only publishes worldview-specific files at Admin 0. Admin 1
        # uses a single file with per-feature `WORLDVIEW` attributes.
        basename = "ne_10m_admin_1_states_provinces"
    else:
        raise ValueError(f"Unsupported admin_level={admin_level}")

    target_shp = CACHE_DIR / f"{basename}.shp"
    if target_shp.exists():
        return target_shp

    CACHE_DIR.mkdir(exist_ok=True)
    log(f"Downloading NE {basename} (worldview={worldview or 'default'})…")
    for ext in SHAPEFILE_EXTS:
        url = f"{NE_RAW_URL}/{basename}.{ext}"
        dest = CACHE_DIR / f"{basename}.{ext}"
        try:
            urllib.request.urlretrieve(url, dest)
        except urllib.error.HTTPError as e:
            if ext == "cpg" and e.code == 404:
                # .cpg is optional in shapefile bundles
                continue
            raise

    return target_shp


# ----------------------------------------------------------------------
# Shapefile → GeoJSON via mapshaper CLI
# ----------------------------------------------------------------------


def shp_to_geojson(shp: Path, output: Path) -> None:
    """Convert a shapefile to GeoJSON FeatureCollection."""
    if shutil.which("npx") is None:
        raise RuntimeError(
            "npx not found in PATH; mapshaper is required for shapefile conversion"
        )
    log(f"  mapshaper: {shp.name} → {output.name}")
    subprocess.run(
        ["npx", "--yes", "mapshaper", str(shp), "-o", str(output), "format=geojson"],
        check=True,
        stderr=subprocess.DEVNULL,
    )


# ----------------------------------------------------------------------
# Match helpers
# ----------------------------------------------------------------------


def _matches(props: dict[str, Any], conditions: dict[str, Any]) -> bool:
    """Check whether a feature's properties satisfy all conditions in match.

    Supports two value forms:
      - scalar: exact equality
      - {in: [...]}: membership in a list
    """
    for k, want in conditions.items():
        got = props.get(k)
        if isinstance(want, dict) and "in" in want:
            if got not in want["in"]:
                return False
        else:
            if got != want:
                return False
    return True


# ----------------------------------------------------------------------
# Transforms
# ----------------------------------------------------------------------


def apply_name_overrides(geo: dict, overrides: list[dict]) -> dict:
    """Apply attribute overrides from name_overrides.yaml."""
    n_applied = 0
    for entry in overrides:
        match = entry["match"]
        new_values = entry["set"]
        for feature in geo["features"]:
            props = feature["properties"]
            if _matches(props, match):
                props.update(new_values)
                n_applied += 1
    log(f"  name_overrides: applied {n_applied} field updates "
        f"across {len(overrides)} entries")
    return geo


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------


def main() -> int:
    OUTPUT_DIR.mkdir(exist_ok=True)

    log(f"Country Map build — pinned to NE {NE_PINNED_TAG} ({NE_PINNED_SHA[:8]})")

    # Load configs
    name_overrides = yaml.safe_load(
        (CONFIG_DIR / "name_overrides.yaml").read_text()
    )["overrides"]
    log(f"Loaded {len(name_overrides)} name override entries")

    # POC scope: UA worldview, Admin 0 only. Future commits expand this.
    worldview = "ukr"
    admin_level = 0

    log(f"\nBuilding worldview={worldview} admin_level={admin_level}")
    shp = fetch_ne_shapefile(admin_level, worldview)
    raw_geojson = OUTPUT_DIR / f"_raw_{worldview}_admin{admin_level}.geo.json"
    shp_to_geojson(shp, raw_geojson)

    geo = json.loads(raw_geojson.read_text())
    log(f"  loaded {len(geo['features'])} features")

    geo = apply_name_overrides(geo, name_overrides)
    # TODO(next-commit): flying_islands, territory_assignments,
    # composite_maps, regional_aggregations, simplification, procedural/

    final = OUTPUT_DIR / f"{worldview}_admin{admin_level}.geo.json"
    final.write_text(json.dumps(geo))
    log(f"  wrote {final} ({final.stat().st_size:,} bytes)")

    # Cleanup intermediate
    raw_geojson.unlink()

    log("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
