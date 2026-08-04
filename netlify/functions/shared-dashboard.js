"use strict";

const MAX_RESULTS = 100;
const MAX_SYMBOLS = 100;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeResults(results) {
  if (!Array.isArray(results)) return [];
  return results.slice(0, MAX_RESULTS).map(item => ({
    symbol: cleanText(item.symbol, 40),
    resolvedSymbol: cleanText(item.resolvedSymbol, 40),
    resolvedExchange: cleanText(item.resolvedExchange, 30),
    tradingViewSymbol: cleanText(item.tradingViewSymbol, 80),
    kind: cleanText(item.kind, 20),
    label: cleanText(item.label, 30),
    price: finiteOrNull(item.price),
    rsi: finiteOrNull(item.rsi),
    rsiAverage: finiteOrNull(item.rsiAverage),
    threeMonthPosition: finiteOrNull(item.threeMonthPosition),
    oneYearPosition: finiteOrNull(item.oneYearPosition),
    buyScore: finiteOrNull(item.buyScore),
    sellScore: finiteOrNull(item.sellScore),
    upsidePotential: finiteOrNull(item.upsidePotential),
    downsidePotential: finiteOrNull(item.downsidePotential),
    fibonacciRatio: finiteOrNull(item.fibonacciRatio),
    fibonacciPrice: finiteOrNull(item.fibonacciPrice),
    fibonacciTargetPrice: finiteOrNull(item.fibonacciTargetPrice),
    fibonacciTargetPotential: finiteOrNull(item.fibonacciTargetPotential),
    fibonacciSupportPrice: finiteOrNull(item.fibonacciSupportPrice),
    fibonacciSupportDownside: finiteOrNull(item.fibonacciSupportDownside),
    fibonacciBuyScore: finiteOrNull(item.fibonacciBuyScore),
    fibonacciSellScore: finiteOrNull(item.fibonacciSellScore),
    volumeCurrent: finiteOrNull(item.volumeCurrent),
    volumeAverage20: finiteOrNull(item.volumeAverage20),
    volumeRatio: finiteOrNull(item.volumeRatio),
    volumeScore: finiteOrNull(item.volumeScore),
    volumeLabel: cleanText(item.volumeLabel, 30),
    confidence: finiteOrNull(item.confidence),
    rank: finiteOrNull(item.rank),
    error: item.error ? cleanText(item.error, 500) : null
  }));
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json(405, { status: "error", message: "Nur GET und POST sind erlaubt." });
  }

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("fox-friends-shared-dashboard");
    const key = "current-dashboard";

    if (event.httpMethod === "GET") {
      const dashboard = await store.get(key, { type: "json", consistency: "strong" });
      return json(200, { status: "ok", dashboard: dashboard || null });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { status: "error", message: "Ungültige JSON-Daten." });
    }

    const updatedBy = cleanText(body.updatedBy, 40);
    if (!updatedBy) {
      return json(400, { status: "error", message: "Ein Erstellername ist erforderlich." });
    }

    const symbols = Array.isArray(body.symbols)
      ? [...new Set(body.symbols.map(value => cleanText(value, 40)).filter(Boolean))].slice(0, MAX_SYMBOLS)
      : [];

    const dashboard = {
      version: 1,
      updatedBy,
      updatedAt: new Date().toISOString(),
      interval: cleanText(body.interval, 20) || "1h",
      symbols,
      results: sanitizeResults(body.results)
    };

    await store.setJSON(key, dashboard);
    return json(200, { status: "ok", dashboard });
  } catch (error) {
    return json(500, {
      status: "error",
      message: error instanceof Error ? error.message : "Gemeinsamer Speicherfehler."
    });
  }
};
