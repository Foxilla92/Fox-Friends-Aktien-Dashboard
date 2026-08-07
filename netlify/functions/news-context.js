"use strict";

const { connect, readJson, writeJson } = require("./runtime-store");

const DASHBOARD_PATH = "shared/dashboard.json";
const CACHE_PATH = "shared/cache/news-context.json";
const CACHE_MS = 15 * 60 * 1000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600"
    },
    body: JSON.stringify(body)
  };
}

function text(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cacheFresh(data) {
  const time = new Date(data?.fetchedAt || 0).getTime();
  return Number.isFinite(time) && Date.now() - time < CACHE_MS;
}

const COMPANY_NAMES = {
  AAPL: "Apple",
  INTC: "Intel",
  MSFT: "Microsoft",
  NVDA: "NVIDIA",
  AMD: "Advanced Micro Devices",
  AMZN: "Amazon",
  GOOGL: "Alphabet Google",
  GOOG: "Alphabet Google",
  META: "Meta Platforms",
  TSLA: "Tesla",
  SIE: "Siemens",
  ENR: "Siemens Energy",
  RHM: "Rheinmetall",
  DRO: "DroneShield"
};

function companyQuery(symbols) {
  const names = (Array.isArray(symbols) ? symbols : [])
    .map(symbol => COMPANY_NAMES[String(symbol || "").toUpperCase()])
    .filter(Boolean)
    .slice(0, 6);

  if (!names.length) return "";
  return `(${names.map(name => `"${name}"`).join(" OR ")})`;
}

function sectorQuery(benchmark) {
  const key = String(benchmark || "").toUpperCase();
  if (key === "SOXX") {
    return '("semiconductor" OR "chip stocks" OR "semiconductor stocks" OR "AI chips")';
  }
  if (key === "XLK") {
    return '("technology stocks" OR "US technology sector" OR "Nasdaq technology")';
  }
  if (key === "XLF") {
    return '("US banks" OR "financial stocks" OR "banking sector")';
  }
  if (key === "XLE") {
    return '("energy stocks" OR "oil stocks" OR "US energy sector")';
  }
  return "";
}

const MARKET_QUERY =
  '("Federal Reserve" OR "FOMC" OR "US inflation" OR "CPI" OR "US jobs" OR "Nasdaq" OR "S&P 500")';

async function gdelt(query, category, maxrecords = 6) {
  if (!query) return [];

  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", String(maxrecords));
  url.searchParams.set("timespan", "24h");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("format", "jsonfeed");

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Fox-Friends-Aktien-Dashboard/1.0"
    }
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`Nachrichtendienst lieferte keine gültigen JSON-Daten (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Nachrichtendienst HTTP ${response.status}`);
  }

  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.articles)
      ? data.articles
      : [];

  return items.map((item, index) => ({
    id: text(item.id || item.url || item.external_url || `${category}-${index}`, 500),
    title: text(item.title, 240),
    url: text(item.url || item.external_url, 900),
    source: text(item.author?.name || item.domain || item.source || "", 100),
    date: text(item.date_published || item.seendate || item.date || "", 80),
    category
  })).filter(item => item.title && item.url);
}

function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = (item.url || item.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

exports.handler = async function(event) {
  connect(event);
  try {
    const cached = await readJson(CACHE_PATH);
    if (cacheFresh(cached.data)) {
      return json(200, {
        status: "ok",
        news: cached.data.news || [],
        fetchedAt: cached.data.fetchedAt,
        cached: true
      });
    }

    const dashboard = await readJson(DASHBOARD_PATH);
    const data = dashboard.data || {};
    const stockQuery = companyQuery(data.symbols);
    const industryQuery = sectorQuery(data.sectorBenchmark);

    const requests = [
      gdelt(MARKET_QUERY, "market", 6)
    ];

    if (industryQuery) requests.push(gdelt(industryQuery, "sector", 5));
    if (stockQuery) requests.push(gdelt(stockQuery, "stocks", 8));

    const settled = await Promise.allSettled(requests);
    const news = dedupe(
      settled.flatMap(result => result.status === "fulfilled" ? result.value : [])
    ).slice(0, 16);

    const payload = {
      fetchedAt: new Date().toISOString(),
      news
    };

    if (news.length) {
      await writeJson(CACHE_PATH, payload, "Markt-Nachrichten aktualisieren").catch(() => {});
    }

    const failures = settled.filter(result => result.status === "rejected");
    return json(200, {
      status: "ok",
      news,
      fetchedAt: payload.fetchedAt,
      cached: false,
      warning: failures.length ? `${failures.length} Nachrichtenabfrage(n) nicht verfügbar.` : ""
    });
  } catch (error) {
    try {
      const cached = await readJson(CACHE_PATH);
      if (Array.isArray(cached.data?.news) && cached.data.news.length) {
        return json(200, {
          status: "ok",
          news: cached.data.news,
          fetchedAt: cached.data.fetchedAt,
          cached: true,
          warning: error.message
        });
      }
    } catch {}

    return json(200, {
      status: "ok",
      news: [],
      message: error.message || "Nachrichten derzeit nicht verfügbar."
    });
  }
};
