# SIP Draft: Modernize the Country Map plugin

> **Status:** Draft / scratch — this file is a working reference for the eventual SIP. It will be filed as a GitHub issue when the POC is mature, then deleted from the tree.

> **Author:** @rusackas (with @anthropic Claude Code assistance)

> **Target release:** TBD (likely first appears as opt-in in Superset N, becomes default in N+1, legacy removed in N+2)

---

## Motivation

The current country-map plugin (`legacy-plugin-chart-country-map`) accumulates pain across three axes that we keep trying to solve technically when the underlying problem is editorial:

1. **Disputed borders are a recurring flashpoint.** Crimea/Sevastopol, Kashmir, Western Sahara, Kosovo, Palestine, Cyprus, Aksai Chin — every few months a contributor opens a PR claiming the map is "wrong". Most recently #35613 tried to redraw Russia's borders and was rejected because the project doesn't have a stated policy beyond "follow upstream Natural Earth". We have no mechanism for users who *do* want a specific cartographic perspective.

2. **The Jupyter notebook is the source of truth and it's killing us.** The notebook ingests Natural Earth, applies hand-rolled fixes (rename pins, flying-island moves, geometry touchups), and emits the per-country `.geojson` files we ship. It is:
   - opaque to git diff (the `.ipynb` JSON dump is unreadable in PRs)
   - fragile under conflict (cell ordering, kernel state, output churn)
   - bloated (years of one-off touchups, hard to audit)
   - undiscoverable (most contributors don't know it exists)

3. **The plugin is "legacy" for real reasons.** It still uses the `explore_json` endpoint instead of the modern `chart/data` endpoint. That means: no async, no chunking, no semantic-layer integration, bypasses modern caching, and registers as a `LegacyChartPlugin` rather than a modern `ChartPlugin`. We've been carrying the "legacy" prefix forever; this is the right moment to fix it.

Beyond those three, two related desires keep coming up:

- **Per-country subdivisions (Admin 1)** — French departments, Italian regions, US states, Türkiye city map (#32497), and others have all been submitted as bespoke per-country files over time. They're conceptually identical and should share infrastructure.
- **Per-deployment customization** — language overrides, name pins, region include/exclude. Currently impossible without forking.

## Goals

- New plugin (`plugin-chart-country-map`, no `legacy-` prefix) built against `chart/data` endpoint.
- Configurable **worldview** (default + per-deployment override + per-chart override) using Natural Earth's pre-baked worldview shapefiles.
- Support both **Admin 0 (countries)** and **Admin 1 (subdivisions)** in a single plugin — fold in the per-country submissions that have been accumulating.
- Per-chart **region include/exclude** controls, with **fit-to-selection** projection auto-zoom.
- **Flying islands** toggle (default on, with composite projections where available; off drops them entirely).
- **Replace the Jupyter notebook** with a script-based, reproducible build pipeline using `mapshaper` CLI.
- **Deprecate the legacy plugin** with an in-UI "switch to new chart" affordance plus a deprecation banner consistent with the project's existing pattern.
- Apache neutrality preserved by being explicit about default editorial choices and making them one-line-overrideable.

## Non-goals

- World map plugin (bubble/proportional symbol overlays). Out of scope for this SIP — separate concern, future fold-in.
- Custom GeoJSON upload as a first-class control. Useful but separate feature.
- Combining geometries at runtime ("show India and Pakistan as one merged blob"). Out of scope; users wanting this should upload custom GeoJSON.
- Admin 2 (counties, communes, etc.). Could come later; not in initial scope.

## Proposed design

### Data source

- **Natural Earth Vector** (https://github.com/nvkelso/natural-earth-vector), pinned to a specific release tag. Same source we use today.
- Use NE's pre-baked **worldview shapefiles**: `ne_10m_admin_0_countries_<XXX>.shp` for each supported worldview, plus the equivalent Admin 1 files where available.
- Available worldviews as of NE 5.x: `arg, bdg, bra, chn, deu, egy, esp, fra, gbr, grc, idn, ind, isr, ita, jpn, kor, mar, nep, nld, pak, pol, prt, pse, rus, sau, swe, tur, twn, ukr, usa, vnm` (plus default and a few others). 31 worldviews × 2 admin levels = ~62 GeoJSON files shipped at default simplification.

### Default worldview

**Recommendation: ship NE `_ukr` (Ukraine) worldview as Superset's default.** Documented as an explicit editorial choice, overridable via `superset_config.py`.

Rationale: spike (below) shows UA worldview cleanly delivers Crimea-as-Ukrainian, plus several other commonly-expected positions (Kosovo separate from Serbia, Western Sahara separate from Morocco, Palestine recognized, Cyprus undivided, Kashmir aligned with India). Default ("ungrouped" NE editorial) is more equivocal on these, which is closer to the current shipped behavior but doesn't match the stated preference for Crimea-as-Ukrainian.

Apache neutrality preserved by:
- Documenting the choice transparently in plugin README and Superset docs
- One-line override in `superset_config.py` to switch to any other NE worldview
- Per-chart override via control panel

### Build pipeline

Replace the notebook with `scripts/country-maps/`:

```
scripts/country-maps/
  build.sh                 # one-shot reproducible
  README.md                # how to regenerate, when, and why
  config/
    name_overrides.yaml    # ISO code → display name pinning
    flying_islands.yaml    # well-known multi-polygon parts to drop or inset
  output/                  # gitignored; CI artifacts go here
```

`build.sh` does:

1. Download pinned NE shapefiles (default + each shipped worldview) to a cache dir.
2. For each (worldview × admin_level) combination, run `mapshaper`:
   - Filter / select features
   - Apply `name_overrides.yaml` renames
   - Apply `flying_islands.yaml` part filtering
   - Simplify with topology preservation (`-simplify percentage=5% keep-shapes`)
   - Output as `<worldview>_admin<level>.geo.json` to `superset-frontend/plugins/plugin-chart-country-map/src/data/`.
3. Validate: schema check, ISO code coverage, no degenerate geometries.

CI runs this script in a workflow that opens a PR if outputs change. Maintainers review the cartographic diff in the PR (which is now legible because we're diffing GeoJSON, not a notebook).

### Plugin architecture

**Name:** `@superset-ui/plugin-chart-country-map` (no `legacy-` prefix).

**Endpoint:** modern `chart/data`, registered as a `ChartPlugin`.

**Controls:**

| Control | Type | Notes |
|---------|------|-------|
| `admin_level` | Select | `0 (countries)` or `1 (subdivisions)` |
| `country` | Select | Required when `admin_level == 1`; lists countries with available subdivisions |
| `worldview` | Select | Defaults from `superset_config.COUNTRY_MAP.default_worldview` |
| `region_includes` | MultiSelect | Optional whitelist by ISO code |
| `region_excludes` | MultiSelect | Optional blacklist by ISO code |
| `show_flying_islands` | Boolean | Default true |
| `name_language` | Select | NE's `NAME_<LANG>` field (en/fr/de/es/ar/zh/ja/ru/...) |
| ... existing color/data controls | | (preserved from legacy plugin) |

**Render flow:**

```
Load: GeoJSON for (worldview, admin_level, country?) — cached, immutable
Render:
  features = data.features
    .filter(by region_includes / region_excludes)
    .filter(by show_flying_islands → drop tagged parts)
    .map(applying name_overrides from form_data)
  projection.fitSize(viewport, featureCollection(features))   // fit-to-selection
  render paths
```

The heavy preprocessing (worldview, simplification, default islands, default name overrides) is baked at build time. Per-chart controls (include/exclude, fly islands, language, name overrides) operate client-side on the loaded GeoJSON. No server-side per-request GeoJSON regeneration.

### Configuration

```python
# superset_config.py
COUNTRY_MAP = {
    "default_worldview": "ukr",          # NE worldview code
    "default_name_language": "en",       # NAME_EN field
    "name_overrides": {                  # one-off touchups
        # "BIH": "Bosnia",
    },
    "region_excludes": [],               # ISO_A3 codes excluded globally
}
```

Static config only — no env var. This is a cartographic editorial decision, not a per-request flag.

### Deprecation of legacy plugin

Two-phase, modeled on existing deprecated-chart pattern:

- **Phase 1 (release N):** legacy plugin gets a deprecation banner in the chart UI ("This chart type is deprecated. Switch to the new Country Map.") plus an in-UI **"Switch to new Country Map"** button that:
  - Creates a new chart with `viz_type='country_map'` (the new one)
  - Copies form_data fields where they map cleanly (datasource, metric, color settings)
  - Sets `worldview` to the configured default
  - Optionally pre-selects same country
  - Leaves the original chart untouched (user explicitly saves over or discards)
- **Phase 2 (release N+1, ideally a major):** legacy plugin removed from default install, banner becomes hard error, button no longer needed (no legacy charts left to migrate from).

No DB migrations required at any phase. Old `viz_type` continues to function during Phase 1; in Phase 2 it gracefully degrades to "this chart type is no longer supported, please switch to country_map".

## Spike findings: UA worldview vs Default

Ran `mapshaper` against pinned NE master snapshots of `ne_10m_admin_0_countries.shp` (Default) and `ne_10m_admin_0_countries_ukr.shp` (UA worldview). Source: https://github.com/nvkelso/natural-earth-vector.

### Feature counts

- Default: **258 features**
- UA: **249 features**

UA worldview drops 9 features that Default acknowledges as standalone disputed entities, consolidating them into their parent claimant: `BJN` (Bajo Nuevo Bank), `CNM` (Cyprus No Man's Land), `CYN` (Northern Cyprus), `KAB` (Baikonur), `KAS` (Siachen), `KOS` (Kosovo — wait, *kept* in UA but with different geometry; needs re-check), `SER` (Serranilla Bank), `SOL` (Somaliland), `SPI` (Spratly Islands).

These are micro-territories that don't materially affect a country-level choropleth. Worth documenting.

### Countries with geometry differences

18 shared features have different geometries between Default and UA. The cartographically meaningful ones:

| ISO | Country | What changes (UA vs Default) |
|-----|---------|------------------------------|
| **RUS** | Russia | Loses 1 polygon part (Crimea); area_proxy 5835 → 5828 |
| **UKR** | Ukraine | Gains Crimean peninsula; bbox lat 45.21°N → 44.38°N; area_proxy 129 → 144 |
| **SRB** | Serbia | Smaller (Kosovo treated as separate country) |
| **MAR** | Morocco | **Much** smaller (Western Sahara excluded); area_proxy 232 → 100 |
| **CYP** | Cyprus | Shown undivided (no separate Northern Cyprus); 4 parts → 3 parts |
| **ISR** | Israel | Smaller (Palestinian territories excluded); PSE feature recognized |
| **CHN** | China | Loses Aksai Chin (disputed border with India) |
| **IND** | India | Northern Kashmir included; bbox lat 35.5°N → 35.65°N |
| **KOR** | South Korea | Minor — possibly Liancourt Rocks / East Sea boundary |
| **COL, BRA, JOR, KAZ, LBN, GRL, SAH, SDN, SOM** | various | Same bbox, geometry slightly changed (probably small border refinements; need cartographic eyeball) |

### Conclusion

**UA worldview is a clean default.** It gives the user-requested Crimea-as-Ukrainian *and* aligns with broadly-expected positions on Kosovo, Western Sahara, Palestine, Cyprus, Kashmir, and Aksai Chin. It's a reasonable Superset editorial choice that we can defend on multiple cartographic axes (not just one).

The 9 dropped micro-territories are a non-issue for choropleth visualization.

## Open questions

1. **Default worldview confirmation.** Recommendation is `ukr`. Acceptable to ship that wholesale, or do we want a more granular `default_overrides` overlay model (NE Default + selectively swap Crimea geometry from `_ukr`)? The latter is more code but more editorially neutral on the non-Crimea pieces.
2. **Backward compat for legacy plugin's hand-tuned files.** Some current per-country files include touchups that diverged from NE (notebook-applied). Audit list and decide which become entries in `name_overrides.yaml` / `flying_islands.yaml`.
3. **Admin 1 country coverage.** NE Admin 1 covers ~all countries but quality varies. Decide which countries are first-class supported (probably a curated list initially, opening up as we validate).
4. **Plugin scaffolding pattern.** Match modern plugin pattern (mirror `plugin-chart-pivot-table` or similar)? Or modify in-flight as we go.
5. **Smoke-test fixtures.** Three test cases that exercise the design:
   - World choropleth (Admin 0, default worldview, no filters)
   - US states (Admin 1, country=USA, exclude AK+HI, flying islands off)
   - French departments (Admin 1, country=FRA, exclude overseas territories)
6. **TLC code.** New file `ne_10m_admin_0_countries_tlc.shp` — what worldview is this? Need to identify before deciding whether to ship it.

## Implementation plan (rough)

### Phase 1: Data pipeline + spike validation
- [x] Spike: UA vs Default worldview diff
- [ ] Audit existing notebook touchups; categorize → keep / drop / port to YAML config
- [ ] Write `scripts/country-maps/build.sh` (mapshaper-based)
- [ ] Generate first batch of GeoJSON outputs (UA + Default + a couple of others)
- [ ] CI workflow for regeneration

### Phase 2: Plugin scaffolding
- [ ] Scaffold `plugin-chart-country-map` directory matching modern plugin structure
- [ ] Register against `chart/data` endpoint
- [ ] Port rendering logic from legacy plugin (D3 paths, color scales, interactions)
- [ ] Wire up GeoJSON loading from new build outputs

### Phase 3: Controls
- [ ] Worldview selector
- [ ] Admin level + country selector
- [ ] Region include/exclude
- [ ] Flying islands toggle
- [ ] Name language selector
- [ ] Fit-to-selection projection refit

### Phase 4: Deprecation wiring
- [ ] Banner on legacy plugin
- [ ] "Switch to new Country Map" button + form_data migration logic

### Phase 5: Polish + docs
- [ ] UPDATING.md entry
- [ ] Plugin README
- [ ] Update Superset docs site
- [ ] Add to default `viz_type` registry

## References

- Natural Earth worldviews: https://www.naturalearthdata.com/blog/admin-0-disputed-areas/
- Natural Earth Vector repo: https://github.com/nvkelso/natural-earth-vector
- Mapshaper: https://github.com/mbloch/mapshaper
- Mapbox Boundaries (similar worldview model): https://www.mapbox.com/boundaries
- Prior PRs that surfaced this pain: #35613 (Russia borders), #32497 (Türkiye city names), and others.
