// dipops-insights: first-party, cookieless visit analytics for dipops.com.
//   POST /api/ping   record a page view, an action, or engaged time (sent by /visits.js)
//   GET  /insights   password-protected dashboard (?days=1|7|30|90, &format=csv for a raw export)
// No cookies and no IP addresses are stored. A visitor is a hash of IP + user agent + a random
// salt that exists for one UTC day and is then deleted, so hashes cannot be traced back later.

const MAX_BODY_BYTES = 2048;
const DAY_MS = 86_400_000;
const EVENT_TYPES = new Set(["pageview", "action", "engage"]);
const RANGES = new Map([["1", "24 hours"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]]);

const KNOWN_SOURCES = [
  [/(^|\.)gemini\.google\.com$/, "Gemini"],
  [/(^|\.)mail\.google\.com$|(^|\.)outlook\.(live|office|office365)\.com$/, "Email"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)search\.yahoo\.com$/, "Yahoo"],
  [/(^|\.)ecosia\.org$/, "Ecosia"],
  [/(^|\.)search\.brave\.com$/, "Brave Search"],
  [/(^|\.)kagi\.com$/, "Kagi"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "X"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)news\.ycombinator\.com$/, "Hacker News"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)youtube\.com$/, "YouTube"],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"]
];
const SOURCE_ALIASES = new Map([
  ...KNOWN_SOURCES.map(([, name]) => [sourceKey(name), name]),
  ["twitter", "X"], ["hn", "Hacker News"], ["ycombinator", "Hacker News"], ["newsletter", "Email"]
]);

const HOSTING_PATTERN = /amazon|\baws\b|google cloud|digitalocean|linode|akamai|\bovh|hetzner|vultr|oracle cloud|alibaba|tencent|contabo|scaleway|leaseweb|choopa|m247|datacamp|cloudflare|fastly|zscaler|netskope|hosting|data ?center|\bvpn\b|proton|mullvad|nordvpn|private internet access|g-core|hostinger/i;
const ISP_PATTERN = /\b(rogers|bell canada|bell mobility|telus|shaw|vid[eé]otron|cogeco|eastlink|sasktel|freedom mobile|fido|koodo|virgin|distributel|teksavvy|comcast|verizon|at&t|charter|spectrum|cox|t-mobile|sprint|frontier|centurylink|lumen|windstream|mediacom|altice|optimum|starlink|spacex|british telecommunications|vodafone|orange|deutsche telekom|telef[oó]nica|telstra|optus|jio|airtel|mtn|globacom|safaricom|claro|movistar)\b|telecom|broadband|wireless|\bmobile\b|\bcable|communications|internet service|\bisp\b/i;

const ACTION_NAMES = new Map([
  ["resume", "Downloaded résumé"],
  ["email", "Clicked email"],
  ["github", "Opened GitHub"],
  ["linkedin", "Opened LinkedIn"],
  ["outbound", "Followed another link"],
  ["domain-buy", "Domain: clicked buy now"],
  ["domain-offer", "Domain: clicked make an offer"]
]);

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/ping") return handlePing(request, env, ctx);
    if (pathname === "/insights" || pathname === "/insights/") return handleDashboard(request, env);
    return new Response("Not found", { status: 404 });
  },
  async scheduled(controller, env) {
    const retentionDays = Number(env.RETENTION_DAYS) || 395;
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(Date.now() - retentionDays * DAY_MS),
      env.DB.prepare("DELETE FROM salts WHERE day < ?").bind(today)
    ]);
  }
};

async function handlePing(request, env, ctx) {
  const allowed = allowedOrigins(env);
  const origin = request.headers.get("Origin") || "";
  const cors = allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413, headers: cors });

  const accepted = new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
  const userAgent = request.headers.get("User-Agent") || "";
  if (isBot(userAgent)) return accepted;

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413, headers: cors });
  let event = null;
  try { event = normalizeEvent(JSON.parse(body)); } catch { /* Malformed JSON is rejected below. */ }
  if (!event) return new Response("Bad request", { status: 400, headers: cors });

  ctx.waitUntil(record(request, env, event, userAgent).catch(error => console.error("insights: failed to record event", error)));
  return accepted;
}

async function record(request, env, event, userAgent) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const visitor = await visitorId(await dailySalt(env.DB, day), ip, userAgent);
  const landing = event.type === "pageview" ? classifySource(event.referrer, event.utm.source, internalHosts(env)) : { source: null, referrer: null };
  const { device, browser, os } = parseUserAgent(userAgent);
  await env.DB.prepare(
    `INSERT INTO events (ts, day, visitor, type, path, label, target, seconds, source, referrer, utm_medium, utm_campaign,
      country, region, city, org, asn, device, browser, os, lang) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    now, day, visitor, event.type, event.path, event.label, event.target, event.seconds, landing.source, landing.referrer,
    event.utm.medium, event.utm.campaign, cf.country ?? null, cf.region ?? null, cf.city ?? null,
    cf.asOrganization ?? null, Number.isInteger(cf.asn) ? cf.asn : null, device, browser, os, event.lang
  ).run();
}

let saltCache = null;
async function dailySalt(db, day) {
  if (saltCache?.day === day) return saltCache.salt;
  const fresh = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").bind(day, fresh).run();
  const row = await db.prepare("SELECT salt FROM salts WHERE day = ?").bind(day).first();
  saltCache = { day, salt: row.salt };
  return row.salt;
}

export async function visitorId(salt, ip, userAgent) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}|${userAgent}`));
  return toHex(new Uint8Array(digest).slice(0, 8));
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object" || !EVENT_TYPES.has(raw.t)) return null;
  const path = cleanPath(raw.p);
  if (!path) return null;
  const utm = raw.u && typeof raw.u === "object" ? raw.u : {};
  const event = {
    type: raw.t, path, label: null, target: null, seconds: null,
    referrer: raw.t === "pageview" ? cleanUrl(raw.r) : null,
    lang: clip(raw.l, 16),
    utm: raw.t === "pageview" ? { source: clip(utm.source, 60), medium: clip(utm.medium, 60), campaign: clip(utm.campaign, 60) } : { source: null, medium: null, campaign: null }
  };
  if (raw.t === "action") {
    if (typeof raw.a !== "string" || !/^[a-z0-9:._-]{1,40}$/.test(raw.a)) return null;
    event.label = raw.a;
    event.target = cleanUrl(raw.h);
  }
  if (raw.t === "engage") {
    const seconds = Math.round(Number(raw.s));
    if (!(seconds >= 1 && seconds <= 1800)) return null;
    event.seconds = seconds;
  }
  return event;
}

function cleanPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  let path = value.split(/[?#]/)[0].slice(0, 200);
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  return path;
}

function cleanUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "mailto:") return `mailto:${url.pathname}`.slice(0, 300);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

function clip(value, length) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, length) : null;
}

export function classifySource(referrer, utmSource, ownHosts = new Set()) {
  let host = null;
  try { host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : null; } catch { /* Treated as direct. */ }
  if (host && ownHosts.has(host)) return { source: "internal", referrer: null };
  if (utmSource) return { source: SOURCE_ALIASES.get(sourceKey(utmSource)) ?? utmSource, referrer };
  if (!host) return { source: "Direct", referrer: null };
  const known = KNOWN_SOURCES.find(([pattern]) => pattern.test(host));
  return { source: known ? known[1] : host, referrer };
}

function sourceKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseUserAgent(userAgent = "") {
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent) ? "Tablet" : /Mobi|iPhone|Android/i.test(userAgent) ? "Mobile" : "Desktop";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\/|Opera/.test(userAgent) ? "Opera" : /SamsungBrowser/.test(userAgent) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(userAgent) ? "Firefox" : /Chrome\/|CriOS/.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Other";
  const os = /Windows/.test(userAgent) ? "Windows" : /iPhone|iPad|iPod/.test(userAgent) ? "iOS" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Android/.test(userAgent) ? "Android" : /CrOS/.test(userAgent) ? "ChromeOS" : /Linux/.test(userAgent) ? "Linux" : "Other";
  return { device, browser, os };
}

export function isBot(userAgent = "") {
  return !userAgent || /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|scanner|monitor|curl|wget|python|httpclient|axios|node-fetch|facebookexternalhit|embedly|whatsapp|phantomjs|puppeteer|playwright|selenium/i.test(userAgent);
}

export function classifyOrg(org = "") {
  if (HOSTING_PATTERN.test(org)) return "hosting";
  if (ISP_PATTERN.test(org)) return "isp";
  return "org";
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "").split(",").map(origin => origin.trim()).filter(Boolean);
}

function internalHosts(env) {
  const hosts = new Set();
  for (const origin of allowedOrigins(env)) {
    try { hosts.add(new URL(origin).hostname.replace(/^www\./, "")); } catch { /* Ignore malformed entries. */ }
  }
  return hosts;
}

function toHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Dashboard

async function handleDashboard(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  if (!env.DASHBOARD_PASSWORD) return new Response("Set the DASHBOARD_PASSWORD secret to enable the dashboard.", { status: 503 });
  if (!(await authorized(request, env.DASHBOARD_PASSWORD))) {
    return new Response("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="dipops insights", charset="UTF-8"', "Cache-Control": "no-store" } });
  }
  const url = new URL(request.url);
  const days = RANGES.has(url.searchParams.get("days")) ? url.searchParams.get("days") : "7";
  const headers = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
  if (url.searchParams.get("format") === "csv") {
    return new Response(await exportCsv(env.DB, Number(days)), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dipops-insights-${days}d.csv"` }
    });
  }
  const data = await loadDashboard(env.DB, Number(days));
  return new Response(renderDashboard(data, { days, timeZone: env.TIMEZONE || "America/Toronto", now: Date.now() }), {
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

export async function authorized(request, expected) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  let credentials;
  try { credentials = atob(header.slice(6)); } catch { return false; }
  const password = credentials.slice(credentials.indexOf(":") + 1);
  const [given, wanted] = await Promise.all([password, expected].map(value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  const a = new Uint8Array(given), b = new Uint8Array(wanted);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function loadDashboard(db, days) {
  const since = Date.now() - days * DAY_MS;
  const query = sql => db.prepare(sql).bind(since);
  const results = await db.batch([
    query(`SELECT COUNT(DISTINCT visitor) AS visits, COALESCE(SUM(type = 'pageview'), 0) AS views,
      COALESCE(SUM(type = 'action'), 0) AS actions, COALESCE(SUM(seconds), 0) AS seconds FROM events WHERE ts >= ?`),
    query(`SELECT day, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? GROUP BY day ORDER BY day`),
    query(`SELECT path, SUM(type = 'pageview') AS views, COUNT(DISTINCT CASE WHEN type = 'pageview' THEN visitor END) AS visits,
      COALESCE(SUM(seconds), 0) AS seconds FROM events WHERE ts >= ? GROUP BY path HAVING views > 0 ORDER BY views DESC LIMIT 15`),
    query(`SELECT source AS name, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND type = 'pageview'
      AND source IS NOT NULL AND source != 'internal' GROUP BY source ORDER BY visits DESC LIMIT 12`),
    query(`SELECT referrer AS name, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND referrer IS NOT NULL
      GROUP BY referrer ORDER BY visits DESC LIMIT 10`),
    query(`SELECT utm_campaign AS name, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND utm_campaign IS NOT NULL
      GROUP BY utm_campaign ORDER BY visits DESC LIMIT 10`),
    query(`SELECT org AS name, COUNT(DISTINCT visitor) AS visits, SUM(type = 'pageview') AS views, MAX(ts) AS last
      FROM events WHERE ts >= ? AND org IS NOT NULL GROUP BY org ORDER BY visits DESC, last DESC LIMIT 60`),
    query(`SELECT country, city, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND country IS NOT NULL
      GROUP BY country, city ORDER BY visits DESC LIMIT 15`),
    query(`SELECT label AS name, COUNT(*) AS clicks, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND type = 'action'
      GROUP BY label ORDER BY clicks DESC`),
    query(`SELECT device AS name, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND type = 'pageview'
      GROUP BY device ORDER BY visits DESC`),
    query(`SELECT browser || ' on ' || os AS name, COUNT(DISTINCT visitor) AS visits FROM events WHERE ts >= ? AND type = 'pageview'
      GROUP BY browser, os ORDER BY visits DESC LIMIT 8`),
    query(`SELECT visitor, MAX(ts) AS last FROM events WHERE ts >= ? GROUP BY visitor ORDER BY last DESC LIMIT 25`)
  ]);
  const [summary, daily, pages, sources, referrers, campaigns, orgs, places, actions, devices, browsers, recent] = results.map(result => result.results);
  const ids = recent.map(row => row.visitor);
  const rows = ids.length
    ? (await db.prepare(`SELECT visitor, ts, type, path, label, seconds, source, country, region, city, org, device FROM events
        WHERE visitor IN (${ids.map(() => "?").join(",")}) ORDER BY ts`).bind(...ids).all()).results
    : [];
  return { summary: summary[0], daily, pages, sources, referrers, campaigns, orgs, places, actions, devices, browsers, visits: buildVisits(ids, rows) };
}

function buildVisits(ids, rows) {
  const visits = new Map(ids.map(id => [id, { pages: [], actions: [], seconds: 0, first: null, last: null, source: null, org: null, place: null, device: null }]));
  for (const row of rows) {
    const visit = visits.get(row.visitor);
    visit.first ??= row.ts;
    visit.last = row.ts;
    visit.org ??= row.org;
    visit.place ??= row.country ? { country: row.country, city: row.city, region: row.region } : null;
    visit.device ??= row.device;
    if (row.type === "pageview") {
      if (row.source && row.source !== "internal") visit.source ??= row.source;
      if (visit.pages.at(-1) !== row.path) visit.pages.push(row.path);
    }
    if (row.type === "action") visit.actions.push(row.label);
    if (row.type === "engage") visit.seconds += row.seconds;
  }
  return [...visits.values()].sort((a, b) => b.last - a.last);
}

async function exportCsv(db, days) {
  const { results } = await db.prepare(
    `SELECT datetime(ts / 1000, 'unixepoch') AS time_utc, type, path, label, target, seconds, source, referrer, utm_medium, utm_campaign,
      country, region, city, org, device, browser, os, lang, visitor FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT 50000`
  ).bind(Date.now() - days * DAY_MS).all();
  const columns = ["time_utc", "type", "path", "label", "target", "seconds", "source", "referrer", "utm_medium", "utm_campaign",
    "country", "region", "city", "org", "device", "browser", "os", "lang", "visitor"];
  return [columns.join(","), ...results.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\r\n");
}

export function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

function countryName(code) {
  if (!/^[A-Z]{2}$/.test(code || "")) return code || "Unknown";
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch { return code; }
}

function flag(code) {
  return /^[A-Z]{2}$/.test(code || "") && code !== "XX" && code !== "T1" ? String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0))) : "";
}

function placeLabel(place) {
  if (!place) return "Unknown location";
  return [place.city, countryName(place.country)].filter(Boolean).join(", ");
}

function barList(rows, { label, value, format = String, empty = "Nothing yet." }) {
  if (!rows.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  const max = Math.max(...rows.map(value), 1);
  return `<ol class="bars">${rows.map(row => `<li><span class="bar" style="width:${(value(row) / max * 100).toFixed(1)}%"></span><span class="bar-label">${label(row)}</span><span class="bar-value">${escapeHtml(format(value(row)))}</span></li>`).join("")}</ol>`;
}

function dailyChart(daily, days, now) {
  const counts = new Map(daily.map(row => [row.day, row.visits]));
  const span = Math.max(days, 1);
  const series = Array.from({ length: span }, (_, index) => {
    const day = new Date(now - (span - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    return { day, visits: counts.get(day) || 0 };
  });
  const max = Math.max(...series.map(point => point.visits), 1);
  const width = 720, height = 120, gap = span > 30 ? 1 : 3, barWidth = (width - gap * (span - 1)) / span;
  const bars = series.map((point, index) => {
    const barHeight = point.visits ? Math.max(2, point.visits / max * (height - 4)) : 0;
    return `<rect x="${(index * (barWidth + gap)).toFixed(1)}" y="${(height - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1.5"><title>${point.day}: ${point.visits} visit${point.visits === 1 ? "" : "s"}</title></rect>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Visits per day">${bars}<line x1="0" y1="${height - 0.5}" x2="${width}" y2="${height - 0.5}" /></svg>
    <div class="chart-axis"><span>${escapeHtml(series[0].day)}</span><span>peak ${max} a day</span><span>${escapeHtml(series.at(-1).day)}</span></div>`;
}

export function renderDashboard(data, { days, timeZone, now }) {
  const { summary, daily, pages, sources, referrers, campaigns, orgs, places, actions, devices, browsers, visits } = data;
  const when = new Intl.DateTimeFormat("en-CA", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const grouped = { org: [], isp: [], hosting: [] };
  for (const row of orgs) grouped[classifyOrg(row.name)].push(row);
  const orgBars = rows => barList(rows, {
    label: row => `${escapeHtml(row.name)} <small>${row.views} view${row.views === 1 ? "" : "s"} · last ${escapeHtml(when.format(row.last))}</small>`,
    value: row => row.visits,
    empty: "No organizations yet."
  });
  const tabs = [...RANGES].map(([value, name]) => `<a href="?days=${value}"${value === days ? ' aria-current="page"' : ""}>${name}</a>`).join("");
  const avgSeconds = summary.visits ? summary.seconds / summary.visits : 0;
  const visitRows = visits.map(visit => `<tr>
      <td>${escapeHtml(when.format(visit.last))}</td>
      <td><strong>${escapeHtml(visit.org || "Unknown network")}</strong><small>${flag(visit.place?.country)} ${escapeHtml(placeLabel(visit.place))} · ${escapeHtml(visit.device || "")}</small></td>
      <td>${escapeHtml(visit.source || "—")}</td>
      <td class="journey">${visit.pages.map(path => `<code>${escapeHtml(path)}</code>`).join(' <span aria-hidden="true">→</span> ') || "—"}</td>
      <td>${visit.actions.map(label => escapeHtml(ACTION_NAMES.get(label) || label)).join(", ") || "—"}</td>
      <td>${formatDuration(visit.seconds)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Insights — dipops.com</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --panel:#f6f6f6; --text:#191919; --muted:#666; --border:#dedede; --accent:#256342; --bar:#dcebdc; }
  @media (prefers-color-scheme: dark) { :root { --bg:#151515; --panel:#1e1e1e; --text:#ededed; --muted:#aaa; --border:#363636; --accent:#b8ee75; --bar:#233429; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
  header { background: #10251e; color: #f7faf8; border-bottom: 1px solid #294239; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 1.25rem; }
  header .wrap { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; min-height: 68px; }
  .brand { font-weight: 700; font-size: 1.125rem; letter-spacing: -.03em; }
  .brand span { color: #b8ee75; }
  nav { display: flex; gap: .25rem; flex-wrap: wrap; }
  nav a { color: #c6d2cd; text-decoration: none; font-size: .875rem; padding: .4rem .7rem; border-radius: 5px; }
  nav a[aria-current] { background: #b8ee75; color: #10251e; font-weight: 600; }
  main.wrap { padding-top: 2.25rem; padding-bottom: 3rem; }
  h1 { font-size: 1.5rem; letter-spacing: -.02em; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 0 0 1rem; }
  .lede { color: var(--muted); margin: 0 0 1.5rem; }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
  .kpi, .card { border: 1px solid var(--border); border-radius: 8px; padding: 1.1rem 1.25rem; background: var(--bg); min-width: 0; }
  .kpi b { display: block; font-size: 1.75rem; letter-spacing: -.03em; line-height: 1.2; }
  .kpi span { color: var(--muted); font-size: .8125rem; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1rem; }
  .card p.hint { color: var(--muted); font-size: .8125rem; margin: -.5rem 0 1rem; }
  .chart { width: 100%; height: 120px; display: block; fill: var(--accent); }
  .chart line { stroke: var(--border); }
  .chart-axis { display: flex; justify-content: space-between; color: var(--muted); font-size: .75rem; margin-top: .4rem; }
  .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
  .bars li { position: relative; display: flex; justify-content: space-between; gap: 1rem; padding: .35rem .6rem; font-size: .875rem; min-width: 0; }
  .bar { position: absolute; inset: 0 auto 0 0; background: var(--bar); border-radius: 4px; z-index: 0; }
  .bar-label, .bar-value { position: relative; z-index: 1; }
  .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .bar-label small { color: var(--muted); margin-left: .35rem; }
  .bar-value { font-variant-numeric: tabular-nums; font-weight: 600; }
  details { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: .75rem; }
  summary { cursor: pointer; color: var(--accent); font-size: .875rem; }
  details .bars { margin-top: .75rem; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; padding: 0 .75rem .5rem 0; border-bottom: 1px solid var(--border); }
  td { padding: .7rem .75rem .7rem 0; border-bottom: 1px solid var(--border); vertical-align: top; }
  td small { display: block; color: var(--muted); }
  td code { font: .8125rem ui-monospace, SFMono-Regular, Consolas, monospace; background: var(--panel); padding: .05rem .3rem; border-radius: 3px; }
  .table-scroll { overflow-x: auto; }
  .empty { color: var(--muted); font-size: .875rem; margin: 0; }
  .wide { grid-column: 1 / -1; }
  footer { color: var(--muted); font-size: .8125rem; border-top: 1px solid var(--border); padding-top: 1.25rem; margin-top: 2rem; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; }
  footer a { color: var(--accent); }
  @media (max-width: 800px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header><div class="wrap"><div class="brand">dipo<span>/</span>ops<span>.</span> insights</div><nav aria-label="Time range">${tabs}</nav></div></header>
<main class="wrap">
  <h1>Who visited, and what for</h1>
  <p class="lede">Last ${escapeHtml(RANGES.get(days))} on dipops.com. A visit is one person on one day; your own visits are excluded once you open dipops.com/?no-insights.</p>
  <section class="kpis" aria-label="Summary">
    <div class="kpi"><b>${summary.visits}</b><span>Visits</span></div>
    <div class="kpi"><b>${summary.views}</b><span>Page views</span></div>
    <div class="kpi"><b>${summary.actions}</b><span>Actions (résumé, email, links)</span></div>
    <div class="kpi"><b>${formatDuration(avgSeconds)}</b><span>Avg. engaged time per visit</span></div>
  </section>
  <section class="card" aria-label="Visits per day">${dailyChart(daily, Number(days), now)}</section>
  <div class="grid">
    <section class="card">
      <h2>Who: organizations</h2>
      <p class="hint">The network a visit came from. Company and university networks show their name; home and mobile visitors show their internet provider.</p>
      ${orgBars(grouped.org)}
      <details><summary>Internet &amp; mobile providers (${grouped.isp.length})</summary>${orgBars(grouped.isp)}</details>
      <details><summary>Cloud, hosting, VPNs &amp; corporate proxies (${grouped.hosting.length})</summary>${orgBars(grouped.hosting)}</details>
    </section>
    <section class="card">
      <h2>Where from</h2>
      ${barList(places, { label: row => `${flag(row.country)} ${escapeHtml([row.city, countryName(row.country)].filter(Boolean).join(", "))}`, value: row => row.visits, empty: "No locations yet." })}
    </section>
    <section class="card">
      <h2>What for: pages</h2>
      ${barList(pages, { label: row => `<code>${escapeHtml(row.path)}</code> <small>${row.visits} visit${row.visits === 1 ? "" : "s"} · ${formatDuration(row.visits ? row.seconds / row.visits : 0)} avg</small>`, value: row => row.views, empty: "No page views yet." })}
    </section>
    <section class="card">
      <h2>What they did</h2>
      ${barList(actions, { label: row => `${escapeHtml(ACTION_NAMES.get(row.name) || row.name)} <small>${row.visits} visit${row.visits === 1 ? "" : "s"}</small>`, value: row => row.clicks, empty: "No clicks on résumé, email, or outbound links yet." })}
    </section>
    <section class="card">
      <h2>How they found you</h2>
      ${barList(sources, { label: row => escapeHtml(row.name), value: row => row.visits, empty: "No arrivals yet." })}
      <details><summary>Referring pages (${referrers.length})</summary>${barList(referrers, { label: row => escapeHtml(row.name), value: row => row.visits })}</details>
      <details><summary>Campaigns from utm_campaign links (${campaigns.length})</summary>${barList(campaigns, { label: row => escapeHtml(row.name), value: row => row.visits, empty: "Add ?utm_source=linkedin&utm_campaign=job-search to links you share." })}</details>
    </section>
    <section class="card">
      <h2>Devices</h2>
      ${barList(devices, { label: row => escapeHtml(row.name), value: row => row.visits })}
      <details><summary>Browsers</summary>${barList(browsers, { label: row => escapeHtml(row.name), value: row => row.visits })}</details>
    </section>
    <section class="card wide">
      <h2>Recent visits</h2>
      ${visits.length ? `<div class="table-scroll"><table>
        <thead><tr><th scope="col">Last seen</th><th scope="col">Who</th><th scope="col">Came from</th><th scope="col">Viewed</th><th scope="col">Did</th><th scope="col">Time</th></tr></thead>
        <tbody>${visitRows}</tbody></table></div>` : '<p class="empty">No visits recorded yet. Page views appear here within seconds.</p>'}
    </section>
  </div>
  <footer><span>No cookies or IP addresses are stored. Visitor hashes use a salt that is deleted after each day.</span><a href="?days=${days}&amp;format=csv">Download these ${escapeHtml(RANGES.get(days))} as CSV</a></footer>
</main>
</body>
</html>`;
}
