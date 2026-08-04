"use strict";

const { readJson, writeJson } = require("./github-store");
const { acquire, release } = require("./run-control");
const { analyzeMarketData } = require("./analysis-core");

const DASHBOARD_PATH = "shared/dashboard.json";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function mapDaily(data) {
  return data?.daily?.values?.map(row => ({
    close: Number(row.close),
    low: Number(row.low),
    high: Number(row.high),
    volume: Number(row.volume)
  })) || null;
}

async function marketData(symbol, interval, mode = "full") {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) throw new Error("Netlify-Site-URL ist nicht verfügbar.");
  const url = new URL("/.netlify/functions/market-data", base);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("mode", mode);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.status === "error") throw new Error(data.message || `Keine Daten für ${symbol}`);
  return data;
}

async function runAutomatic() {
  const lock = await acquire("Automatik", "automatic");
  if (lock.owner !== "Automatik" || lock.mode !== "automatic") return;

  try {
    const stored = await readJson(DASHBOARD_PATH);
    const dashboard = stored.data;
    if (!dashboard?.symbols?.length) throw new Error("Keine gemeinsame Watchlist gespeichert.");

    const settings = {
      interval: dashboard.interval || "1h",
      marketBenchmark: dashboard.marketBenchmark || "SPY",
      sectorBenchmark: dashboard.sectorBenchmark || "",
      rsiLength: Number(dashboard.rsiLength) || 14,
      rsiMaLength: Number(dashboard.rsiMaLength) || 14,
      buyThreshold: Number(dashboard.buyThreshold) || 70,
      sellThreshold: Number(dashboard.sellThreshold) || 70,
      minimumPotential: Number(dashboard.minimumPotential) || 5,
      crossLookback: Number(dashboard.crossLookback) || 3
    };

    let requestsThisMinute = 0;
    async function limitedRequest(symbol) {
      if (requestsThisMinute >= 2) {
        await sleep(61_000);
        requestsThisMinute = 0;
      }
      const result = await marketData(symbol, settings.interval);
      requestsThisMinute += 1;
      return result;
    }

    let benchmarkDaily = null;
    let sectorDaily = null;

    if (settings.marketBenchmark) {
      try { benchmarkDaily = mapDaily(await marketData(settings.marketBenchmark, settings.interval, "benchmark")); } catch {}
    }
    if (settings.sectorBenchmark) {
      try { sectorDaily = mapDaily(await marketData(settings.sectorBenchmark, settings.interval, "benchmark")); } catch {}
    }

    const results = [];
    for (const symbol of dashboard.symbols) {
      try {
        const data = await limitedRequest(symbol);
        results.push(await analyzeMarketData(symbol, settings, data, benchmarkDaily, sectorDaily));
      } catch (error) {
        results.push({
          symbol,
          kind: "error",
          label: "FEHLER",
          buyScore: 0,
          sellScore: 0,
          rank: -1,
          error: error.message || "Unbekannter Fehler"
        });
      }
    }

    const updated = {
      ...dashboard,
      updatedBy: "Automatik",
      updatedAt: new Date().toISOString(),
      results
    };
    await writeJson(DASHBOARD_PATH, updated, "Automatische Dashboard-Prüfung");
    await release("Automatik", true);
  } catch (error) {
    console.error(error);
    await release("Automatik", false).catch(() => {});
  }
}

exports.handler = function() {
  runAutomatic();
  return { statusCode: 202 };
};
