window.App = (() => {
  async function loadJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("el-GR");
  }

  function renderList(el, items, type) {
    if (!items.length) {
      el.innerHTML = "<div class='item'>Δεν βρέθηκαν αποτελέσματα.</div>";
      return;
    }
    el.innerHTML = `<div class="list">${
      items.map(x => {
        if (type === "opp") {
          return `<div class="item">
            <div><strong>${x.title}</strong></div>
            <div class="meta">
             ${x.program} • ${x.beneficiary} • Deadline: ${x.deadline ? formatDate(x.deadline) : "—"}
             ${x.published ? ` • Δημοσίευση: ${formatDate(x.published)}` : ""}
            </div>
            <div><a href="${x.url}" target="_blank" rel="noopener">Άνοιγμα πηγής</a></div>
          </div>`;
        }
        return `<div class="item">
          <div><strong>${x.title}</strong></div>
          <div class="meta">${x.city || ""}${x.city ? " • " : ""}${x.country} • ${formatDate(x.date)}</div>
          <div><a href="${x.url}" target="_blank" rel="noopener">Άνοιγμα πηγής</a></div>
        </div>`;
      }).join("")
    }</div>`;
  }

  async function renderHome() {
    const [opps, events] = await Promise.all([
      loadJson("data/opportunities.json"),
      loadJson("data/events.json"),
    ]);
   // meta info (home)
  try {
    const metaOpp = await loadJson("data/meta.json");
    const metaEvt = await loadJson("data/meta_events.json");
    const el = document.getElementById("meta-home");
    if (el) {
     const d1 = metaOpp?.lastUpdated ? new Date(metaOpp.lastUpdated).toLocaleString("el-GR") : "—";
     const d2 = metaEvt?.lastUpdated ? new Date(metaEvt.lastUpdated).toLocaleString("el-GR") : "—";
     el.textContent = `Ενημέρωση: Χρηματοδότηση ${d1} • Events ${d2}`;
    }
  } catch (e) {}

    const latestOpps = [...opps]
      .sort((a,b) => (a.deadline || "").localeCompare(b.deadline || ""))
      .slice(0, 3);

    const latestEvents = [...events]
      .sort((a,b) => (a.date || "").localeCompare(b.date || ""))
      .slice(0, 3);

    renderList(document.getElementById("latest-opps"), latestOpps, "opp");
    renderList(document.getElementById("latest-events"), latestEvents, "event");
  }

  async function renderFunding() {
  const opportunities = await loadJson("data/opportunities.json");
  const sorted = opportunities; // κρατάμε τη σειρά από το JSON (ήδη sorted από το script)

   // meta info
try {
  const meta = await loadJson("data/meta.json");
  const metaEl = document.getElementById("meta-funding");
  if (metaEl && meta?.lastUpdated) {
    const d = new Date(meta.lastUpdated);
    metaEl.textContent = `Τελευταία ενημέρωση: ${d.toLocaleString("el-GR")} • Σύνολο: ${meta.opportunitiesCount ?? sorted.length}`;
  }
} catch (e) {
  // meta is optional
}

  const listEl = document.getElementById("funding-list");
   const searchEl = document.getElementById("funding-search");
   const onlyActiveEl = document.getElementById("funding-only-active");
   const today = new Date().toISOString().slice(0, 10);

function applyFilter() {
  const q = (searchEl?.value || "").toLowerCase().trim();
  let filtered = !q ? sorted : sorted.filter(x => {
  const text = `${x.title} ${x.program} ${x.beneficiary}`.toLowerCase();
  return text.includes(q);
});

if (onlyActiveEl?.checked) {
  filtered = filtered.filter(x => x.deadline && x.deadline >= today);
}

  renderList(listEl, filtered, "opp");
}

if (searchEl) {
  searchEl.addEventListener("input", applyFilter);
}
if (onlyActiveEl) {
  onlyActiveEl.addEventListener("change", applyFilter);
}

applyFilter();

  renderList(document.getElementById("funding-list"), sorted, "opp");
}

async function renderActions() {
  const events = await loadJson("data/events.json");
  // meta info
try {
  const meta = await loadJson("data/meta_events.json");
  const metaEl = document.getElementById("meta-events");
  if (metaEl && meta?.lastUpdated) {
    const d = new Date(meta.lastUpdated);
    metaEl.textContent = `Τελευταία ενημέρωση: ${d.toLocaleString("el-GR")} • Σύνολο: ${meta.eventsCount ?? ""}`;
  }
} catch (e) {
  // meta is optional
}
  const sorted = [...events].sort((a,b) => (a.date || "").localeCompare(b.date || ""));
  const listEl = document.getElementById("events-list");
  const searchEl = document.getElementById("events-search");

function applyFilter() {
  const q = (searchEl?.value || "").toLowerCase().trim();
  const filtered = !q ? sorted : sorted.filter(x => {
  const text = `${x.title} ${x.city || ""} ${x.country || ""}`.toLowerCase();
  return text.includes(q);
  });
  renderList(listEl, filtered, "event");
}

if (searchEl) {
  searchEl.addEventListener("input", applyFilter);
}

applyFilter();

}

return { renderHome, renderFunding, renderActions };


})();
