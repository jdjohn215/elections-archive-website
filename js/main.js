import { initDB } from "./db.js";
import { loadMetadata, setupFilters, fetchVotes, fetchGeo, parseHash, stateToHash } from "./filters.js";
import { initMap, updateMap } from "./map.js";
import { updateTable, unitOptions, filterByUnit, setupUnitFilter } from "./table.js";
import { setupComparison } from "./compare.js";

const statusEl = document.getElementById("status");
function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// Tab switching
for (const btn of document.querySelectorAll(".tab")) {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.toggle("active", p.id === `panel-${btn.dataset.tab}`)
    );
    if (btn.dataset.tab === "map") map?.resize();
    if (btn.dataset.tab === "about") loadAbout();
    if (btn.dataset.tab === "compare") compare?.activate(currentState, lastVotes);
  });
}

// Load the About page content once, on first visit to the tab
let aboutLoaded = false;
async function loadAbout() {
  if (aboutLoaded) return;
  aboutLoaded = true;
  const el = document.getElementById("about-content");
  try {
    const res = await fetch("about.html");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    el.innerHTML = await res.text();
  } catch (err) {
    console.error(err);
    el.textContent = `Failed to load about.html: ${err.message}`;
  }
}

// Sidebar collapse
document.getElementById("sidebar-toggle").addEventListener("click", () => {
  document.body.classList.toggle("sidebar-collapsed");
  // Wait for the CSS transition so the map resizes to the final layout
  setTimeout(() => map?.resize(), 220);
});

// Legend collapse
document.getElementById("legend-toggle").addEventListener("click", () => {
  document.getElementById("legend").classList.toggle("collapsed");
});

let map = null;
let lastRequest = 0;
let currentState = null;
let lastVotes = null;
let lastLevel = null;
let compare = null;

const unitContextEl = document.getElementById("unit-context");

// Render the table from the last fetched votes, honoring the unit filter.
function renderTable() {
  if (!lastVotes || !currentState) return;
  const unit = currentState.unit ?? null;
  updateTable(unit ? filterByUnit(lastVotes, lastLevel, unit) : lastVotes);
  unitContextEl.hidden = !unit;
  if (unit) unitContextEl.textContent = `Showing: ${unitFilter.labelFor(unit)}`;
}

const unitFilter = setupUnitFilter(
  { input: document.getElementById("unit"), list: document.getElementById("unit-list") },
  (key) => {
    if (!currentState) return;
    // Unit changes only re-render the table — no refetch needed
    if (key === null) delete currentState.unit;
    else currentState.unit = key;
    history.pushState(null, "", stateToHash(currentState));
    renderTable();
  }
);

// User-driven filter change: sync the URL (new history entry), then load.
async function handleChange(state) {
  currentState = state;
  history.pushState(null, "", stateToHash(state));
  await load(state);
}

// Back/forward navigation: re-apply the state encoded in the hash.
window.addEventListener("hashchange", async () => {
  const h = parseHash();
  if (!h) return;
  if (currentState && stateToHash(currentState) === location.hash) return;
  currentState = await applyFilters(h);
  await load(currentState);
});

let applyFilters = () => Promise.reject(new Error("filters not initialized"));

async function load(state) {
  if (!state.contest) return;
  const reqId = ++lastRequest;
  setStatus(`Loading ${state.level} results for ${state.month} ${state.year}…`);
  try {
    const [votes, geo] = await Promise.all([fetchVotes(state), fetchGeo(state)]);
    if (reqId !== lastRequest) return; // superseded by a newer request
    lastVotes = votes;
    lastLevel = state.level;
    updateMap(map, { votes, geo, level: state.level });
    // Rebuild unit options for the new context; reset the filter if the
    // selected unit no longer exists (e.g. after a level change)
    unitFilter.setOptions(unitOptions(votes, state.level));
    const appliedUnit = unitFilter.set(state.unit ?? null);
    if ((state.unit ?? null) !== appliedUnit) {
      delete state.unit;
      history.replaceState(null, "", stateToHash(state));
    }
    renderTable();
    // Keep the comparison tab's contest mode in sync with new selections
    if (document.querySelector(".tab.active")?.dataset.tab === "compare") {
      compare?.activate(currentState, lastVotes);
    }
    setStatus(
      `${state.contest} — ${state.month} ${state.year}, ${state.level} level, ` +
      `${state.integration === "spatial" ? "spatially" : "nominally"} integrated ` +
      `(${geo.length.toLocaleString()} units)`
    );
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
  }
}

async function main() {
  let step = "startup";
  try {
    step = "loading database engine";
    setStatus("Loading database engine…");
    await initDB();

    step = "loading map";
    setStatus("Loading map…");
    map = await initMap();

    step = "loading metadata";
    const metadata = await loadMetadata();
    compare = setupComparison({ metadata });
    step = "loading filters";
    setStatus("Loading filters…");
    const { state, apply } = await setupFilters(metadata, handleChange, parseHash());
    applyFilters = apply;
    currentState = state;
    // Make the initial URL shareable without adding a history entry
    history.replaceState(null, "", stateToHash(state));
    await load(state);
  } catch (err) {
    console.error(`Initialization failed while ${step}:`, err);
    const detail = err?.message || String(err);
    setStatus(`Failed to initialize (${step}): ${detail}`, true);
  }
}

main();
