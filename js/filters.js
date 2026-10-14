import { query, dataUrl, sqlString } from "./db.js";

export const LEVELS = {
  "county": {
    geo: "county.parquet",
    keys: ["county_fips"],
    static: true,
    label: (r) => countyName(r.county_fips),
  },
  "municipality": {
    geo: "municipality.parquet",
    keys: ["muni_fips"],
    label: (r) => `${r.ctv || ""} ${r.municipality ?? r.muni_fips}`.trim(),
  },
  "minor civil division": {
    geo: "minor_civil_division.parquet",
    keys: ["mcd_fips"],
    label: (r) =>
      `${r.ctv || ""} ${r.municipality ?? r.mcd_fips}`.trim() + ", " + countyName(r.county_fips),
  },
  "reporting unit": {
    geo: "reporting_unit.parquet",
    keys: ["mcd_fips", "reporting_unit"],
    label: (r) =>
      `${r.ctv || ""} ${r.municipality} ${r.reporting_unit}`.replace(/^ /, "") +
      `, ${countyName(r.county_fips)} Co.`,
  },
  "congressional district": {
    geo: "congressional_district.parquet",
    keys: ["con_dist"],
    label: (r) => "Congressional District " + r.con_dist,
  },
  "state senate district": {
    geo: "state_senate_district.parquet",
    keys: ["wss_dist"],
    label: (r) => "State Senate District " + r.wss_dist,
  },
  "state assembly district": {
    geo: "state_assembly_district.parquet",
    keys: ["wsa_dist"],
    label: (r) => "State Assembly District " + r.wsa_dist,
  },
};

export const COUNTY_NAMES = {
  55001: "Adams", 55003: "Ashland", 55005: "Barron", 55007: "Bayfield",
  55009: "Brown", 55011: "Buffalo", 55013: "Burnett", 55015: "Calumet",
  55017: "Chippewa", 55019: "Clark", 55021: "Columbia", 55023: "Crawford",
  55025: "Dane", 55027: "Dodge", 55029: "Door", 55031: "Douglas",
  55033: "Dunn", 55035: "Eau Claire", 55037: "Florence", 55039: "Fond du Lac",
  55041: "Forest", 55043: "Grant", 55045: "Green", 55047: "Green Lake",
  55049: "Iowa", 55051: "Iron", 55053: "Jackson", 55055: "Jefferson",
  55057: "Juneau", 55059: "Kenosha", 55061: "Kewaunee", 55063: "La Crosse",
  55065: "Lafayette", 55067: "Langlade", 55069: "Lincoln", 55071: "Manitowoc",
  55073: "Marathon", 55075: "Marinette", 55077: "Marquette", 55078: "Menominee",
  55079: "Milwaukee", 55081: "Monroe", 55083: "Oconto", 55085: "Oneida",
  55087: "Outagamie", 55089: "Ozaukee", 55091: "Pepin", 55093: "Pierce",
  55095: "Polk", 55097: "Portage", 55099: "Price", 55101: "Racine",
  55103: "Richland", 55105: "Rock", 55107: "Rusk", 55109: "Sauk",
  55111: "Sawyer", 55113: "Shawano", 55115: "Sheboygan", 55117: "St. Croix",
  55119: "Taylor", 55121: "Trempealeau", 55123: "Vernon", 55125: "Vilas",
  55127: "Walworth", 55129: "Washburn", 55131: "Washington", 55133: "Waukesha",
  55135: "Waupaca", 55137: "Waushara", 55139: "Winnebago", 55141: "Wood",
};

export function countyName(fips) {
  return COUNTY_NAMES[fips] ?? String(fips);
}

export function votesPath(level, year, month) {
  return `data/votes/aggregation_level=${level}/year=${year}/month=${month}/part-0.parquet`;
}

export function keyOf(row, keys) {
  return keys.map((k) => String(row[k])).join("|");
}

export async function fetchContests({ year, month, level }) {
  const path = dataUrl(votesPath(level, year, month));
  const rows = await query(
    `SELECT DISTINCT contest FROM read_parquet('${path}') ORDER BY contest`
  );
  return rows.map((r) => r.contest);
}

// Municipality/MCD-level votes files only carry FIPS codes (names are NA).
// unit_names.parquet is tiny, so load it once and merge names in JS —
// doing this as a SQL join trips a duckdb-wasm 1.29 runtime error.
let unitNamesPromise = null;
export function loadUnitNames() {
  unitNamesPromise ??= query(
    `SELECT muni_fips, mcd_fips, municipality, ctv, county_fips
     FROM read_parquet('${dataUrl("data/geo/unit_names.parquet")}')`
  ).then((rows) => {
    // Dedupe to one entry per key (file has one row per muni × mcd pair)
    const byMuni = new Map();
    const byMcd = new Map();
    for (const r of rows) {
      if (r.muni_fips != null && !byMuni.has(r.muni_fips)) byMuni.set(r.muni_fips, r);
      if (r.mcd_fips != null && !byMcd.has(r.mcd_fips)) byMcd.set(r.mcd_fips, r);
    }
    return { byMuni, byMcd };
  });
  return unitNamesPromise;
}

export async function fetchVotes({ year, month, level, contest }) {
  const path = dataUrl(votesPath(level, year, month));
  const rows = await query(
    `SELECT county_fips, muni_fips, mcd_fips, reporting_unit,
            con_dist, wss_dist, wsa_dist,
            county, municipality, ctv,
            candidate, party, votes, total_votes
     FROM read_parquet('${path}')
     WHERE contest = ${sqlString(contest)}`
  );
  if (level === "municipality" || level === "minor civil division") {
    const keyCol = level === "municipality" ? "muni_fips" : "mcd_fips";
    const { byMuni, byMcd } = await loadUnitNames();
    const lookup = level === "municipality" ? byMuni : byMcd;
    for (const r of rows) {
      const n = lookup.get(String(r[keyCol]));
      if (!n) continue;
      r.municipality ??= n.municipality;
      r.ctv ??= n.ctv;
      r.county_fips ??= n.county_fips;
    }
  }
  return rows;
}

export async function fetchGeo({ year, month, level }) {
  const cfg = LEVELS[level];
  const where = cfg.static ? "" : `WHERE year = ${year} AND month = ${sqlString(month)}`;
  // FIPS/district ids are integers stored as DOUBLE or VARCHAR depending on
  // the file; normalize via BIGINT so JS join keys are plain "55001"-style
  // strings on both sides.
  const keySelect = cfg.keys
    .map((k) => (k === "reporting_unit" ? k : `CAST(CAST(${k} AS BIGINT) AS VARCHAR) AS ${k}`))
    .join(", ");
  const rows = await query(
    `SELECT ${keySelect},
            ST_AsGeoJSON(ST_GeomFromWKB(geometry)) AS gj
     FROM read_parquet('${dataUrl("data/geo/" + cfg.geo)}')
     ${where}`
  );
  return rows;
}

const MONTH_ORDER = { FEBRUARY: 2, APRIL: 4, AUGUST: 8, NOVEMBER: 11 };

export async function loadMetadata() {
  const resp = await fetch("data/metadata.json");
  if (!resp.ok) throw new Error("Could not load data/metadata.json");
  return resp.json();
}

// Hash routing: filter state is encoded as #year=…&month=…&level=…&contest=…
export function parseHash() {
  const h = location.hash.replace(/^#/, "");
  if (!h) return null;
  const p = new URLSearchParams(h);
  const year = Number(p.get("year"));
  const month = p.get("month");
  const level = p.get("level");
  const contest = p.get("contest");
  if (!year || !month || !level || !contest) return null;
  // Optional: table filtered to a single unit (keyOf-style key)
  return { year, month, level, contest, unit: p.get("unit") };
}

export function stateToHash(s) {
  const params = {
    year: String(s.year),
    month: s.month,
    level: s.level,
    contest: s.contest,
  };
  if (s.unit) params.unit = s.unit;
  return "#" + new URLSearchParams(params).toString();
}

// Populate cascading selects from metadata triples [{level, year, month}]
export function setupFilters(metadata, onChange, initial = null) {
  const els = {
    year: document.getElementById("year"),
    month: document.getElementById("month"),
    level: document.getElementById("level"),
    contest: document.getElementById("contest"),
    contestList: document.getElementById("contest-list"),
  };

  const setOptions = (sel, values, current) => {
    sel.innerHTML = "";
    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    if (values.includes(current)) sel.value = current;
    sel.disabled = values.length === 0;
  };

  // Searchable contest combobox: the full contest list for the current
  // election lives in `contests`; the dropdown filters as the user types.
  let contests = [];
  let activeIndex = -1;

  function renderContestList() {
    const filter = els.contest.value.trim().toLowerCase();
    const matches = contests.filter((c) => c.toLowerCase().includes(filter));
    activeIndex = -1;
    els.contestList.innerHTML = "";
    if (matches.length === 0) {
      const div = document.createElement("div");
      div.className = "combobox-empty";
      div.textContent = "No matching contests";
      els.contestList.appendChild(div);
    } else {
      for (const c of matches) {
        const div = document.createElement("div");
        div.className = "combobox-option";
        div.textContent = c;
        div.title = c;
        div.addEventListener("mousedown", (e) => {
          // mousedown (not click) so it fires before the input's blur
          e.preventDefault();
          selectContest(c);
        });
        els.contestList.appendChild(div);
      }
    }
    els.contestList.hidden = false;
  }

  function hideContestList() {
    els.contestList.hidden = true;
    activeIndex = -1;
  }

  function selectContest(value) {
    els.contest.value = value;
    hideContestList();
    if (value !== state.contest) {
      state.contest = value;
      onChange(state);
    }
  }

  function moveActive(delta) {
    const opts = els.contestList.querySelectorAll(".combobox-option");
    if (opts.length === 0) return;
    activeIndex = (activeIndex + delta + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle("active", i === activeIndex));
    opts[activeIndex].scrollIntoView({ block: "nearest" });
  }

  els.contest.addEventListener("focus", renderContestList);
  els.contest.addEventListener("input", renderContestList);
  els.contest.addEventListener("blur", () => {
    hideContestList();
    // Restore the committed value if the user leaves without selecting
    if (els.contest.value !== state.contest) els.contest.value = state.contest ?? "";
  });
  els.contest.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (els.contestList.hidden) renderContestList();
      else moveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opts = els.contestList.querySelectorAll(".combobox-option");
      if (!els.contestList.hidden && activeIndex >= 0 && opts[activeIndex]) {
        selectContest(opts[activeIndex].textContent);
      } else if (opts.length === 1) {
        selectContest(opts[0].textContent);
      }
    } else if (e.key === "Escape") {
      hideContestList();
      els.contest.value = state.contest ?? "";
    }
  });

  const state = initial ? { ...initial } : {};

  async function refresh(keepContest = false) {
    const years = [...new Set(metadata.map((m) => m.year))].sort((a, b) => b - a);
    setOptions(els.year, years, state.year);
    state.year = Number(els.year.value);

    const months = [...new Set(metadata.filter((m) => m.year === state.year).map((m) => m.month))]
      .sort((a, b) => MONTH_ORDER[a] - MONTH_ORDER[b]);
    setOptions(els.month, months, state.month);
    state.month = els.month.value;

    const levels = [...new Set(metadata
      .filter((m) => m.year === state.year && m.month === state.month)
      .map((m) => m.level))];
    setOptions(els.level, levels, state.level);
    state.level = els.level.value;

    const prevContest = state.contest;
    els.contest.disabled = true;
    els.contest.placeholder = "Loading contests…";
    contests = await fetchContests(state);
    state.contest =
      keepContest && contests.includes(prevContest) ? prevContest : contests[0] ?? null;
    els.contest.value = state.contest ?? "";
    els.contest.disabled = contests.length === 0;
    els.contest.placeholder = "Type to filter contests…";
    hideContestList();
    return state;
  }

  // Keep every downstream selection when changing a filter; setOptions
  // already falls back to the first option if the kept value isn't valid
  // for the new context (e.g. a month with no election that year).
  els.year.addEventListener("change", async () => {
    state.year = Number(els.year.value);
    await refresh(true);
    onChange(state);
  });
  els.month.addEventListener("change", async () => {
    state.month = els.month.value;
    await refresh(true);
    onChange(state);
  });
  els.level.addEventListener("change", async () => {
    state.level = els.level.value;
    await refresh(true);
    onChange(state);
  });
  els.contest.addEventListener("change", () => {
    // Fires on committed edits (e.g. blur after typing); accept only exact
    // matches, otherwise the blur handler restores the previous value.
    if (contests.includes(els.contest.value) && els.contest.value !== state.contest) {
      state.contest = els.contest.value;
      onChange(state);
    }
  });

  // Apply an externally supplied state (e.g. from the URL hash on
  // back/forward navigation). Invalid values fall back per setOptions.
  async function apply(next) {
    Object.assign(state, next);
    await refresh(true);
    return state;
  }

  return refresh(true).then(() => ({ state, apply }));
}
