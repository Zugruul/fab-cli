const EVENTS_URL = "https://fabtcg.com/organised-play/";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export interface TournamentEvent {
  name: string;
  date: string;       // ISO-like string from the page
  location: string;
  format: string | null;
  url: string;
  tier: string | null; // "Pro Tour", "Calling", "World Championship", etc.
}

// Tier keywords to detect from event name/title
const MAJOR_TIERS = [
  "Pro Tour",
  "World Championship",
  "Calling",
  "Road to Nationals",
  "National Championship",
  "Skirmish",
  "Battle Hardened",
  "Armory",
];

function detectTier(text: string): string | null {
  for (const tier of MAJOR_TIERS) {
    if (text.toLowerCase().includes(tier.toLowerCase())) return tier;
  }
  return null;
}

function isWorldTour(event: TournamentEvent): boolean {
  const worldTourTiers = ["Pro Tour", "World Championship", "Calling"];
  return worldTourTiers.some(
    (t) => event.tier === t || (event.name.toLowerCase().includes(t.toLowerCase()))
  );
}

export async function fetchEvents(filters?: {
  worldTour?: boolean;
  upcoming?: boolean;
  format?: string;
}): Promise<TournamentEvent[]> {
  const res = await fetch(EVENTS_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const events = parseEventsHtml(html);

  let filtered = events;

  if (filters?.upcoming) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    filtered = filtered.filter((e) => {
      const d = parseEventDate(e.date);
      return d === null || d >= today;
    });
  }

  if (filters?.worldTour) {
    filtered = filtered.filter(isWorldTour);
  }

  if (filters?.format) {
    const fmt = filters.format.toLowerCase();
    filtered = filtered.filter(
      (e) => e.format && e.format.toLowerCase().includes(fmt)
    );
  }

  return filtered;
}

function parseEventDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  // Normalize "Month D1-D2, YYYY" → "Month D1, YYYY" to avoid JS parsing "D2" as year
  const normalized = dateStr.replace(/^(\w+ \d+)-\d+(,\s*\d{4})/, "$1$2");
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEventsHtml(html: string): TournamentEvent[] {
  // fabtcg.com uses <a class="fl-link-card-ssr" href="...">
  //   <div class="fl-link-card-ssr-content">
  //     <h3>Event Name</h3>
  //     <p>Apr 3-5, 2026 / Location</p>
  //   </div>
  // </a>
  const events = parseFabtcgCards(html);
  if (events.length > 0) return events;

  // Fallback: JSON-LD structured data
  const jsonLdEvents = parseJsonLd(html);
  if (jsonLdEvents.length > 0) return jsonLdEvents;

  // Fallback: generic link extraction
  return parseEventLinks(html);
}

function parseFabtcgCards(html: string): TournamentEvent[] {
  const events: TournamentEvent[] = [];

  // Match each <a class="fl-link-card-ssr" href="...">...</a> block
  const cardRe = /<a\b([^>]*class="[^"]*fl-link-card-ssr[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(cardRe)) {
    const attrs = match[1];
    const body  = match[2];

    const hrefMatch = attrs.match(/href="([^"]+)"/);
    const url = hrefMatch ? resolveUrl(hrefMatch[1]) : EVENTS_URL;

    const h3Match = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const name = h3Match ? stripHtml(h3Match[1]) : "";
    if (!name) continue;

    // <p>Apr 3-5, 2026 / Location</p>
    const pMatch = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const pText = pMatch ? stripHtml(pMatch[1]) : "";

    // Split on " / " to get date and location
    const slashIdx = pText.indexOf(" / ");
    const dateStr  = slashIdx >= 0 ? pText.slice(0, slashIdx).trim() : pText;
    const location = slashIdx >= 0 ? pText.slice(slashIdx + 3).trim() : "";

    // Skip informational cards that don't have a date
    if (!dateStr || !/\d{4}/.test(dateStr)) continue;

    events.push({
      name,
      date: dateStr,
      location,
      format: null,
      url,
      tier: detectTier(name),
    });
  }

  return events;
}

function parseJsonLd(html: string): TournamentEvent[] {
  const events: TournamentEvent[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Event" || item["@type"] === "SportsEvent") {
          const name = stripHtml(String(item.name ?? ""));
          const date = String(item.startDate ?? item.date ?? "");
          const location =
            item.location?.name ??
            item.location?.address?.addressLocality ??
            (typeof item.location === "string" ? item.location : "") ??
            "";
          const url = String(item.url ?? EVENTS_URL);
          events.push({ name, date, location: stripHtml(String(location)), format: null, url, tier: detectTier(name) });
        }
      }
    } catch { /* ignore */ }
  }
  return events;
}

function parseEventLinks(html: string): TournamentEvent[] {
  const events: TournamentEvent[] = [];
  const seen = new Set<string>();
  const linkRe =
    /<a[^>]*href=["']([^"']*(?:event|tournament|calling|pro-tour)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRe)) {
    const url = resolveUrl(match[1]);
    if (seen.has(url)) continue;
    seen.add(url);
    const name = stripHtml(match[2]);
    if (!name || name.length < 3) continue;
    events.push({ name, date: "", location: "", format: null, url, tier: detectTier(name) });
  }
  return events;
}

function resolveUrl(href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://fabtcg.com${href}`;
  return `https://fabtcg.com/${href}`;
}
