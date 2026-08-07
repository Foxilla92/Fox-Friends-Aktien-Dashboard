"use strict";

const { connect, readJson, writeJson } = require("./runtime-store");
const CACHE_PATH = "shared/cache/macro-calendar.json";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=1800"
    },
    body: JSON.stringify(body)
  };
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function cacheFresh(cache) {
  return cache?.fetchedAt && Date.now() - new Date(cache.fetchedAt).getTime() < 60 * 60 * 1000;
}

function normalize(event) {
  return {
    id: String(event.CalendarId || event.id || ""),
    date: event.Date || event.date,
    country: event.Country || event.country || "",
    category: event.Category || event.category || "",
    event: event.Event || event.event || event.Category || "",
    importance: Number(event.Importance || event.importance || 3),
    source: event.Source || event.source || ""
  };
}

exports.handler = async function(event) {
  connect(event);
  try {
    const stored = await readJson(CACHE_PATH);
    if (cacheFresh(stored.data)) {
      return json(200, {
        status: "ok",
        events: stored.data.events || [],
        cached: true,
        configured: true
      });
    }

    const key = String(process.env.TRADING_ECONOMICS_API_KEY || "").trim();
    if (!key) {
      if (stored.data?.events?.length) {
        return json(200, {
          status: "ok",
          events: stored.data.events,
          cached: true,
          configured: false,
          warning: "Kein Trading-Economics-API-Key hinterlegt; letzter gespeicherter Kalender wird angezeigt."
        });
      }

      return json(200, {
        status: "ok",
        events: [],
        configured: false,
        message: "Wirtschaftskalender noch nicht aktiviert. In Netlify kann optional TRADING_ECONOMICS_API_KEY hinterlegt werden."
      });
    }

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 3);

    const countries = "united%20states,euro%20area,germany";
    const url =
      `https://api.tradingeconomics.com/calendar/country/${countries}/${ymd(start)}/${ymd(end)}` +
      `?c=${encodeURIComponent(key)}&importance=3&f=json`;

    const response = await fetch(url, {
      headers: { "Accept": "application/json" }
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error(`Kalenderanbieter lieferte keine JSON-Daten (HTTP ${response.status}).`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Kalenderantwort konnte nicht gelesen werden (HTTP ${response.status}).`);
    }

    if (!response.ok || !Array.isArray(data)) {
      throw new Error(data?.message || `Kalender-HTTP ${response.status}`);
    }

    const events = data
      .map(normalize)
      .filter(event => event.date && event.importance >= 3)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const cache = { fetchedAt: new Date().toISOString(), events };
    await writeJson(CACHE_PATH, cache, "Makro-Kalender aktualisieren").catch(() => {});

    return json(200, {
      status: "ok",
      events,
      cached: false,
      configured: true
    });
  } catch (error) {
    try {
      const stored = await readJson(CACHE_PATH);
      if (stored.data?.events) {
        return json(200, {
          status: "ok",
          events: stored.data.events,
          cached: true,
          configured: Boolean(process.env.TRADING_ECONOMICS_API_KEY),
          warning: error.message
        });
      }
    } catch {}

    return json(200, {
      status: "ok",
      events: [],
      configured: Boolean(process.env.TRADING_ECONOMICS_API_KEY),
      message: error.message || "Wirtschaftskalender nicht verfügbar."
    });
  }
};
