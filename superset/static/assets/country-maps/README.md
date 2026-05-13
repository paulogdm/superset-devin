# Country map GeoJSON outputs

> **Generated files — do not hand-edit.**

These GeoJSON files are produced by the build pipeline at
`superset-frontend/plugins/plugin-chart-country-map/scripts/build.py`
and consumed at runtime by the modern Country Map chart plugin.

## To regenerate

```bash
cd superset-frontend/plugins/plugin-chart-country-map/scripts
./build.sh
```

The build script is reproducible: same Natural Earth pinned tag + same YAML configs → identical outputs.

## File naming

| Pattern | Contents |
|---|---|
| `<worldview>_admin0.geo.json` | World choropleth (countries layer) |
| `<worldview>_admin1_<adm0_a3>.geo.json` | Subdivisions of one country |
| `regional_<adm0_a3>_<set>_<worldview>.geo.json` | Aggregated regional layer (e.g. Türkiye NUTS-1) |
| `composite_<id>_<worldview>.geo.json` | Multi-country composite (e.g. France with overseas) |
| `manifest.json` | Index of what was built (NE pinned SHA, worldviews, etc.) |

## Why are these committed?

Committing the build outputs means a fresh ephemeral environment can render the chart immediately without first running the build pipeline. Trade-off: ~17 MB of files in the repo. (For comparison, the legacy plugin committed ~34 MB of GeoJSON in its `src/countries/` directory, so this is a net reduction.)

If/when this becomes a maintenance burden, options include:
- Gitignore + run `build.sh` as a postinstall step
- Move outputs to a CDN-hosted asset bucket
- Lazy-generate per-country files server-side on first request

## Hosting

Flask serves the `superset/static/` tree at the URL prefix `/static/`, so these files are served at `/static/assets/country-maps/<filename>`. The plugin's `transformProps.ts` constructs URLs against this prefix.
