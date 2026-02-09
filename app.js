let miniSearch;
let docs = [];

function normalizeQuery(q) {
  return q.trim();
}

// Basic “advanced search” support: quoted phrases treated as exact-ish by boosting title matches.
// (MiniSearch supports fuzzy search; quotes here are a UX convention we can refine later.)
function parseQuery(raw) {
  const q = raw.trim();
  const phraseMatches = [...q.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
  const remaining = q.replace(/"[^"]+"/g, " ").replace(/\s+/g, " ").trim();
  const terms = remaining ? remaining.split(" ") : [];
  return { phraseMatches, terms };
}

function renderResults(results, query) {
  const list = document.getElementById("results");
  const meta = document.getElementById("meta");
  list.innerHTML = "";

  meta.textContent = results.length
    ? `${results.length} result(s) for “${query}”`
    : `No results for “${query}”`;

  for (const r of results.slice(0, 50)) {
    const d = docs.find(x => x.id === r.id);
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

async function init() {
  const res = await fetch("./index.json", { cache: "no-store" });
  const data = await res.json();

  // Give each doc a stable ID
  docs = data.map((d, i) => ({
    id: d.url || String(i),
    title: d.title || "",
    summary: d.summary || "",
    source: d.source || "",
    date: d.date || "",
    url: d.url || "#"
  }));

  miniSearch = new MiniSearch({
    fields: ["title", "summary", "source"],
    storeFields: ["title", "summary", "source", "date", "url"],
    searchOptions: { boost: { title: 2 }, fuzzy: 0.2 }
  });

  miniSearch.addAll(docs);

  const input = document.getElementById("q");
  const btn = document.getElementById("btn");

  function doSearch() {
    const raw = normalizeQuery(input.value);
    if (!raw) return renderResults([], "");
    const { phraseMatches, terms } = parseQuery(raw);

    // Primary search: normal terms
    let results = miniSearch.search(terms.join(" "), {
      filter: (result) => true
    });

    // Phrase boost: if title contains phrase(s), bump them up
    if (phraseMatches.length) {
      const phraseSet = phraseMatches.map(p => p.toLowerCase());
      results = results.map(r => {
        const d = docs.find(x => x.id === r.id);
        const t = (d?.title || "").toLowerCase();
        const hitCount = phraseSet.reduce((acc, p) => acc + (t.includes(p) ? 1 : 0), 0);
        return { ...r, score: r.score + hitCount * 5 };
      }).sort((a,b) => b.score - a.score);
    }

    renderResults(results, raw);
  }

  btn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  // About dialog
  const dialog = document.getElementById("aboutDialog");
  document.getElementById("aboutLink").addEventListener("click", (e) => {
    e.preventDefault();
    dialog.showModal();
  });
  document.getElementById("closeAbout").addEventListener("click", () => dialog.close());
}

init().catch(err => {
  console.error(err);
  document.getElementById("meta").textContent = "Error loading index.json";
});
