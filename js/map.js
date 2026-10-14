import { LEVELS, keyOf } from "./filters.js";

const PARTY_COLORS = {
  DEMOCRATIC: "#2166ac",
  REPUBLICAN: "#b2182b",
};
const OTHER_COLOR = "#8073ac";
const NO_DATA_COLOR = "#e0e0e0";

// Tableau 10 — qualitative palette for single-party contests (primaries)
// and nonpartisan elections, where party colors carry no meaning.
const QUALITATIVE_PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
];

const MAX_POPUP_CANDIDATES = 5;

// OpenFreeMap Positron (free, no API key; OpenMapTiles data). We split the
// style's label layers out of the base style and re-add them AFTER the
// choropleth layers so place names render on top of the polygons.
const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export async function initMap() {
  const style = await fetch(BASEMAP_STYLE_URL).then((r) => {
    if (!r.ok) throw new Error(`Basemap style HTTP ${r.status}`);
    return r.json();
  });
  const isLabel = (l) => l.type === "symbol" && l.layout?.["text-field"];
  const labelLayers = style.layers.filter(isLabel);
  style.layers = style.layers.filter((l) => !isLabel(l));

  const map = new maplibregl.Map({
    container: "map",
    style,
    center: [-89.6, 44.5],
    zoom: 6,
  });
  map.addControl(new maplibregl.NavigationControl());

  const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

  map.on("load", () => {
    map.addSource("units", { type: "geojson", data: emptyFC() });
    map.addLayer({
      id: "units-fill",
      type: "fill",
      source: "units",
      paint: {
        "fill-color": ["coalesce", ["get", "color"], NO_DATA_COLOR],
        "fill-opacity": [
          "case",
          ["has", "margin"],
          ["interpolate", ["linear"], ["get", "margin"], 0, 0.25, 25, 0.65, 60, 0.95],
          0.05,
        ],
      },
    });
    map.addLayer({
      id: "units-line",
      type: "line",
      source: "units",
      paint: { "line-color": "#ffffff", "line-width": 0.5, "line-opacity": 0.7 },
    });

    // Basemap labels on top of the choropleth (vector, so they stay crisp).
    for (const l of labelLayers) map.addLayer(l);

    map.on("mousemove", "units-fill", (e) => {
      const f = e.features?.[0];
      if (!f || !f.properties.candidates) return;
      map.getCanvas().style.cursor = "pointer";
      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(popupHTML(f.properties))
        .addTo(map);
    });
    map.on("mouseleave", "units-fill", () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });

    // Clicking pins the same content in a persistent popup.
    map.on("click", "units-fill", (e) => {
      const f = e.features?.[0];
      if (!f || !f.properties.candidates) return;
      hoverPopup.remove();
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" })
        .setLngLat(e.lngLat)
        .setHTML(popupHTML(f.properties))
        .addTo(map);
    });
  });

  return map;
}

function emptyFC() {
  return { type: "FeatureCollection", features: [] };
}

function partyColor(party) {
  return PARTY_COLORS[party] ?? OTHER_COLOR;
}

function popupHTML(props) {
  const cands = JSON.parse(props.candidates);
  const shown = cands.slice(0, MAX_POPUP_CANDIDATES);
  const rows = shown
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.candidate)}</td>
        <td>${escapeHtml(c.party)}</td>
        <td class="num">${c.votes.toLocaleString()}</td>
        <td class="num">${c.pct.toFixed(1)}%</td>
      </tr>`
    )
    .join("");
  const more =
    cands.length > shown.length
      ? `<div class="popup-more">+ ${cands.length - shown.length} more (see Table tab)</div>`
      : "";
  return `<h3>${escapeHtml(props.name)}</h3>
    <table>${rows}</table>
    ${more}
    <div style="margin-top:4px;color:#777">Total: ${props.total.toLocaleString()} votes</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function renderLegend(entries) {
  const el = document.getElementById("legend");
  if (!el) return;
  if (entries.length === 0) {
    el.style.display = "none";
    return;
  }
  const body = el.querySelector("#legend-body");
  if (!body) return;
  body.innerHTML = entries
    .map(
      (e) => `<div class="legend-row">
        <span class="legend-swatch" style="background:${e.color}"></span>
        <span>${escapeHtml(e.label)}</span>
      </div>`
    )
    .join("");
  el.style.display = "block";
}

// Join votes rows to geo rows, build a colored FeatureCollection, update the map.
export function updateMap(map, { votes, geo, level }) {
  const cfg = LEVELS[level];

  // Contest-wide candidate totals, to pick a coloring scheme and sort the legend.
  const candTotals = new Map();
  const candParty = new Map();
  const parties = new Set();
  for (const v of votes) {
    candTotals.set(v.candidate, (candTotals.get(v.candidate) ?? 0) + v.votes);
    candParty.set(v.candidate, v.party);
    if (v.party && !/^(SCATTERING|WRITE-IN)/.test(v.party)) parties.add(v.party);
  }
  // With fewer than 2 real parties in the contest (partisan primary or
  // nonpartisan race), color by candidate with a qualitative palette.
  const qualitative = parties.size < 2;
  const sortedCands = [...candTotals.keys()].sort(
    (a, b) => candTotals.get(b) - candTotals.get(a)
  );
  const candColor = new Map(
    sortedCands.map((c, i) => [c, QUALITATIVE_PALETTE[i % QUALITATIVE_PALETTE.length]])
  );
  const colorFor = (candidate, party) =>
    qualitative ? candColor.get(candidate) : partyColor(party);

  // Group by unit, merging rows for the same candidate: municipalities that
  // straddle county lines appear once per county segment with partial votes.
  const byUnit = new Map();
  for (const v of votes) {
    const k = keyOf(v, cfg.keys);
    if (!byUnit.has(k)) byUnit.set(k, new Map());
    const cands = byUnit.get(k);
    const ck = `${v.candidate}|${v.party}`;
    if (cands.has(ck)) cands.get(ck).votes += v.votes;
    else cands.set(ck, { ...v });
  }

  const features = [];
  let anyNoData = false;
  for (const g of geo) {
    const k = keyOf(g, cfg.keys);
    const cands = byUnit.get(k);
    const rows = cands ? [...cands.values()] : null;
    const geometry = JSON.parse(g.gj);
    if (!rows || rows.length === 0) {
      anyNoData = true;
      features.push({ type: "Feature", geometry, properties: { noData: 1 } });
      continue;
    }
    rows.sort((a, b) => b.votes - a.votes);
    const total = rows.reduce((s, r) => s + r.votes, 0);
    const [first, second] = rows;
    const margin = total > 0 ? ((first.votes - (second?.votes ?? 0)) / total) * 100 : 0;
    features.push({
      type: "Feature",
      geometry,
      properties: {
        name: cfg.label(rows[0]),
        color: colorFor(first.candidate, first.party),
        margin,
        total,
        candidates: JSON.stringify(
          rows.map((r) => ({
            candidate: r.candidate,
            party: r.party,
            votes: r.votes,
            pct: total > 0 ? (r.votes / total) * 100 : 0,
          }))
        ),
      },
    });
  }

  const legendEntries = sortedCands.map((c) => {
    const p = candParty.get(c);
    return { color: colorFor(c, p), label: p ? `${c} (${p})` : c };
  });
  if (anyNoData) legendEntries.push({ color: NO_DATA_COLOR, label: "No data" });
  renderLegend(legendEntries);

  const fc = { type: "FeatureCollection", features };
  const src = map.getSource("units");
  if (src) src.setData(fc);
  else map.once("load", () => map.getSource("units").setData(fc));
}
