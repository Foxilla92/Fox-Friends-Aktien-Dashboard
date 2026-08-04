
"use strict";

const byId = (id) => document.getElementById(id);
const SETTINGS_KEY = "foxilla-signal-radar-settings-v2";
let results = [];
let activeFilter = "all";
let autoRefreshTimer = null;

const settingIds = [
  "symbols","interval","autoRefresh","rsiLength","rsiMaLength",
  "buyThreshold","sellThreshold","minimumPotential","crossLookback"
];

function getSettings() {
  return {
    symbols: [...new Set(
      byId("symbols").value.toUpperCase().split(/[\s,;]+/).map(v => v.trim()).filter(Boolean)
    )],
    interval: byId("interval").value,
    autoRefresh: Number(byId("autoRefresh").value || 0),
    rsiLength: Number(byId("rsiLength").value || 14),
    rsiMaLength: Number(byId("rsiMaLength").value || 14),
    buyThreshold: Number(byId("buyThreshold").value || 70),
    sellThreshold: Number(byId("sellThreshold").value || 70),
    minimumPotential: Number(byId("minimumPotential").value || 5),
    crossLookback: Number(byId("crossLookback").value || 3)
  };
}

function saveSettings() {
  const data = {};
  for (const id of settingIds) data[id] = byId(id).value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    for (const id of settingIds) {
      if (saved[id] !== undefined) byId(id).value = saved[id];
    }
  } catch {}
  setupAutoRefresh();
}

function setupAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  const minutes = Number(byId("autoRefresh").value || 0);
  if (minutes > 0) autoRefreshTimer = setInterval(runAnalysis, minutes * 60 * 1000);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateRsi(closes, period) {
  const output = Array(closes.length).fill(null);
  if (closes.length <= period) return output;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[i] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return output;
}

function simpleMovingAverage(values, period) {
  return values.map((_, index) => {
    const window = values.slice(index - period + 1, index + 1);
    return window.length === period && window.every(Number.isFinite)
      ? window.reduce((sum, value) => sum + value, 0) / period
      : null;
  });
}

function positionInRange(current, low, high) {
  if (!Number.isFinite(current) || !Number.isFinite(low) || !Number.isFinite(high) || high === low) return 50;
  return clamp(((current - low) / (high - low)) * 100, 0, 100);
}

function buyRsiScore(rsi) {
  if (rsi <= 30) return 100;
  if (rsi >= 65) return 0;
  return ((65 - rsi) / 35) * 100;
}

function sellRsiScore(rsi) {
  if (rsi >= 70) return 100;
  if (rsi <= 35) return 0;
  return ((rsi - 35) / 35) * 100;
}

function buyPriceScore(positionPercent) {
  return Math.pow(1 - positionPercent / 100, 0.65) * 100;
}

function sellPriceScore(positionPercent) {
  return Math.pow(positionPercent / 100, 0.65) * 100;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a,b)=>a+b,0) / valid.length : NaN;
}

function volumeContext(dailyRows) {
  const rows = dailyRows.slice(-21);
  const latest = rows.at(-1);
  const history = rows.slice(0,-1);
  const avg20 = average(history.map(r=>r.volume));
  const current = latest?.volume;
  if (!Number.isFinite(current) || !Number.isFinite(avg20) || avg20 <= 0) {
    return { current, average20: avg20, ratio: NaN, score: 50, label: "neutral" };
  }
  const ratio = current / avg20;
  if (ratio >= 1.5) return {current,average20:avg20,ratio,score:100,label:"sehr hoch"};
  if (ratio >= 1.2) return {current,average20:avg20,ratio,score:80,label:"hoch"};
  if (ratio >= 0.9) return {current,average20:avg20,ratio,score:60,label:"normal"};
  if (ratio >= 0.7) return {current,average20:avg20,ratio,score:40,label:"niedrig"};
  return {current,average20:avg20,ratio,score:20,label:"sehr niedrig"};
}

function fibonacciContext(current, low, high) {
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const span = high - low;
  if (!Number.isFinite(current) || !Number.isFinite(span) || span <= 0) {
    return {
      nearestRatio: 0.5,
      nearestPrice: current,
      nextHigherPrice: current,
      nextLowerPrice: current,
      upsideToNext: 0,
      downsideToNext: 0,
      buyScore: 50,
      sellScore: 50
    };
  }

  const levels = ratios.map(ratio => ({ ratio, price: low + span * ratio }));
  const nearest = levels.reduce((best, level) =>
    Math.abs(level.price - current) < Math.abs(best.price - current) ? level : best
  );

  const higher = levels.find(level => level.price > current) || levels.at(-1);
  const lower = [...levels].reverse().find(level => level.price < current) || levels[0];

  const upsideToNext = current > 0 ? Math.max((higher.price / current - 1) * 100, 0) : 0;
  const downsideToNext = current > 0 ? Math.max((1 - lower.price / current) * 100, 0) : 0;

  // Fibonacci ergänzt die bestehende Bewertung, ohne sie zu dominieren:
  // Für Käufe zählen erreichbarer Raum bis zum nächsten Fib-Widerstand und
  // Nähe zu typischen Rücklaufzonen. Für Verkäufe gilt die Spiegelung.
  const position = positionInRange(current, low, high);
  const retracementSupport =
    position <= 23.6 ? 100 :
    position <= 38.2 ? 90 :
    position <= 50 ? 72 :
    position <= 61.8 ? 52 :
    position <= 78.6 ? 28 : 8;

  const resistancePressure =
    position >= 78.6 ? 100 :
    position >= 61.8 ? 90 :
    position >= 50 ? 72 :
    position >= 38.2 ? 52 :
    position >= 23.6 ? 28 : 8;

  const roomUpScore = clamp((upsideToNext / 5) * 100, 0, 100);
  const roomDownScore = clamp((downsideToNext / 5) * 100, 0, 100);

  return {
    nearestRatio: nearest.ratio,
    nearestPrice: nearest.price,
    nextHigherPrice: higher.price,
    nextLowerPrice: lower.price,
    upsideToNext,
    downsideToNext,
    buyScore: retracementSupport * 0.6 + roomUpScore * 0.4,
    sellScore: resistancePressure * 0.6 + roomDownScore * 0.4
  };
}

function recentCrossScore(rsi, average, direction, lookback) {
  for (let i = rsi.length - 1; i >= Math.max(1, rsi.length - 1 - lookback); i--) {
    const values = [rsi[i], average[i], rsi[i - 1], average[i - 1]];
    if (!values.every(Number.isFinite)) continue;
    if (direction === "up" && rsi[i - 1] <= average[i - 1] && rsi[i] > average[i]) return 100;
    if (direction === "down" && rsi[i - 1] >= average[i - 1] && rsi[i] < average[i]) return 100;
  }
  const last = rsi.length - 1;
  if (!Number.isFinite(rsi[last]) || !Number.isFinite(average[last])) return 0;
  return direction === "up" ? (rsi[last] > average[last] ? 50 : 0) : (rsi[last] < average[last] ? 50 : 0);
}

async function fetchMarketData(symbol, interval) {
  const url = new URL("/.netlify/functions/market-data", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);

  const response = await fetch(url);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(response.status === 404
      ? "Backend-Funktion nicht gefunden. Prüfe in GitHub den Pfad netlify/functions/market-data.js."
      : `Backend lieferte keine JSON-Antwort (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!response.ok || data.status === "error" || !data.intraday || !data.daily) {
    throw new Error(data.message || `Keine Daten für ${symbol}`);
  }
  return data;
}

async function analyzeSymbol(symbol, settings) {
  const marketData = await fetchMarketData(symbol, settings.interval);
  const intradayData = marketData.intraday;
  const dailyData = marketData.daily;
  const resolvedSymbol = marketData.resolvedSymbol || symbol;
  const resolvedExchange = marketData.resolvedExchange || "";
  const tradingViewSymbol = marketData.tradingViewSymbol || symbol;

  const intradayCloses = intradayData.values.map(row => Number(row.close));
  const rsiValues = calculateRsi(intradayCloses, settings.rsiLength);
  const rsiAverage = simpleMovingAverage(rsiValues, settings.rsiMaLength);
  const lastIndex = intradayCloses.length - 1;

  const daily = dailyData.values.map(row => ({
    close: Number(row.close),
    low: Number(row.low),
    high: Number(row.high),
    volume: Number(row.volume)
  }));
  const latest = daily.at(-1);
  const threeMonths = daily.slice(-63);
  const oneYear = daily.slice(-252);

  const threeMonthLow = Math.min(...threeMonths.map(row => row.low));
  const threeMonthHigh = Math.max(...threeMonths.map(row => row.high));
  const oneYearLow = Math.min(...oneYear.map(row => row.low));
  const oneYearHigh = Math.max(...oneYear.map(row => row.high));

  const threeMonthPosition = positionInRange(latest.close, threeMonthLow, threeMonthHigh);
  const oneYearPosition = positionInRange(latest.close, oneYearLow, oneYearHigh);

  const currentRsi = rsiValues[lastIndex];
  const currentRsiAverage = rsiAverage[lastIndex];
  const buyCross = recentCrossScore(rsiValues, rsiAverage, "up", settings.crossLookback);
  const sellCross = recentCrossScore(rsiValues, rsiAverage, "down", settings.crossLookback);

  const fibonacci = fibonacciContext(latest.close, threeMonthLow, threeMonthHigh);

  const volume = volumeContext(daily);

  const buyScore =
    buyRsiScore(currentRsi) * 0.45 +
    buyPriceScore(threeMonthPosition) * 0.20 +
    buyPriceScore(oneYearPosition) * 0.10 +
    buyCross * 0.10 +
    fibonacci.buyScore * 0.10 +
    volume.score * 0.05;

  const sellScore =
    sellRsiScore(currentRsi) * 0.45 +
    sellPriceScore(threeMonthPosition) * 0.20 +
    sellPriceScore(oneYearPosition) * 0.10 +
    sellCross * 0.10 +
    fibonacci.sellScore * 0.10 +
    volume.score * 0.05;

  const directionAgreement = buyScore >= sellScore
    ? (currentRsi > currentRsiAverage ? 100 : 45)
    : (currentRsi < currentRsiAverage ? 100 : 45);
  const confidence = volume.score * 0.60 + directionAgreement * 0.40;

  const upsidePotential = Math.max((threeMonthHigh / latest.close - 1) * 100, 0);
  const downsidePotential = Math.max((1 - threeMonthLow / latest.close) * 100, 0);

  const buyPotentialScore = clamp((upsidePotential / 10) * 100, 0, 100);
  const sellPotentialScore = clamp((downsidePotential / 10) * 100, 0, 100);
  const buyRank = buyScore * 0.75 + buyPotentialScore * 0.25;
  const sellRank = sellScore * 0.75 + sellPotentialScore * 0.25;

  let kind = "neutral";
  let label = "NEUTRAL";
  if (buyScore >= settings.buyThreshold && upsidePotential >= settings.minimumPotential && buyScore >= sellScore) {
    kind = "buy";
    label = "KAUFEN";
  } else if (buyScore >= 60 && upsidePotential >= Math.min(3, settings.minimumPotential) && buyScore >= sellScore) {
    kind = "watch";
    label = "KAUF PRÜFEN";
  } else if (sellScore >= settings.sellThreshold && sellScore > buyScore) {
    kind = "sell";
    label = "VERKAUFEN";
  } else if (sellScore >= 60 && sellScore > buyScore) {
    kind = "watch";
    label = "VERKAUF PRÜFEN";
  }

  return {
    symbol,
    resolvedSymbol,
    resolvedExchange,
    tradingViewSymbol,
    kind,
    label,
    price: latest.close,
    rsi: currentRsi,
    rsiAverage: currentRsiAverage,
    threeMonthPosition,
    oneYearPosition,
    buyScore,
    sellScore,
    upsidePotential,
    downsidePotential,
    fibonacciRatio: fibonacci.nearestRatio,
    fibonacciPrice: fibonacci.nearestPrice,
    fibonacciTargetPrice: fibonacci.nextHigherPrice,
    fibonacciTargetPotential: fibonacci.upsideToNext,
    fibonacciSupportPrice: fibonacci.nextLowerPrice,
    fibonacciSupportDownside: fibonacci.downsideToNext,
    fibonacciBuyScore: fibonacci.buyScore,
    fibonacciSellScore: fibonacci.sellScore,
    volumeCurrent: volume.current,
    volumeAverage20: volume.average20,
    volumeRatio: volume.ratio,
    volumeScore: volume.score,
    volumeLabel: volume.label,
    confidence,
    rank: Math.max(buyRank, sellRank),
    error: null
  };
}

function formatNumber(value, decimals = 1) {
  return Number.isFinite(value)
    ? value.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : "–";
}

function cardHtml(item) {
  const mainScore = item.kind === "sell" ? item.sellScore : item.buyScore;
  const mainLabel = item.kind === "sell" ? "Verkauf" : "Einstieg";
  const explanation = item.error
    ? item.error
    : `RSI ${formatNumber(item.rsi)} · 3M-Lage ${formatNumber(item.threeMonthPosition, 0)} % · Jahreslage ${formatNumber(item.oneYearPosition, 0)} % · nächstes Fib ${formatNumber(item.fibonacciRatio * 100, 1)} %`;

  return `
    <article class="signal-card">
      <div class="signal-card-header">
        <div>
          <div class="symbol">${item.symbol}</div>
          <div class="price">Kurs ${formatNumber(item.price, 2)}${item.resolvedExchange ? ` · ${item.resolvedExchange}` : ""}</div>
        </div>
        <span class="signal-pill ${item.kind}">${item.label}</span>
      </div>

      <div class="score-row">
        <strong>${formatNumber(mainScore, 0)}</strong>
        <span>${mainLabel}/100</span>
      </div>
      <div class="progress"><i style="width:${clamp(mainScore, 0, 100)}%"></i></div>

      <div class="metric-grid">
        <div class="metric"><span>RSI</span><strong>${formatNumber(item.rsi)}</strong></div>
        <div class="metric"><span>Gelb</span><strong>${formatNumber(item.rsiAverage)}</strong></div>
        <div class="metric"><span>3 Monate</span><strong>${formatNumber(item.threeMonthPosition, 0)} %</strong></div>
        <div class="metric"><span>1 Jahr</span><strong>${formatNumber(item.oneYearPosition, 0)} %</strong></div>
      </div>

      <div class="metric-grid secondary-metrics">
        <div class="metric"><span>Volumen</span><strong>${Number.isFinite(item.volumeRatio) ? formatNumber(item.volumeRatio * 100, 0) + " %" : "–"}</strong></div>
        <div class="metric"><span>Volumenlage</span><strong>${item.volumeLabel || "–"}</strong></div>
        <div class="metric"><span>Vertrauen</span><strong>${formatNumber(item.confidence, 0)} %</strong></div>
        <div class="metric"><span>Fib</span><strong>${formatNumber(item.fibonacciRatio * 100, 1)} %</strong></div>
      </div>

      <div class="potential-box">
        ↗ 3M-Hoch: +${formatNumber(item.upsidePotential)} %<br>
        ◇ Nächstes Fib-Ziel: ${formatNumber(item.fibonacciTargetPrice, 2)} (+${formatNumber(item.fibonacciTargetPotential)} %)
      </div>
      <div class="explanation">${explanation}</div>

      <div class="card-actions">
        <button class="chart-button" data-chart="${item.symbol}" data-tv-symbol="${item.tradingViewSymbol || ""}">TradingView-Chart öffnen</button>
      </div>
    </article>`;
}

function render() {
  const filtered = results
    .filter(item => activeFilter === "all" || item.kind === activeFilter)
    .sort((a, b) => b.rank - a.rank);

  byId("cards").innerHTML = filtered.map(cardHtml).join("");
  byId("emptyState").hidden = results.length > 0;

  byId("buyCount").textContent = results.filter(item => item.kind === "buy").length;
  byId("watchCount").textContent = results.filter(item => item.kind === "watch").length;
  byId("sellCount").textContent = results.filter(item => item.kind === "sell").length;

  document.querySelectorAll("[data-chart]").forEach(button => {
    button.addEventListener("click", () => openTradingView(button.dataset.chart, button.dataset.tvSymbol || ""));
  });
}

function setStatus(text) {
  byId("status").textContent = text;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isMinuteLimitError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("current minute") ||
         text.includes("api credits") ||
         text.includes("credit limit") ||
         text.includes("rate limit") ||
         text.includes("too many requests");
}

async function waitForNextMinute(seconds = 61) {
  for (let remaining = seconds; remaining > 0; remaining--) {
    setStatus(`API-Limit erreicht. Fortsetzung nur mit offenen Aktien in ${remaining} Sekunden …`);
    await sleep(1000);
  }
}

async function analyzeWithRetry(symbol, settings) {
  let retries = 0;
  while (true) {
    try {
      return await analyzeSymbol(symbol, settings);
    } catch (error) {
      if (isMinuteLimitError(error.message) && retries < 1) {
        retries += 1;
        await waitForNextMinute();
        // Nur diese offene Aktie wird genau einmal erneut versucht.
        continue;
      }
      throw error;
    }
  }
}

async function runAnalysis() {
  const settings = getSettings();
  if (!settings.symbols.length) {
    setStatus("Bitte mindestens eine Aktie eintragen.");
    byId("settingsDialog").showModal();
    return;
  }

  byId("refreshButton").disabled = true;
  results = [];
  render();

  // Jede Aktie benötigt zwei Abfragen. Die App arbeitet die Watchlist deshalb
  // nacheinander ab. Erfolgreiche Aktien bleiben gespeichert. Wird das Minutenlimit
  // erreicht, wartet die App und versucht ausschließlich die aktuell offene Aktie erneut.
  for (let index = 0; index < settings.symbols.length; index++) {
    const symbol = settings.symbols[index];
    setStatus(`Prüfe ${index + 1} von ${settings.symbols.length}: ${symbol} …`);

    try {
      const item = await analyzeWithRetry(symbol, settings);
      results.push(item);
      render();
    } catch (error) {
      results.push({
        symbol,
        kind: "neutral",
        label: "FEHLER",
        price: NaN,
        rsi: NaN,
        rsiAverage: NaN,
        threeMonthPosition: NaN,
        oneYearPosition: NaN,
        buyScore: 0,
        sellScore: 0,
        upsidePotential: 0,
        downsidePotential: 0,
        fibonacciRatio: 0,
        fibonacciPrice: NaN,
        fibonacciTargetPrice: NaN,
        fibonacciTargetPotential: 0,
        fibonacciSupportPrice: NaN,
        fibonacciSupportDownside: 0,
        fibonacciBuyScore: 0,
        fibonacciSellScore: 0,
        rank: -1,
        error: error.message
      });
      render();
    }
  }

  setStatus(`Aktualisiert: ${new Date().toLocaleString("de-DE")}`);
  byId("refreshButton").disabled = false;
}

function preferredTradingViewSymbol(symbol, resolvedTradingViewSymbol) {
  if (resolvedTradingViewSymbol) return resolvedTradingViewSymbol;
  return symbol;
}

function openTradingView(symbol, resolvedTradingViewSymbol = "") {
  const tradingViewSymbol = preferredTradingViewSymbol(symbol, resolvedTradingViewSymbol);
  byId("chartTitle").textContent = tradingViewSymbol;
  const container = byId("tradingViewContainer");
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "tradingview-widget-container";
  wrapper.style.height = "100%";
  wrapper.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%"></div>';

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.async = true;
  script.text = JSON.stringify({
    autosize: true,
    symbol: tradingViewSymbol,
    interval: "60",
    timezone: "Europe/Berlin",
    theme: "dark",
    style: "1",
    locale: "de_DE",
    allow_symbol_change: true,
    calendar: false,
    support_host: "https://www.tradingview.com"
  });

  wrapper.appendChild(script);
  container.appendChild(wrapper);
  byId("chartDialog").showModal();
}

document.querySelectorAll(".filter-tab, .overview-stat").forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === activeFilter));
    render();
  });
});

byId("settingsButton").addEventListener("click", () => byId("settingsDialog").showModal());
byId("refreshButton").addEventListener("click", runAnalysis);
byId("saveAndRunButton").addEventListener("click", () => {
  saveSettings();
  setupAutoRefresh();
  byId("settingsDialog").close();
  runAnalysis();
});
byId("saveOnlyButton").addEventListener("click", () => {
  saveSettings();
  setupAutoRefresh();
  byId("settingsDialog").close();
  setStatus("Einstellungen gespeichert.");
});
byId("closeChartButton").addEventListener("click", () => byId("chartDialog").close());

loadSettings();
render();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
