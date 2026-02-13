// scripts/update_opportunities.mjs
// Fetch official EU Funding & Tenders RSS and write data/opportunities.json

import { writeFile } from "node:fs/promises";

const RSS_URL =
  "https://ec.europa.eu/newsroom/cinea/feed?item_type_id=2512&lang=en&orderby=item_date";

function decodeHtml(s = "") {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function stripTags(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isHttpUrl(s = "") {
  return /^https?:\/\/\S+/i.test(String(s).trim());
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtml(m[1]) : "";
}

function getCdataOrTag(xml, tag) {
  const c = xml.match(
    new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i")
  );
  if (c) return decodeHtml(c[1]);
  return getTag(xml, tag);
}

function extractItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
}

function guessProgram(text) {
  const t = text.toLowerCase();
  const programs = [
    "life",
    "horizon europe",
    "cef",
    "erasmus",
    "single market",
    "interreg",
    "cerv",
    "eu4health",
    "innovation fund",
    "just transition",
  ];
  for (const p of programs) {
    if (t.includes(p)) return p.toUpperCase();
  }
  return "EU (F&T Portal)";
}

function guessBeneficiary(text) {
  const t = text.toLowerCase();
  if (t.includes("sme") || t.includes("small and medium")) return "SMEs";
  if (t.includes("ngo") || t.includes("non-government")) return "ΜΚΟ / Φορείς";
  if (t.includes("municipal") || t.includes("local authority")) return "Δήμοι / Φορείς";
  if (t.includes("citizen") || t.includes("individual")) return "Πολίτες";
  return "Διάφοροι δικαιούχοι";
}

function toISODateFromEN(day, monthName, year) {
  const m = monthName.toLowerCase();
  const map = {
    january:"01", february:"02", march:"03", april:"04", may:"05", june:"06",
    july:"07", august:"08", september:"09", october:"10", november:"11", december:"12"
  };
  const mm = map[m];
  if (!mm) return "";
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function findAllDatesEN(text) {
  // Matches: "15 April 2026", "19 February 2026", etc.
  const re = /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/g;
  const dates = [];
  let m;
  while ((m = re.exec(text))) {
    const iso = toISODateFromEN(m[1], m[2], m[3]);
    if (iso) dates.push(iso);
  }
  return dates;
}

function guessDeadline(text) {
  // 1) If ISO date already exists, keep it
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  // 2) Prefer dates near phrases like "open until", "applications close", "deadline"
  const t = text.replace(/\s+/g, " ");
  const keyArea = (t.match(/(open until|applications? (are )?open until|applications? close|submission deadline|deadline is)[\s\S]{0,120}/i) || [])[0] || t;

  const found = findAllDatesEN(keyArea);
  if (found.length) {
    // pick the earliest future date if possible, else the last one mentioned
    const todayISO = new Date().toISOString().slice(0, 10);
    const future = found.filter(d => d >= todayISO).sort();
    return (future[0] || found[found.length - 1]);
  }

  // 3) As a fallback, scan the whole text for EN dates
  const all = findAllDatesEN(t);
  if (all.length) return all[all.length - 1];

  return "";
}
function findAllDatesFromPage(html) {
  // Πιάνει ημερομηνίες τύπου 31/03/2026 ή 31-03-2026
  const dates = [];

  const reSlash = /\b(\d{2})\/(\d{2})\/(20\d{2})\b/g;
  let m;
  while ((m = reSlash.exec(html))) dates.push(`${m[3]}-${m[2]}-${m[1]}`);

  const reDash = /\b(\d{2})-(\d{2})-(20\d{2})\b/g;
  while ((m = reDash.exec(html))) dates.push(`${m[3]}-${m[2]}-${m[1]}`);

  // Πιάνει και "15 April 2026" (αγγλικά), όπως ήδη κάνεις στο guessDeadline
  const en = findAllDatesEN(html);
  for (const d of en) dates.push(d);

  return dates;
}

function pickBestFutureDate(datesISO) {
  const today = new Date().toISOString().slice(0, 10);
  const valid = datesISO
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const future = valid.filter(d => d >= today);
  return future[0] || ""; // πάρε την πιο κοντινή μελλοντική
}

async function enrichDeadlineFromPage(url) {
  try {
    // Normalize URL (handles encoding issues)
    const u = new URL(url);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000); // 12s timeout

    const res = await fetch(u.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      signal: ctrl.signal
    });

    clearTimeout(t);
    if (!res.ok) return "";

    const html = await res.text();
    const dates = findAllDatesFromPage(html);
    return pickBestFutureDate(dates);
  } catch (e) {
    // IMPORTANT: never crash the whole script because one page failed
    return "";
  }
}

async function main() {
  const res = await fetch(RSS_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const items = extractItems(xml).slice(0, 60); // limit for now
  const opportunities = items.map((it) => {
    const title = getCdataOrTag(it, "title");
   let url = getTag(it, "link") || getCdataOrTag(it, "link");
    if (!isHttpUrl(url)) {
     const guid = getTag(it, "guid") || getCdataOrTag(it, "guid");
    if (isHttpUrl(guid)) url = guid;
   }

    const descHtml = getCdataOrTag(it, "description");
    const descText = stripTags(descHtml);
    const pubDate = getTag(it, "pubDate");
    const published = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : "";

    return {
      title: title || "Untitled call",
      program: guessProgram(`${title} ${descText}`),
      beneficiary: guessBeneficiary(descText),
      country: "EU",
      published,
      deadline: guessDeadline(descText), // may be empty; we'll improve later
      url: url || "",
    };
  }).filter(x => x.url);
  const today = new Date().toISOString().slice(0, 10);

function rank(item) {
  // 0: active (future deadline)
  // 1: no deadline
  // 2: expired (past deadline)
  if (!item.deadline) return 1;
  return item.deadline >= today ? 0 : 2;
}

opportunities.sort((a, b) => {
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;

  // within the same group:
  // active: earlier deadline first
  if (ra === 0) return (a.deadline || "").localeCompare(b.deadline || "");
  // expired: most recently expired first
  if (ra === 2) return (b.deadline || "").localeCompare(a.deadline || "");
  // no deadline: most recently published first
  return (b.published || "").localeCompare(a.published || "");
})
// Enrich missing deadlines by visiting the page (limit to avoid too many requests)
let foundCount = 0;
let enriched = 0;
const enrichLimit = 20;

for (const item of opportunities) {
  if (enriched >= enrichLimit) break;
  if (!item.deadline && isHttpUrl(item.url)) {
  enriched++;
  const found = await enrichDeadlineFromPage(item.url);
  if (found) {
    item.deadline = found;
    foundCount++;
  }
}
};
console.log(`🔎 Enrichment tried: ${enriched} • deadlines found: ${foundCount}`);

const cutoffDays = 365; // πιο χαλαρό: 1 έτος
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - cutoffDays);

let filtered = opportunities.filter(x => {
  if (!x.published) return true;
  const d = new Date(x.published);
  if (Number.isNaN(d.getTime())) return true; // αν δεν γίνεται parse, μην το πετάς
  return d >= cutoff;
});

// Fallback: αν βγει άδειο, κράτα τα πιο πρόσφατα items από το RSS
if (filtered.length === 0) {
  filtered = opportunities.slice(0, 100);
}


await writeFile(
  "data/opportunities.json",
  JSON.stringify(filtered, null, 2),
  "utf-8"
);

 
await writeFile(
  "data/meta.json",
  JSON.stringify(
    {
      lastUpdated: new Date().toISOString(),
      opportunitiesCount: filtered.length
    },
    null,
    2
  ),
  "utf-8"
);

console.log(`✅ Wrote ${opportunities.length} opportunities to data/opportunities.json`);
console.log("✅ Wrote data/meta.json (lastUpdated)");

}

main().catch((err) => {
  console.error("❌ update_opportunities failed:", err.message);
  process.exit(1);
});
