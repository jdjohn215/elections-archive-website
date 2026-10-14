# Wisconsin Elections Archive website

A static website for browsing Wisconsin election results from 2000 onward.
Filter by year, election (month), aggregation level, and contest; view results
as a choropleth map or a candidate-summary table. Everything runs in the
browser: [duckdb-wasm](https://duckdb.org/docs/api/wasm) queries the parquet
files over HTTP, and [MapLibre GL](https://maplibre.org/) renders the map.

## Tabs

- **Map** — choropleth of the selected contest at the selected aggregation
  level, colored by winner party with opacity scaled to the margin.
- **Table** — candidate vote totals and percentages for the selected contest,
  filterable to a single geography unit.
- **Comparison Tables** — two pivot views:
  - *Single contest across geographies*: one row per geography unit for the
    current sidebar selection, with total votes and a % column per candidate.
    Geography rows are text-filterable and all columns are sortable.
  - *Multiple contests for a single geography*: pick a geography (statewide,
    county, municipality, minor civil division, or congressional / state
    senate / state assembly district) and see every November general election
    contest for that unit across all available years — year, contest, total
    votes, Democratic %, Republican %, and Combined Other %. Contests are
    text-filterable (e.g. type "president") and columns are sortable.
- **About** — background on the data and the site.

## Layout

- `index.html`, `style.css`, `js/` — the site (vanilla JS, no build step)
- `data/votes/` — Hive-partitioned vote totals
  (`aggregation_level=L/year=Y/month=M/part-0.parquet`)
- `data/geo/` — one WKB-geometry parquet file per aggregation level
- `data/metadata.json` — available (level, year, month) triples, used to
  populate the filter dropdowns
- `election-results/` — source copy of `data/`
- `write-geoparquet.R` — regenerates `election-results/` (and, via
  `data/metadata.json`, the site metadata) from the raw archive

## Local development

Serve the repo root over HTTP (required; the app fetches parquet and JSON):

```sh
Rscript -e 'servr::httd(dir = ".", port = 8765)'
```

then open http://127.0.0.1:8765. `servr` (via httpuv) supports HTTP range
requests, which duckdb-wasm needs to read parquet efficiently.

Any static file server with range-request support works. Note that
`python3 -m http.server` does not support ranges, so duckdb-wasm falls back
to downloading whole parquet files — fine for most levels, but the
reporting-unit geometry (~40 MB) will be slow.

## Deployment (GitHub Pages)

The site is fully static. Push the repo (including `data/`) and enable
GitHub Pages on the repository root. GitHub Pages supports range requests,
so duckdb-wasm reads parquet efficiently in production. Note the largest
geometry files are 35–41 MB; GitHub Pages' 100 MB per-file limit is not a
problem, but total repo size should stay well under the 1 GB soft limit.

## Regenerating data

Run `write-geoparquet.R` in R, then regenerate metadata via `update-metadata.R` and refresh `data/`:

```r
source("write-geoparquet.R")   # rewrites election-results/
```

then rebuild `data/metadata.json` from the votes partition layout and
re-copy `election-results/` into `data/`.
