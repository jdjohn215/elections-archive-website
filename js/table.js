import { LEVELS, keyOf } from "./filters.js";

// Contest summary: one row per candidate, sorted by total votes.
export function updateTable(votes) {
  const tbody = document.querySelector("#summary tbody");
  tbody.innerHTML = "";

  const totals = new Map();
  let grand = 0;
  for (const v of votes) {
    const k = v.candidate + "\u0001" + v.party;
    if (!totals.has(k)) totals.set(k, { candidate: v.candidate, party: v.party, votes: 0 });
    totals.get(k).votes += v.votes;
    grand += v.votes;
  }

  const rows = [...totals.values()].sort((a, b) => b.votes - a.votes);

  for (const r of rows) {
    const tr = document.createElement("tr");
    const pct = grand > 0 ? ((r.votes / grand) * 100).toFixed(1) : "0.0";
    tr.innerHTML = `<td></td><td></td><td class="num">${Math.round(r.votes).toLocaleString()}</td><td class="num">${pct}%</td>`;
    tr.children[0].textContent = r.candidate;
    tr.children[1].textContent = r.party;
    tbody.appendChild(tr);
  }
}

// One option per unit present in the votes rows, sorted by display label.
export function unitOptions(votes, level) {
  const { keys, label } = LEVELS[level];
  const seen = new Map();
  for (const r of votes) {
    const k = keyOf(r, keys);
    if (!seen.has(k)) seen.set(k, { key: k, label: label(r) });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterByUnit(votes, level, unitKey) {
  const { keys } = LEVELS[level];
  return votes.filter((r) => keyOf(r, keys) === unitKey);
}

// Searchable combobox for picking a unit (or "All units"). Mirrors the
// contest combobox behavior in filters.js. `onSelect(key)` fires on commit
// with key === null meaning "All units".
export function setupUnitFilter(els, onSelect) {
  const ALL = { key: null, label: "All units (aggregate)" };
  let options = [];
  let committedKey = null;
  let activeIndex = -1;

  const labelFor = (key) => options.find((o) => o.key === key)?.label ?? "";

  function renderList() {
    const filter = els.input.value.trim().toLowerCase();
    const matches = [ALL, ...options].filter((o) => o.label.toLowerCase().includes(filter));
    activeIndex = -1;
    els.list.innerHTML = "";
    if (matches.length === 0) {
      const div = document.createElement("div");
      div.className = "combobox-empty";
      div.textContent = "No matching units";
      els.list.appendChild(div);
    } else {
      for (const o of matches) {
        const div = document.createElement("div");
        div.className = "combobox-option";
        div.textContent = o.label;
        div.title = o.label;
        div.addEventListener("mousedown", (e) => {
          // mousedown (not click) so it fires before the input's blur
          e.preventDefault();
          select(o.key);
        });
        els.list.appendChild(div);
      }
    }
    els.list.hidden = false;
  }

  function hideList() {
    els.list.hidden = true;
    activeIndex = -1;
  }

  function select(key) {
    committedKey = key;
    els.input.value = key === null ? "" : labelFor(key);
    hideList();
    onSelect(key);
  }

  function moveActive(delta) {
    const opts = els.list.querySelectorAll(".combobox-option");
    if (opts.length === 0) return;
    activeIndex = (activeIndex + delta + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle("active", i === activeIndex));
    opts[activeIndex].scrollIntoView({ block: "nearest" });
  }

  els.input.addEventListener("focus", renderList);
  els.input.addEventListener("input", renderList);
  els.input.addEventListener("blur", () => {
    hideList();
    // Restore the committed value if the user leaves without selecting
    els.input.value = committedKey === null ? "" : labelFor(committedKey);
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (els.list.hidden) renderList();
      else moveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const filter = els.input.value.trim().toLowerCase();
      const matches = [ALL, ...options].filter((o) => o.label.toLowerCase().includes(filter));
      if (!els.list.hidden && activeIndex >= 0 && matches[activeIndex]) {
        select(matches[activeIndex].key);
      } else if (matches.length === 1) {
        select(matches[0].key);
      }
    } else if (e.key === "Escape") {
      hideList();
      els.input.value = committedKey === null ? "" : labelFor(committedKey);
    }
  });

  return {
    setOptions(opts) {
      options = opts;
    },
    // Set the committed value without firing onSelect. Falls back to
    // "All units" (null) when the key isn't among the current options.
    set(key) {
      committedKey = key != null && options.some((o) => o.key === key) ? key : null;
      els.input.value = committedKey === null ? "" : labelFor(committedKey);
      return committedKey;
    },
    labelFor,
    value() {
      return committedKey;
    },
  };
}
