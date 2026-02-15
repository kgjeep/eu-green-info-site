/**
 * Update CINEA upcoming events by scraping the official homepage Events block.
 *
 * Source:
 * https://cinea.ec.europa.eu/index_en
 *
 * Output:
 * - data/events.json
 * - data/meta_events.json
 */

import fs from "node:fs";
import path from "node:path";

const OUT_EVENTS = path.join("data", "events.json");
const OUT_META = path.join("data", "meta_events.json");
const SOURCE_URL = "https://cinea.ec.europa.eu/index_en";

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function toIsoFromParts(dayStr, monAbbr, yearStr) {
  const y = String(yearStr || "").trim();
  const mon = String(monAbbr || "").trim();
  const day = String(dayStr || "").trim();

  if (!/^\d{4}$/.test(y)) return { startIso: "", endIso: "" };
  const m = MONTHS[mon];
  if (!m) return { startIso: "", endIso: "" };

  // day can be: "17" or "02-06" or "17-19" or "04-05"
  const range = day.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  const pad2 = (n) => String(n).padStart(2, "0");
  const mm = pad2(m);

  if (range) {
    const d1 = pad2(Number(range[1]));
    const d2 = pad2(Number(range[2]));
    return {
      startIso: `${y}-${mm}-${d1}`,
      endIso: `${y}-${mm}-${d2}`,
    };
  }

  if (/^\d{1,2}$/.test(day)) {
    const dd = pad2(Number(day));
    return { startIso: `${y}-${mm}-${dd}`, endIso: "" };
  }

  return { startIso: "", endIso: "" };
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|section|article|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function normalize(s) {
  return stripHtml(s).replace(/\s+/g, " ").trim();
}

function ensureAbsoluteUrl(href) {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `https://cinea.ec.europa.eu${href}`;
  return `https://cinea.ec.europa.eu/${href}`;
}

function extractEventsFromIndexHtml(html) {
  // Narrow to the Events block: <div id="block-eventsglobal" ...>
  // Robust: take a large window after the Events block anchor.
// (Regex-based "closing div" matching is fragile with nested HTML.)
const idx = html.toLowerCase().indexOf('id="block-eventsglobal"');
if (idx < 0) return [];
const blockHtml = html.slice(idx, idx + 60000); // big enough to include all homepage events


  // Each event item on the homepage contains:
  // - span.ecl-date-block__day (e.g. 17 or 02-06)
  // - abbr.ecl-date-block__month (Feb/Mar)
  // - span.ecl-date-block__year (2026)
  // - an <a href="/news-events/events/...">Title</a>
  //
  // We parse "chunks" starting at each date block day span.
  const daySpanRe =
    /<span[^>]*class="ecl-date-block__day"[^>]*>([\s\S]*?)<\/span>/gi;

  const items = [];
  let m;

  while ((m = daySpanRe.exec(blockHtml)) !== null) {
    const startPos = m.index;
    const chunk = blockHtml.slice(startPos, startPos + 4000);

    const dayRaw = normalize(m[1]); // like "17" or "02-06"
    const monMatch = chunk.match(
      /<abbr[^>]*class="ecl-date-block__month"[^>]*>([\s\S]*?)<\/abbr>/i
    );
    const yearMatch = chunk.match(
      /<span[^>]*class="ecl-date-block__year"[^>]*>([\s\S]*?)<\/span>/i
    );

    const mon = monMatch ? normalize(monMatch[1]) : "";
    const year = yearMatch ? normalize(yearMatch[1]) : "";

    const { startIso, endIso } = toIsoFromParts(dayRaw, mon, year);
    if (!startIso) continue;

    // Title link: prefer /news-events/events/...
    const aMatch = chunk.match(
      /<a[^>]+href="([^"]*\/news-events\/events\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    ) || chunk.match(
      /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );

    const link = aMatch ? ensureAbsoluteUrl(aMatch[1]) : "";
    const title = aMatch ? normalize(aMatch[2]) : "";

    if (!title || /^See all our events$/i.test(title)) continue;

    // Optional: try to grab type + venue from the list that follows in chunk text
    const chunkText = normalize(chunk);

    let type = "";
    const typeMatch = chunkText.match(
      /\b(Conferences and summits|Training and workshops|Expert meetings|Info days)\b/i
    );
    if (typeMatch) type = typeMatch[1];

    let venue = "";
    if (/online only/i.test(chunkText)) venue = "Online only";
    else {
      const venueMatch = chunkText.match(
        /([A-Z][A-Za-zÀ-ÖØ-öø-ÿ .'-]{2,},\s*[A-Z][A-Za-zÀ-ÖØ-öø-ÿ .'-]{2,})/
      );
      if (venueMatch && venueMatch[1] && venueMatch[1].length <= 80) {
        venue = venueMatch[1].trim();
      }
    }

    items.push({
      title,
      date: startIso,
      end_date: endIso || "",
      date_label: endIso
        ? `${dayRaw} ${mon} ${year}`
        : `${dayRaw} ${mon} ${year}`,
      type,
      venue,
      link,
      source: "CINEA homepage events",
    });
  }

  // Deduplicate (title + start date)
  const seen = new Set();
  const out = [];
  for (const e of items) {
    const k = `${e.title}__${e.date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }

  // Sort by start date ascending
  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  console.log("Updating events from CINEA homepage…");

  const html = await fetchText(SOURCE_URL);
  const events = extractEventsFromIndexHtml(html);

  writeJson(OUT_EVENTS, events);

  const meta = {
    lastUpdated: new Date().toISOString(),
    count: events.length,
    source: SOURCE_URL,
  };
  writeJson(OUT_META, meta);

  console.log(`Done. Saved ${events.length} events.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

