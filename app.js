let miniSearch;
let docs = [];
let indexById = {};

// ----------------------
// CONFIG
// ----------------------

const TIER_WEIGHT = {
  A: 1.25,
  B: 1.0,
  C: 0.75
};

const MAX_RESULTS = 50;
const TOP_N_QUOTA = 10;
const MAX_PER_SOURCE_TOP = 2;

// ----------------------
// HELPERS
// ----------------------

function normalizeQuery(q) {
  return q.trim();
}

function daysOld(dateStr) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, (now - then) / msPerDay);
}

function freshnessBoost(dateStr) {
  const age = daysOld(dateStr);
  return 1 + 0.6 * Math.exp(-age / 14);
}

// Basic “advanced search” support
function parseQuery(raw) {
  const q = raw.trim();
  const phraseMatches = [...q.matchAll(/"([^"]+)"/g)]
    .map(m => m[1].trim())
    .filter(Boolean);

  const remaining = q.replace(/"[^"]+"/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const terms = remaining ? remaining.split(" ") : [];
  return { phraseMatches, terms };
}

// Apply per-source quota to top results
function applySourceQuota(results) {
  const counts = {};
  const out = [];

  for (const r of results) {
    const src = r.item.source;
    counts[src] = counts[src] || 0;

    if (out.length < TOP_N_QUOTA) {
      if (counts[src] >= MAX_PER_SOURCE_TOP) continue;
      counts[src]++;
    }

    out.push(r);
  }

  return out;
}

// ----------------------
// RENDERING
// ----------------------

function renderResults(results, query) {
  const list = document.getElementById("results");
  const meta = document.getElementById("meta");
  list.innerHTML = "";

  meta.textContent = results.length
    ? `${results.length} result(s) for “${query}”`
    : `No results for “${query}”`;

  for (const r of results.slice(0, MAX_RESULTS)) {
    const d = r.item;
    const li = document.createElement("li");

    const a = document.createElement("a");
    a.href = d.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = d.title;

    const small = document.createElement("div");
    small.className = "small";
    small.textContent = `${d.source} · ${d.date}${d.summary ? " · " + d.summary : ""}`;

    li.appendChild(a);
    li.appendChild(small);
    list.appendChild(li);
  }
}

// ----------------------
// INIT
// ----------------------

async function init() {
  const res = await fetch("./index.json", { cache: "no-store" });
  const data = await res.json();

  docs = data.map((d, i) => ({
    id: d.url || String(i),
    title: d.title || "",
    summary: d.summary || "",
    source: d.source || "",
    date: d.date || "",
    url: d.url || "#",
    tier: d.tier || "B"
  }));

  indexById = Object.fromEntries(docs.map(d => [d.id, d]));

  miniSearch = new MiniSearch({
    fields: ["title", "summary", "source"],
    storeFields: ["title", "summary", "source", "date", "url", "tier"],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2 }
  });

  miniSearch.addAll(docs);

  const input = document.getElementById("q");
  const btn = document.getElementById("btn");

  function doSearch() {
    const raw = normalizeQuery(input.value);
    if (!raw) return renderResults([], "");

    const { phraseMatches, terms } = parseQuery(raw);

    let results = miniSearch.search(terms.join(" "));

    // Phrase boost (title contains quoted phrases)
    if (phraseMatches.length) {
      const phraseSet = phraseMatches.map(p => p.toLowerCase());
      results = results.map(r => {
        const d = indexById[r.id];
        const title = (d?.title || "").toLowerCase();
        const hits = phraseSet.reduce(
          (acc, p) => acc + (title.includes(p) ? 1 : 0),
          0
        );
        return { ...r, score: r.score + hits * 5 };
      });
    }

    // Final scoring: relevance × freshness × tier
    const reranked = results.map(r => {
      const item = indexById[r.id];
      const freshness = freshnessBoost(item.date);
      const tierWeight = TIER_WEIGHT[item.tier] || 1.0;

      return {
        ...r,
        item,
        finalScore: r.score * freshness * tierWeight
      };
    });

    reranked.sort((a, b) => b.finalScore - a.finalScore);

    const finalResults = applySourceQuota(reranked);
    renderResults(finalResults, raw);
  }

  btn.addEventListener("click", doSearch);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") doSearch();
  });

  // About dialog
  const dialog = document.getElementById("aboutDialog");
  document.getElementById("aboutLink").addEventListener("click", e => {
    e.preventDefault();
    dialog.showModal();
  });
  document.getElementById("closeAbout").addEventListener("click", () => dialog.close());
}

init().catch(err => {
  console.error(err);
  document.getElementById("meta").textContent = "Error loading index.json";
});
