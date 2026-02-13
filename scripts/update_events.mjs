// scripts/update_events.mjs
// Fetch official CINEA "Event" RSS and write data/events.json + data/meta_events.json

import { writeFile } from "node:fs/promises";

const RSS_URL =
  "https://ec.europa.eu/newsroom/cinea/feed?item_type_id=1185&lang=en&orderby=item_date";

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

function extractItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
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

// Try to extract a date from the description (various formats appear)
// 1) ISO date: 2026-02-12
// 2) dd/mm/yyyy or dd-mm-yyyy
// 3) "12 Feb 2026" style
function guessEventDate(text) {
  let m = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (m) return m[1];

  m = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](20\d{2})\b/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/i);
  if (m) {
    const day = String(m[1]).padStart(2, "0");
    const mon = m[2].toLowerCase();
    const year = m[3];
    const map = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
    return `${year}-${map[mon]}-${day}`;
  }

  return "";
}

function guessCityCountry(text) {
  // Very lightweight heuristics (we can improve later):
  // Look for patterns like "Brussels, Belgium" or "Online only"
  const t = text;
  if (/online/i.test(t)) return { city: "Online", country: "EU" };

  const m = t.match(/\b([A-Z][A-Za-z .'\-]+),\s*([A-Z][A-Za-z .'\-]+)\b/);
  if (m) return { city: m[1].trim(), country: m[2].trim() };

  return { city: "", country: "EU" };
}

async function main() {
  const res = await fetch(RSS_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const items = extractItems(xml).slice(0, 80);

  const events = items.map((it) => {
    const title = getCdataOrTag(it, "title");
    const url = getTag(it, "link");
    const descHtml = getCdataOrTag(it, "description");
    const descText = stripTags(descHtml);

    const pubDate = getTag(it, "pubDate");
    const pubISO = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : "";
    const date = guessEventDate(descText) || pubISO;

    const loc = guessCityCountry(descText);

    return {
      title: title || "Untitled event",
      country: loc.country || "EU",
      city: loc.city || "",
      date,
      url: url || "",
    };
  }).filter(x => x.url);

  await writeFile("data/events.json", JSON.stringify(events, null, 2), "utf-8");

  await writeFile(
    "data/meta_events.json",
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        eventsCount: events.length
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`✅ Wrote ${events.length} events to data/events.json`);
  console.log("✅ Wrote data/meta_events.json (lastUpdated)");
}

main().catch((err) => {
  console.error("❌ update_events failed:", err.message);
  process.exit(1);
});
