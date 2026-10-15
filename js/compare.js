import { query, dataUrl } from "./db.js";
import { LEVELS, keyOf, votesPath, loadUnitNames, COUNTY_NAMES, countyName } from "./filters.js";
import { setupUnitFilter } from "./table.js";

// Comparison Tables tab: two modes sharing one table element.
//  - "contest":   the current sidebar selection, pivoted to one row per
//                 geography unit with a % column per candidate.
//  - "geography": one geography unit across all November elections/years,
//                 one row per contest with Dem/Rep/Other vote shares.

const GEO_LEVELS = {
  statewide: { votesLevel: "county", key: null, label: "Statewide" },
  county: { votesLevel: "county", key: "county_fips", label: "County" },
  municipality: { votesLevel: "municipality", key: "muni_fips", label: "Municipality" },
  "minor civil division": {
    votesLevel: "minor civil division",
    key: "mcd_fips",
    label: "Minor civil division",
  },
  "congressional district": {
    votesLevel: "congressional district",
    key: "con_dist",
    label: "Congressional district",
  },
  "state senate district": {
    votesLevel: "state senate district",
    key: "wss_dist",
    label: "State senate district",
  },
  "state assembly district": {
    votesLevel: "state assembly district",
    key: "wsa_dist",
    label: "State assembly district",
  },
};

const pct = (v, total) => (total > 0 ? ((v / total) * 100).toFixed(1) + "%" : "—");
const pctNum = (v, total) => (total > 0 ? (v / total) * 100 : 0);

export function setupComparison({ metadata }) {
  const els = {
    contestControls: document.getElementById("compare-contest-controls"),
    geographyControls: document.getElementById("compare-geography-controls"),
    context: document.getElementById("compare-context"),
    geoFilter: document.getElementById("compare-geo-filter"),
    level: document.getElementById("compare-level"),
    unitWrap: document.getElementById("compare-unit-wrap"),
    contestFilter: document.getElementById("compare-contest-filter"),
    status: document.getElementById("compare-status"),
    table: document.getElementById("compare-table"),
  };

  let mode = "contest";
  let lastState = null;
  let lastVotes = null;
  let lastRequest = 0;

  function setStatus(msg, isError = false) {
    els.status.textContent = msg;
    els.status.classList.toggle("error", isError);
  }

  // Shared sortable-table view state. columns: [{key, label, num, title,
  // value(row), render?(row)}]; rows: plain objects; sort: {key, dir} | null.
  let view = { columns: [], rows: [], sort: null, filter: "" };

  function draw() {
    const thead = els.table.querySelector("thead");
    const tbody = els.table.querySelector("tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    const hr = document.createElement("tr");
    for (const c of view.columns) {
      const th = document.createElement("th");
      const arrow = view.sort?.key === c.key ? (view.sort.dir === 1 ? " ▲" : " ▼") : "";
      th.textContent = c.label + arrow;
      if (c.num) th.classList.add("num");
      if (c.title) th.title = c.title;
      th.classList.add("sortable");
      th.addEventListener("click", () => {
        if (view.sort?.key === c.key) view.sort.dir *= -1;
        else view.sort = { key: c.key, dir: c.num ? -1 : 1 };
        draw();
      });
      hr.appendChild(th);
    }
    thead.appendChild(hr);

    let rows = view.rows;
    if (view.filter) {
      const col = view.columns.find((c) => c.key === view.filterKey) ?? view.columns[0];
      rows = rows.filter((r) =>
        String(col.value(r)).toLowerCase().includes(view.filter)
      );
    }
    if (view.sort) {
      const col = view.columns.find((c) => c.key === view.sort.key);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          const cmp = col.num ? va - vb : String(va).localeCompare(String(vb));
          return cmp * view.sort.dir;
        });
      }
    }

    for (const r of rows) {
      const tr = document.createElement("tr");
      for (const c of view.columns) {
        const td = document.createElement("td");
        td.textContent = c.render ? c.render(r) : String(c.value(r));
        if (c.num) td.classList.add("num");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function clearTable() {
    view = { columns: [], rows: [], sort: null, filter: "" };
    draw();
  }

  // ---------- Mode 1: single contest across geographies ----------

  function renderContestMode() {
    if (!lastState || !lastVotes) {
      clearTable();
      return;
    }
    const { keys, label } = LEVELS[lastState.level];
    els.table.classList.add("mode-contest");
    els.context.textContent =
      `${lastState.contest} — ${lastState.month} ${lastState.year}, ${lastState.level} level, ` +
      `${lastState.integration === "spatial" ? "spatially" : "nominally"} integrated. ` +
      `Change the sidebar filters to update this table.`;

    const units = new Map();
    const candTotals = new Map();
    const partyOf = new Map();
    for (const r of lastVotes) {
      const k = keyOf(r, keys);
      let u = units.get(k);
      if (!u) {
        u = { label: label(r), total: 0, cands: new Map() };
        units.set(k, u);
      }
      u.total += r.votes;
      u.cands.set(r.candidate, (u.cands.get(r.candidate) ?? 0) + r.votes);
      candTotals.set(r.candidate, (candTotals.get(r.candidate) ?? 0) + r.votes);
      if (!partyOf.has(r.candidate)) partyOf.set(r.candidate, r.party);
    }
    const cands = [...candTotals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

    view = {
      columns: [
        { key: "label", label: "Geography", value: (r) => r.label },
        {
          key: "total",
          label: "Total votes",
          num: true,
          value: (r) => r.total,
          render: (r) => Math.round(r.total).toLocaleString(),
        },
        ...cands.map((c) => ({
          key: "pct:" + c,
          label: `% ${c}`,
          title: partyOf.get(c) ?? "",
          num: true,
          value: (r) => pctNum(r.cands.get(c) ?? 0, r.total),
          render: (r) => pct(r.cands.get(c) ?? 0, r.total),
        })),
      ],
      rows: [...units.values()].sort((a, b) => b.total - a.total),
      sort: null,
      filter: els.geoFilter.value.trim().toLowerCase(),
      filterKey: "label",
    };
    setStatus("");
    draw();
  }

  els.geoFilter.addEventListener("input", () => {
    view.filter = els.geoFilter.value.trim().toLowerCase();
    draw();
  });

  // ---------- Mode 2: multiple contests for a single geography ----------

  for (const [value, cfg] of Object.entries(GEO_LEVELS)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = cfg.label;
    els.level.appendChild(opt);
  }
  els.unitWrap.hidden = els.level.value === "statewide";

  const integration = () => lastState?.integration ?? "nominal";

  const novemberYears = (votesLevel) =>
    [...new Set(
      metadata
        .filter((m) => m.integration === integration() &&
                       m.level === votesLevel && m.month === "NOVEMBER")
        .map((m) => m.year)
    )].sort((a, b) => b - a);

  // Unit options for the combobox, per geography level.
  async function unitOptionsFor(levelName) {
    const cfg = GEO_LEVELS[levelName];
    if (levelName === "county") {
      return Object.entries(COUNTY_NAMES)
        .map(([fips, name]) => ({ key: fips, label: `${name} County` }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    if (integration() === "spatial") {
      // Spatially integrated files carry unit names at the August 2026
      // vintage; enumerate them from the most recent November file.
      const years = novemberYears(cfg.votesLevel);
      if (years.length === 0) return [];
      const url = dataUrl(votesPath(cfg.votesLevel, years[0], "NOVEMBER", "spatial"));
      const rows = await query(
        `SELECT DISTINCT ${cfg.key} AS k, municipality, ctv, county_fips
         FROM read_parquet('${url}') ORDER BY k`
      );
      return rows.map((n) => ({
        key: String(n.k),
        label:
          `${n.ctv || ""} ${n.municipality ?? ""}`.trim() +
          (cfg.key === "mcd_fips" ? `, ${countyName(n.county_fips)}` : ""),
      })).sort((a, b) => a.label.localeCompare(b.label));
    }
    if (levelName === "municipality" || levelName === "minor civil division") {
      const { byMuni, byMcd } = await loadUnitNames();
      const isMcd = levelName === "minor civil division";
      const map = isMcd ? byMcd : byMuni;
      return [...map.values()]
        .map((n) => ({
          key: String(isMcd ? n.mcd_fips : n.muni_fips),
          label:
            `${n.ctv || ""} ${n.municipality ?? ""}`.trim() +
            (isMcd ? `, ${countyName(n.county_fips)}` : ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    // District levels: enumerate ids from the most recent November file.
    const years = novemberYears(cfg.votesLevel);
    if (years.length === 0) return [];
    const url = dataUrl(votesPath(cfg.votesLevel, years[0], "NOVEMBER", integration()));
    const rows = await query(
      `SELECT DISTINCT ${cfg.key} AS k FROM read_parquet('${url}') ORDER BY k`
    );
    return rows.map((r) => ({
      key: String(r.k),
      label: LEVELS[levelName].label({ [cfg.key]: r.k }),
    }));
  }

  async function runGeographyMode() {
    const levelName = els.level.value;
    const cfg = GEO_LEVELS[levelName];
    const unitKey = cfg.key ? unitFilter.value() : null;
    if (cfg.key && unitKey == null) {
      clearTable();
      setStatus("Select a unit above to build the table.");
      return;
    }
    const years = novemberYears(cfg.votesLevel);
    if (years.length === 0) {
      clearTable();
      setStatus("No November elections available for this geography.", true);
      return;
    }
    const reqId = ++lastRequest;
    const rows = [];
    try {
      for (let i = 0; i < years.length; i++) {
        setStatus(`Loading November ${years[i]} (${i + 1}/${years.length})…`);
        const url = dataUrl(votesPath(cfg.votesLevel, years[i], "NOVEMBER", integration()));
        const where = cfg.key ? `WHERE ${cfg.key} = ${Number(unitKey)}` : "";
        const part = await query(
          `SELECT contest,
                  SUM(votes) AS total,
                  SUM(CASE WHEN party ILIKE 'DEMOCRATIC%' THEN votes ELSE 0 END) AS dem,
                  SUM(CASE WHEN party ILIKE 'REPUBLICAN%' THEN votes ELSE 0 END) AS rep
           FROM read_parquet('${url}')
           ${where}
           GROUP BY contest`
        );
        if (reqId !== lastRequest) return; // superseded
        for (const p of part) {
          rows.push({
            year: years[i],
            contest: p.contest.replace(/^GENERAL!!/, ""),
            total: p.total,
            dem: p.dem,
            rep: p.rep,
            other: p.total - p.dem - p.rep,
          });
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`, true);
      return;
    }

    const label =
      levelName === "statewide" ? "Statewide" : unitFilter.labelFor(unitKey);
    els.table.classList.remove("mode-contest");
    view = {
      columns: [
        { key: "year", label: "Year", num: true, value: (r) => r.year },
        { key: "contest", label: "Contest", value: (r) => r.contest },
        {
          key: "total",
          label: "Total votes",
          num: true,
          value: (r) => r.total,
          render: (r) => Math.round(r.total).toLocaleString(),
        },
        {
          key: "dem",
          label: "Democratic %",
          num: true,
          value: (r) => pctNum(r.dem, r.total),
          render: (r) => pct(r.dem, r.total),
        },
        {
          key: "rep",
          label: "Republican %",
          num: true,
          value: (r) => pctNum(r.rep, r.total),
          render: (r) => pct(r.rep, r.total),
        },
        {
          key: "other",
          label: "Combined Other %",
          num: true,
          value: (r) => pctNum(r.other, r.total),
          render: (r) => pct(r.other, r.total),
        },
      ],
      rows: rows.sort((a, b) => b.year - a.year || b.total - a.total),
      sort: null,
      filter: els.contestFilter.value.trim().toLowerCase(),
      filterKey: "contest",
    };
    setStatus(
      `${label}: ${rows.length} contest rows across ${years.length} November elections. ` +
      `Click a column header to sort.`
    );
    draw();
  }

  els.contestFilter.addEventListener("input", () => {
    view.filter = els.contestFilter.value.trim().toLowerCase();
    draw();
  });

  els.level.addEventListener("change", async () => {
    const levelName = els.level.value;
    const isStatewide = levelName === "statewide";
    els.unitWrap.hidden = isStatewide;
    if (isStatewide) {
      await runGeographyMode();
      return;
    }
    try {
      setStatus("Loading units…");
      const opts = await unitOptionsFor(levelName);
      unitFilter.setOptions(opts);
      unitFilter.set(null);
      clearTable();
      setStatus("Select a unit above to build the table.");
    } catch (err) {
      console.error(err);
      setStatus(`Error loading units: ${err.message}`, true);
    }
  });

  const unitFilter = setupUnitFilter(
    {
      input: document.getElementById("compare-unit"),
      list: document.getElementById("compare-unit-list"),
    },
    (key) => {
      if (key != null) runGeographyMode();
    }
  );

  // ---------- Mode switching ----------

  for (const radio of document.querySelectorAll('input[name="compare-mode"]')) {
    radio.addEventListener("change", () => {
      mode = radio.value;
      els.contestControls.hidden = mode !== "contest";
      els.geographyControls.hidden = mode !== "geography";
      if (mode === "contest") renderContestMode();
      else {
        if (els.level.value === "statewide") runGeographyMode();
        else {
          clearTable();
          setStatus("Select a unit above to build the table.");
        }
      }
    });
  }

  const INTEGRATION_NOTES = {
    nominal:
      "These results are nominally integrated, meaning they show the results of " +
      "votes cast within the boundaries as they existed at the time of the election. " +
      "County boundaries remain stable. Municipality and minor civil division " +
      "boundaries change rarely. Legislative districts were substantially redrawn " +
      "before the 2002, 2012, 2022, and 2024 elections. Refer to the Map tab to view " +
      "the boundaries as they existed during each election.",
    spatial:
      "These results are spatially integrated: past election results are allocated " +
      "into August 2026 boundaries based on validated voter overlap. Available for " +
      "statewide contests only; sub-county levels cover 2016 and later. County " +
      "totals (and recent legislative-district elections whose boundaries are " +
      "unchanged since) use official results.",
  };

  // Note: `state` is the same object across calls (main.js mutates it), so
  // integration changes must be detected via a separate local.
  let lastIntegration = null;

  return {
    // Called when the tab is shown and after each filter-driven data load.
    async activate(state, votes) {
      const integrationChanged =
        lastIntegration !== null && state && lastIntegration !== state.integration;
      lastIntegration = state?.integration ?? "nominal";
      lastState = state;
      lastVotes = votes;
      document.getElementById("compare-integration-note").textContent =
        INTEGRATION_NOTES[state?.integration ?? "nominal"];
      if (mode === "contest") {
        renderContestMode();
        return;
      }
      // Geography mode's year list and unit options depend on the
      // integration mode; rebuild, keeping the selected unit when its key
      // exists in the new vintage.
      if (!integrationChanged) return;
      const levelName = els.level.value;
      if (levelName === "statewide") {
        runGeographyMode();
        return;
      }
      const keepUnit = unitFilter.value();
      try {
        setStatus("Loading units…");
        const opts = await unitOptionsFor(levelName);
        unitFilter.setOptions(opts);
        if (keepUnit != null && opts.some((o) => o.key === keepUnit)) {
          unitFilter.set(keepUnit);
          runGeographyMode();
        } else {
          unitFilter.set(null);
          clearTable();
          setStatus("Select a unit above to build the table.");
        }
      } catch (err) {
        console.error(err);
        setStatus(`Error loading units: ${err.message}`, true);
      }
    },
  };
}
