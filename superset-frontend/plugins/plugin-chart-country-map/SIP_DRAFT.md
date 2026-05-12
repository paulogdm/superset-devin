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

## Notebook audit: existing touchups and how the new design covers them

Audit of `superset-frontend/plugins/legacy-plugin-chart-country-map/scripts/Country Map GeoJSON Generator.ipynb` (96 cells). Categorized below to confirm the new design has a home for each kind of work the notebook does.

Status legend:
- ✅ **Covered** — handled cleanly by the new design as currently sketched
- 🟡 **Needs config** — handled, but requires entries in YAML config files that we'll need to port
- 🟠 **Needs new feature** — design needs an addition before this works
- ⚪ **Can become obsolete** — current NE may have fixed the underlying problem; verify per case

### Category 1 — Data ingestion and scale blending ✅

Notebook downloads NE Admin 0 + Admin 1 at 10m and 50m, blends them (uses 50m for some large countries to cap file size). New `build.sh` does the same; mapshaper handles per-country `-simplify` more cleanly than the notebook's hand-tuned switch.

### Category 2 — Country list curation 🟡 → ✅

Cell 12 hand-curates ~190 countries with an alias dict (`korea`→`south korea`, etc.) and inline comments documenting why some entries are commented out (territories that NE rolls into a parent country). New design generates this list deterministically from NE's ISO_A3 codes; aliases handled by the `name_language` field. Auto-purge of single-subdivision countries (cell 89) becomes a build-script default.

### Category 3 — Flying islands repositioning 🟡 (config-driven)

The biggest category. Each `reposition()` call translates and scales a far-flung territory to fit within or near the mainland viewport. Maps to `flying_islands.yaml` entries (one per country/territory):

| Country | Territories repositioned | Cell |
|---------|--------------------------|------|
| **USA** | Hawaii, Alaska | 19 |
| **Norway** | Svalbard | 34 |
| **Portugal** | Azores, Madeira (with extra `simplify=0.015`) | 37 |
| **Spain** | Las Palmas, Santa Cruz de Tenerife (Canary Islands) | 40 |
| **France** | Guadeloupe, Martinique, Guyane française, La Réunion, Mayotte | 56 |

Each entry encodes `(territory_id, x_offset, y_offset, x_scale, y_scale, simplify?)`. Build script applies them.

D3 composite projections (e.g. `geoAlbersUsa`, `geoConicEqualAreaFrance`) handle some of these natively at *render* time without geometry mutation — worth offering as an alternative path per-country where available.

### Category 4 — Antimeridian fix 🟡 → ✅

Cell 44's `shift_geom` splits Russia's Chukchi Autonomous Okrug at the 180° meridian and translates the eastern part by +360° so it renders contiguously. **Mapshaper has `-clip` and `-affine` operators that do this cleanly.** Single use case currently (Russia/Chukchi); if more crop up, generalize.

### Category 5 — Bounds clipping 🟡 (config-driven)

Cells 69-71, 76: `apply_bounds(df, NW, SE)` filters out features whose geometries don't fit a bbox. Used for:

| Country | Bounding box | Purpose | Cell |
|---------|--------------|---------|------|
| **Netherlands** | NW=(-20, 60), SE=(20, 20) | Drop Caribbean territories (Bonaire, Sint Eustatius, Saba, ABC islands) | 71 |
| **UK** | NW=(-10, 60), SE=(20, 20) | Drop British Overseas Territories | 76 |

These overlap conceptually with flying islands. Decision: same `flying_islands.yaml` config, with two action modes — `drop` (current bounds-clip behavior) or `reposition` (current reposition behavior). Tied to the per-chart "Show flying islands" toggle.

### Category 6 — Adding territories to a country 🟠 (needs new feature)

The notebook has cases where it *adds* features to a country that NE has as a separate Admin 0 entity:

| Country | Added territories | Cell |
|---------|-------------------|------|
| **China** | Taiwan (CN-71), Hong Kong (CN-91), Macau (CN-92) — with Chinese names | 21-22 |
| **Finland** | Åland (FI-01) — with Finnish name | 25-26 |
| **Ukraine** | Crimea (UA-43), Sevastopol (UA-40) — moved from Russia | 28 |

**The Ukraine case is now handled by worldview selection (NE `_ukr` does this for free).**

The China and Finland cases are *editorial decisions*, not worldview decisions — NE genuinely has Taiwan as separate Admin 0, Åland as separate Admin 0, etc. We need a `territory_assignments.yaml` config that says "for the China Admin 1 view, also include features X, Y, Z from these other Admin 0 records, with these renamed iso codes". This is a real new feature in the build pipeline. Not hard to implement.

### Category 7 — Reassigning territories ✅ (covered by worldview)

The Crimea/Sevastopol move from Russia to Ukraine (cell 28) is exactly what UA worldview gives us for free. Confirmed by spike. **No config or code needed for this case in the new design.** Other reassignments (if they emerge) would also be candidates for worldview switches first, `territory_assignments.yaml` second.

### Category 8 — External GeoJSON replacement 🟠 (needs new feature, or work to obsolete)

The notebook fully bypasses NE for three countries by downloading third-party GeoJSON files:

| Country | Source | Why | Cell |
|---------|--------|-----|------|
| **India** | `geohacker/india` (Kashmir + Ladakh state shapes) | NE's India subdivisions deemed inadequate for J&K/Ladakh | 30 |
| **Latvia** | `eriks47/latvia` | NE's Latvia subdivisions deemed inadequate | 73 |
| **Philippines** | `jdruii/phgeojson` | NE's Philippines subdivisions deemed inadequate | 78 |

This is the gnarliest category. Two paths:

1. **Vendor the third-party GeoJSON in-tree** under `scripts/country-maps/external/` and have the build script merge them with the NE outputs. Config entry per country specifies the source file + which NE features it replaces.
2. **Verify that current NE 5.x has improved** for these countries — possibly some of these hacks are obsolete. If so, drop the override, accept what NE ships.

Action: per-country verification spike before the SIP locks in. If even one needs to stay, we ship path 1 as a first-class config layer (`external_overrides.yaml`).

### Category 9 — Name fixes (typos, encoding, native names) 🟡 (config-driven)

Three sub-cases:

- **Typo fixes**: France (Seien→Seine, Haute→Haut), iso_3166_2 corrections (FR-75→FR-75C, FR-GP→FR-971, etc.) — cell 55
- **Native script / diacritics**: Vietnam (~12 city names with Vietnamese diacritics) — cell 86; China SAR Chinese names; Finland Åland Finnish name
- **Administrative renames**: Philippines (Dinagat→Caraga, ARMM→BARMM) — cell 83

All map to entries in `name_overrides.yaml` keyed by ISO code. The native script cases might also be obsoleted by exposing NE's `NAME_<lang>` fields directly via the `name_language` selector — verify per case.

### Category 10 — Region aggregation (Admin 1 → administrative regions) 🟠 (needs new feature)

Notebook builds *intermediate* admin levels by dissolving Admin 1 into administrative regions:

| Country | Aggregation | Source |
|---------|-------------|--------|
| **Turkey** | NUTS-1 (12 statistical regions) — manually-coded city→region dict | Cell 48 |
| **France** | Administrative regions (dissolved from departments) | Cell 58-59 |
| **Italy** | Regions (dissolved from provinces) | Cell 66 |
| **Philippines** | Regions (dissolved from provinces) | Cell 81-82 |

Currently each is its own special case. Generalize via a `regional_aggregations.yaml` config: per (country, region_set_name), specify the mapping (Admin 1 ISO → region code + region name). Build script dissolves accordingly. New plugin exposes this as a third "admin level" option (`Admin 0 / Admin 1 / Aggregated regions`) when one is defined for the selected country.

This is a real feature, not just config porting. Worth calling out in the SIP as in-scope-but-distinct.

### Category 11 — Composite multi-country maps 🟠 (needs new feature, or punt)

Cell 63 ("France with Overseas") assembles a single map combining features from multiple Admin 0 entities (France + French Polynesia + French Southern Lands + Wallis-Futuna + New Caledonia + Saint-Pierre), each repositioned + dissolved. This is unique to the notebook.

Three paths:

1. **First-class composite-map support**: define `composite_maps.yaml` with rules for which Admin 0 records contribute to a composite, plus per-territory reposition rules. Build script generates a single composite GeoJSON.
2. **Punt to "France" + "France with Overseas" as two distinct map options**, where the second is hand-curated upstream of the build pipeline. Smaller scope but loses the elegance.
3. **Drop France-with-Overseas entirely** in the new plugin and let users use the regular France map; document the loss in UPDATING.md.

I'd argue **path 1** is small enough to fit the SIP scope and the cleanest answer. Builds reuse the same flying-islands + territory-assignment primitives. Path 3 would lose a feature people use.

### Category 12 — Geometry simplification ✅

Cell 90: hand-tuned `simplify_factors` per country, plus a size-based default. Mapshaper does this better with `-simplify` per layer. Build script per-country override config if needed.

### Category 13 — Output formatting ✅

Cell 90/94: writes per-country GeoJSON files plus a TypeScript `countries.ts` index with display-name overrides. New plugin generates the index from a known list of (worldview × admin level × country) tuples; display-name overrides become entries in `name_overrides.yaml`.

Backward-compatibility column rename (`iso_3166_2` → `ISO`, `name` → `NAME_1`) at the legacy plugin's data layer is a thing the new plugin doesn't need to inherit (we control both producer and consumer).

### Category 14 — Quality filtering ✅

Cell 89: auto-purge countries with only one subdivision. Becomes a build-script default. Already noted under Category 2.

### Summary of what the new design needs to add

To be a strict superset of the notebook's capabilities, the new design needs these config files / pipeline features beyond what's already sketched:

1. **`name_overrides.yaml`** ✅ (already in plan) — covers categories 2, 9, 13
2. **`flying_islands.yaml`** ✅ (already in plan, but extend with `drop|reposition` action modes) — covers categories 3, 5
3. **`territory_assignments.yaml`** 🟠 (NEW) — for adding features from other Admin 0 records (China + SARs, Finland + Åland) — covers category 6
4. **`regional_aggregations.yaml`** 🟠 (NEW) — for Admin 1 → administrative-region dissolves (Turkey NUTS-1, France/Italy/Philippines regions) — covers category 10
5. **`composite_maps.yaml`** 🟠 (NEW) — for France-with-overseas-style multi-country composites — covers category 11
6. **`external_overrides.yaml`** 🟠 (NEW, possibly obsolete) — for India/Latvia/Philippines third-party GeoJSON replacements — covers category 8 (verify per case)
7. **Antimeridian handling** ✅ (mapshaper primitives)

The four `🟠 NEW` items are the design surface this audit added beyond what we'd already discussed. None of them are large; each is a config-driven build-script transform.

## Open questions

1. **Default worldview confirmation.** Recommendation is `ukr`. Acceptable to ship that wholesale, or do we want a more granular `default_overrides` overlay model (NE Default + selectively swap Crimea geometry from `_ukr`)? The latter is more code but more editorially neutral on the non-Crimea pieces. — **resolved: ship `ukr` wholesale**
2. **External GeoJSON overrides (notebook category 8).** India, Latvia, Philippines currently replace NE entirely with third-party GeoJSON. Per-country verification needed: are these still required against current NE 5.x, or has NE caught up? If even one needs to stay, we need to design `external_overrides.yaml` as a first-class config layer.
3. **Composite maps (notebook category 11).** France-with-Overseas combines features from 6 different Admin 0 records. Three options: build first-class `composite_maps.yaml` support, ship hand-curated alternatives, or drop the feature entirely. **Lean: first-class config support.**
4. **Regional aggregations (notebook category 10).** Turkey NUTS-1, France/Italy/Philippines regions need a `regional_aggregations.yaml` and a third "admin level" UX option (`Admin 0 / Admin 1 / Aggregated regions`). Confirm scope.
5. **Admin 1 country coverage.** NE Admin 1 covers ~all countries but quality varies. Decide which countries are first-class supported (probably a curated list initially, opening up as we validate).
6. **Plugin scaffolding pattern.** Match modern plugin pattern (mirror `plugin-chart-pivot-table` or similar)? Or modify in-flight as we go.
7. **Smoke-test fixtures.** Five test cases that exercise the design end-to-end:
   - World choropleth (Admin 0, default worldview, no filters)
   - US states (Admin 1, country=USA, flying islands ON via Albers composite — Hawaii/Alaska repositioned)
   - US states (Admin 1, country=USA, flying islands OFF — Hawaii/Alaska dropped, viewport fits to mainland)
   - French departments (Admin 1, country=FRA, with the France-with-Overseas composite)
   - Turkey aggregated regions (Admin 1 → NUTS-1, country=TUR)
8. **TLC code.** New file `ne_10m_admin_0_countries_tlc.shp` — what worldview is this? Need to identify before deciding whether to ship it.
9. **Verify which notebook fixes are obsolete in current NE.** For each notebook touchup (typos, encoding, geometry replacements), check whether NE 5.x has it correct. Reduces config-file size; smaller surface to maintain.

## Implementation plan (rough)

### Phase 1: Data pipeline + spike validation
- [x] Spike: UA vs Default worldview diff
- [x] Audit existing notebook touchups; categorize → keep / drop / port to YAML config (see "Notebook audit" section)
- [ ] Per-country obsolescence check: which notebook fixes are no longer needed against current NE 5.x?
- [ ] Per-country external-GeoJSON check: do India / Latvia / Philippines still need third-party data?
- [ ] Design + draft `name_overrides.yaml`, `flying_islands.yaml`, `territory_assignments.yaml`, `regional_aggregations.yaml`, `composite_maps.yaml` (and `external_overrides.yaml` if needed)
- [ ] Write `scripts/country-maps/build.sh` (mapshaper-based) consuming the YAML configs
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
