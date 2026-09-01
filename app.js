
"use strict";

const byId = (id) => document.getElementById(id);
const SETTINGS_KEY = "foxilla-signal-radar-settings-v2";
let results = [];
let currentRunCredits = 0;
let activeFilter = "all";
let analysisInProgress = false;

const settingIds = [
  "displayName","symbols","interval","marketBenchmark","sectorBenchmark","rsiLength","rsiMaLength",
  "buyThreshold","sellThreshold","minimumPotential","crossLookback"
];

function getSettings() {
  const symbols = [...new Set(
    byId("symbols").value.toUpperCase().split(/[\s,;]+/).map(v => v.trim()).filter(Boolean)
  )];

  const enteredSector = byId("sectorBenchmark").value.trim().toUpperCase();
  const sectorBenchmark = enteredSector || (symbols.includes("INTC") ? "SOXX" : "");

  return {
    displayName: byId("displayName").value.trim(),
    symbols,
    interval: byId("interval").value,
    marketBenchmark: byId("marketBenchmark").value.trim().toUpperCase(),
    sectorBenchmark,
    investmentAmount: Number(byId("investmentAmount").value || 1000),
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


function exponentialMovingAverage(values, period) {
  const output = Array(values.length).fill(null);
  if (values.length < period) return output;
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  for (let i = period; i < values.length; i++) {
    current = (values[i] - current) * multiplier + current;
    output[i] = current;
  }
  return output;
}

function standardDeviation(values) {
  const mean = average(values);
  if (!Number.isFinite(mean) || !values.length) return NaN;
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length);
}

function bollingerContext(closes, period = 20, deviations = 2) {
  const window = closes.slice(-period);
  if (window.length < period) return {middle:NaN,upper:NaN,lower:NaN,position:NaN,width:NaN};
  const middle = average(window);
  const deviation = standardDeviation(window);
  const upper = middle + deviations * deviation;
  const lower = middle - deviations * deviation;
  const current = closes.at(-1);
  return {
    middle, upper, lower,
    position: upper === lower ? 50 : clamp((current-lower)/(upper-lower)*100,0,100),
    width: middle ? (upper-lower)/middle*100 : NaN
  };
}

function macdContext(closes) {
  const ema12 = exponentialMovingAverage(closes,12);
  const ema26 = exponentialMovingAverage(closes,26);
  const macdLine = closes.map((_,i)=>Number.isFinite(ema12[i])&&Number.isFinite(ema26[i])?ema12[i]-ema26[i]:null);
  const valid = macdLine.filter(Number.isFinite);
  const sigValid = exponentialMovingAverage(valid,9);
  const signalLine = Array(macdLine.length).fill(null);
  let offset=0;
  for(let i=0;i<macdLine.length;i++){ if(Number.isFinite(macdLine[i])) signalLine[i]=sigValid[offset++]??null; }
  const i=closes.length-1;
  const macd=macdLine[i], signal=signalLine[i];
  const histogram=Number.isFinite(macd)&&Number.isFinite(signal)?macd-signal:NaN;
  const prev=i>0&&Number.isFinite(macdLine[i-1])&&Number.isFinite(signalLine[i-1])?macdLine[i-1]-signalLine[i-1]:NaN;
  return {macd,signal,histogram,bullish:Number.isFinite(macd)&&Number.isFinite(signal)&&macd>signal,improving:Number.isFinite(histogram)&&Number.isFinite(prev)&&histogram>prev};
}

function atrContext(rows, period=14) {
  if(rows.length<period+1)return{atr:NaN,percent:NaN};
  const tr=[];
  for(let i=1;i<rows.length;i++){
    tr.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));
  }
  const atr=average(tr.slice(-period)), price=rows.at(-1).close;
  return{atr,percent:price?atr/price*100:NaN};
}

function scoreTrend(price,e20,e50,e200){
  let score=0;
  if(price>e20)score+=25;
  if(e20>e50)score+=30;
  if(e50>e200)score+=35;
  if(price>e200)score+=10;
  return clamp(score,0,100);
}

function scoreMomentum(rsiValue,macd,bollinger){
  let score=rsiValue>=40&&rsiValue<=65?30:rsiValue<40?25:10;
  if(macd.bullish)score+=30;
  if(macd.improving)score+=20;
  score+=clamp((100-bollinger.position)*0.2,0,20);
  return clamp(score,0,100);
}

function calculateCrv(current,target,support,atr){
  const atrStop=Number.isFinite(atr)?current-1.5*atr:NaN;
  const stop=Number.isFinite(support)&&Number.isFinite(atrStop)?Math.max(support,atrStop):Number.isFinite(support)?support:atrStop;
  const reward=target-current,risk=current-stop;
  return{crv:reward>0&&risk>0?reward/risk:NaN,target,stop,reward,risk};
}

function scoreRisk(atrPercent,crv){
  const vol=!Number.isFinite(atrPercent)?50:atrPercent<=2?90:atrPercent<=4?70:atrPercent<=6?50:25;
  const ratio=!Number.isFinite(crv)?40:crv>=3?100:crv>=2?80:crv>=1.5?60:crv>=1?35:10;
  return vol*0.45+ratio*0.55;
}

function relativePerformance(assetRows,benchmarkRows,days=63){
  const asset=assetRows.slice(-days),benchmark=benchmarkRows.slice(-days);
  if(asset.length<2||benchmark.length<2)return{assetReturn:NaN,benchmarkReturn:NaN,relative:NaN};
  const assetReturn=(asset.at(-1).close/asset[0].close-1)*100;
  const benchmarkReturn=(benchmark.at(-1).close/benchmark[0].close-1)*100;
  return{assetReturn,benchmarkReturn,relative:assetReturn-benchmarkReturn};
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

async function fetchMarketData(symbol, interval, mode = "full") {
  const url = new URL("/.netlify/functions/market-data", window.location.origin);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("mode", mode);

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
  currentRunCredits += Number(data?.cacheInfo?.creditsUsed || 0);
  return data;
}

async function analyzeSymbol(symbol, settings, benchmarkDaily = null, sectorDaily = null) {
  const marketData = await fetchMarketData(symbol, settings.interval);
  const intradayData = marketData.intraday;
  const dailyData = marketData.daily;
  const resolvedSymbol = marketData.resolvedSymbol || symbol;
  const resolvedExchange = marketData.resolvedExchange || "";
  const tradingViewSymbol = marketData.tradingViewSymbol || symbol;
  const companyName = marketData.companyName || marketData.intraday?.meta?.name || marketData.daily?.meta?.name || resolvedSymbol;
  const exchangeForCurrency = String(marketData.resolvedExchange || marketData.intraday?.meta?.exchange || marketData.daily?.meta?.exchange || "").toUpperCase();
  const inferredCurrency = ["NASDAQ","NYSE","AMEX","NYSE ARCA"].includes(exchangeForCurrency) ? "USD"
    : ["XETRA","GETTEX","FWB","TRADEGATE"].includes(exchangeForCurrency) ? "EUR"
    : "";
  const currency = String(marketData.currency || marketData.intraday?.meta?.currency || marketData.daily?.meta?.currency || inferredCurrency).toUpperCase();
  const eurRate = Number(marketData.eurRate);

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
  const backendPrice = Number(marketData.price);
  const currentPrice = Number.isFinite(backendPrice) && backendPrice > 0 ? backendPrice : latest.close;
  const threeMonths = daily.slice(-63);
  const oneYear = daily.slice(-252);
  const dailyCloses = daily.map(row=>row.close);
  const ema20 = exponentialMovingAverage(dailyCloses,20).at(-1);
  const ema50 = exponentialMovingAverage(dailyCloses,50).at(-1);
  const ema200 = exponentialMovingAverage(dailyCloses,200).at(-1);
  const macd = macdContext(dailyCloses);
  const bollinger = bollingerContext(dailyCloses);
  const atr = atrContext(daily);

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
  const upsidePotential = Math.max((threeMonthHigh / latest.close - 1) * 100, 0);
  const downsidePotential = Math.max((1 - threeMonthLow / latest.close) * 100, 0);
  const crvData = calculateCrv(latest.close, threeMonthHigh, fibonacci.nextLowerPrice, atr.atr);
  const displayCrvData = calculateCrv(currentPrice, threeMonthHigh, fibonacci.nextLowerPrice, atr.atr);
  const trendScore = scoreTrend(latest.close, ema20, ema50, ema200);
  const momentumScore = scoreMomentum(currentRsi, macd, bollinger);
  const riskScore = scoreRisk(atr.percent, crvData.crv);
  const chanceScore = clamp((Math.min(upsidePotential,30)/30)*50 + (Number.isFinite(crvData.crv)?Math.min(crvData.crv,3)/3*35:0) + (100-threeMonthPosition)*0.15,0,100);

  const priceFibBuy = buyPriceScore(threeMonthPosition)*0.50 + buyPriceScore(oneYearPosition)*0.20 + fibonacci.buyScore*0.30;
  const priceFibSell = sellPriceScore(threeMonthPosition)*0.50 + sellPriceScore(oneYearPosition)*0.20 + fibonacci.sellScore*0.30;

  // Trend-Trader-Profil:
  // Trend 30 %, Preis/Fibonacci 25 %, Momentum 20 %, Volumen 15 %, RSI 10 %
  const buyScore =
    trendScore * 0.30 +
    priceFibBuy * 0.25 +
    momentumScore * 0.20 +
    volume.score * 0.15 +
    buyRsiScore(currentRsi) * 0.10;

  const sellScore =
    (100 - trendScore) * 0.30 +
    priceFibSell * 0.25 +
    (100 - momentumScore) * 0.20 +
    volume.score * 0.15 +
    sellRsiScore(currentRsi) * 0.10;

  const directionAgreement = buyScore >= sellScore
    ? (currentRsi > currentRsiAverage && macd.bullish ? 100 : currentRsi > currentRsiAverage || macd.bullish ? 70 : 35)
    : (currentRsi < currentRsiAverage && !macd.bullish ? 100 : currentRsi < currentRsiAverage || !macd.bullish ? 70 : 35);
  const confidence = volume.score*0.35 + directionAgreement*0.35 + riskScore*0.30;

  const buyPotentialScore = clamp((upsidePotential / 10) * 100, 0, 100);
  const sellPotentialScore = clamp((downsidePotential / 10) * 100, 0, 100);
  const buyRank = buyScore * 0.75 + buyPotentialScore * 0.25;
  const sellRank = sellScore * 0.75 + sellPotentialScore * 0.25;

  let kind = "neutral";
  let label = "NEUTRAL";
  if (buyScore >= settings.buyThreshold && upsidePotential >= settings.minimumPotential && buyScore >= sellScore) {
    kind = "buy";
    label = "KAUFCHANCE";
  } else if (buyScore >= 60 && upsidePotential >= Math.min(3, settings.minimumPotential) && buyScore >= sellScore) {
    kind = "watch";
    label = "KAUF PRÜFEN";
  } else if (sellScore >= settings.sellThreshold && sellScore > buyScore) {
    kind = "sell";
    label = "VERKAUFSRISIKO";
  } else if (sellScore >= 60 && sellScore > buyScore) {
    kind = "watch";
    label = "GEWINNMITNAHME PRÜFEN";
  }

  const marketRelative = benchmarkDaily ? relativePerformance(daily, benchmarkDaily) : {benchmarkReturn:NaN,relative:NaN};
  const sectorRelative = sectorDaily ? relativePerformance(daily, sectorDaily) : {benchmarkReturn:NaN,relative:NaN};

  return {
    symbol,
    resolvedSymbol,
    resolvedExchange,
    tradingViewSymbol,
    companyName,
    currency,
    eurRate,
    kind,
    label,
    price: currentPrice,
    priceSource: marketData.priceSource || "unknown",
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
    ema20, ema50, ema200,
    macdValue: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    macdBullish: macd.bullish,
    bollingerUpper: bollinger.upper,
    bollingerMiddle: bollinger.middle,
    bollingerLower: bollinger.lower,
    bollingerPosition: bollinger.position,
    atr: atr.atr,
    atrPercent: atr.percent,
    crv: displayCrvData.crv,
    crvTarget: displayCrvData.target,
    crvStop: displayCrvData.stop,
    trendScore,
    momentumScore,
    riskScore,
    chanceScore,
    marketReturn: marketRelative.benchmarkReturn,
    relativeStrengthMarket: marketRelative.relative,
    sectorReturn: sectorRelative.benchmarkReturn,
    relativeStrengthSector: sectorRelative.relative,
    rank: Math.max(buyRank, sellRank),
    error: null
  };
}

function formatNumber(value, decimals = 1) {
  return Number.isFinite(value)
    ? value.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : "–";
}





function entryScoreLabel(score) {
  if (!Number.isFinite(score)) return "Nicht bewertbar";
  if (score >= 76) return "Sehr attraktiv";
  if (score >= 51) return "Interessant";
  if (score >= 26) return "Abwarten";
  return "Eher ungünstig";
}

function exitScoreLabel(score) {
  if (!Number.isFinite(score)) return "Nicht bewertbar";
  if (score >= 76) return "Hohes Verkaufsrisiko";
  if (score >= 51) return "Gewinnmitnahme prüfen";
  if (score >= 26) return "Beobachten";
  return "Geringer Verkaufsdruck";
}

function valuationScore(item) {
  const pricePosition = 100 - (item.threeMonthPosition * 0.7 + item.oneYearPosition * 0.3);
  const fibSupport = Number.isFinite(item.fibonacciBuyScore) ? item.fibonacciBuyScore : 50;
  return clamp(pricePosition * 0.7 + fibSupport * 0.3, 0, 100);
}

function scoreExplanation(item) {
  const valuation = valuationScore(item);
  const score = item.kind === "sell" ? item.sellScore : item.buyScore;
  const label = item.kind === "sell" ? exitScoreLabel(score) : entryScoreLabel(score);

  const strongest = [
    { name: "Trend", value: item.trendScore },
    { name: "Schwung", value: item.momentumScore },
    { name: "Bewertung", value: valuation },
    { name: "Chance", value: item.chanceScore }
  ].filter(part => Number.isFinite(part.value)).sort((a,b) => b.value - a.value)[0];

  const weakest = [
    { name: "Trend", value: item.trendScore },
    { name: "Schwung", value: item.momentumScore },
    { name: "Bewertung", value: valuation },
    { name: "Chance", value: item.chanceScore }
  ].filter(part => Number.isFinite(part.value)).sort((a,b) => a.value - b.value)[0];

  return {
    valuation,
    label,
    text: strongest && weakest
      ? `${strongest.name} stützt die Bewertung am stärksten. ${weakest.name} bremst sie aktuell am meisten.`
      : "Die Bewertung ergibt sich aus mehreren technischen Teilwerten."
  };
}

function scoreWord(score) {
  if (!Number.isFinite(score)) return "Unbekannt";
  if (score >= 80) return "Sehr stark";
  if (score >= 65) return "Stark";
  if (score >= 50) return "Ausgeglichen";
  if (score >= 35) return "Schwach";
  return "Sehr schwach";
}

function scoreClass(score) {
  if (!Number.isFinite(score)) return "tone-neutral";
  if (score >= 65) return "tone-positive";
  if (score >= 45) return "tone-caution";
  return "tone-negative";
}

function crvAssessment(crv) {
  if (!Number.isFinite(crv)) return { label: "nicht berechenbar", className: "tone-neutral" };
  if (crv >= 3) return { label: "sehr attraktiv", className: "tone-positive" };
  if (crv >= 2) return { label: "gut", className: "tone-positive" };
  if (crv >= 1.5) return { label: "brauchbar", className: "tone-caution" };
  if (crv >= 1) return { label: "knapp", className: "tone-caution" };
  return { label: "ungünstig", className: "tone-negative" };
}

function relativeMarketText(value) {
  if (!Number.isFinite(value)) return "Kein Marktvergleich verfügbar";
  if (value >= 5) return `${formatNumber(value, 1)} Prozentpunkte besser als der Markt`;
  if (value >= 0) return `${formatNumber(value, 1)} Prozentpunkte leicht besser als der Markt`;
  if (value > -5) return `${formatNumber(Math.abs(value), 1)} Prozentpunkte leicht schwächer als der Markt`;
  return `${formatNumber(Math.abs(value), 1)} Prozentpunkte schwächer als der Markt`;
}

function buildBeginnerSummary(item) {
  if (item.error) {
    return {
      headline: "Diese Aktie konnte nicht ausgewertet werden.",
      text: item.error,
      positives: [],
      cautions: []
    };
  }

  const positives = [];
  const cautions = [];

  if (item.trendScore >= 65) positives.push("Der mittelfristige Trend ist stabil.");
  else if (item.trendScore < 40) cautions.push("Der Trend ist aktuell eher schwach.");

  if (item.momentumScore >= 65) positives.push("Der Kursschwung entwickelt sich positiv.");
  else if (item.momentumScore < 40) cautions.push("Der Kursschwung liefert noch wenig Unterstützung.");

  if (item.crv >= 2) positives.push(`Das Chancen-Risiko-Verhältnis ist mit ${formatNumber(item.crv, 2)} : 1 attraktiv.`);
  else if (Number.isFinite(item.crv) && item.crv < 1.5) cautions.push(`Das Chancen-Risiko-Verhältnis ist mit ${formatNumber(item.crv, 2)} : 1 eher schwach.`);

  if (item.rsi < 35) positives.push("Der RSI liegt weit unten und kann eine Gegenbewegung begünstigen.");
  else if (item.rsi > 70) cautions.push("Der RSI liegt hoch; kurzfristige Rücksetzer sind eher möglich.");

  if (item.volumeRatio >= 1.2) positives.push("Das Handelsvolumen bestätigt die Bewegung.");
  else if (Number.isFinite(item.volumeRatio) && item.volumeRatio < 0.7) cautions.push("Das Handelsvolumen ist sehr niedrig; das Signal ist weniger überzeugend.");

  if (item.relativeStrengthMarket >= 0) positives.push("Die Aktie hält sich mindestens so gut wie der Markt.");
  else if (item.relativeStrengthMarket <= -5) cautions.push("Die Aktie entwickelt sich deutlich schwächer als der Markt.");

  let headline;
  if (item.kind === "buy") headline = "Mehrere Signale sprechen für einen möglichen Einstieg.";
  else if (item.kind === "sell") headline = "Mehrere Signale sprechen für erhöhte Vorsicht oder einen möglichen Ausstieg.";
  else headline = "Die Aktie ist interessant, aber das Signal ist noch nicht eindeutig.";

  const text = positives.length || cautions.length
    ? "Die wichtigsten Gründe sind unten zusammengefasst."
    : "Für eine klare Einordnung fehlen derzeit ausreichend starke Signale.";

  return { headline, text, positives: positives.slice(0, 3), cautions: cautions.slice(0, 3) };
}

function beginnerMetric(title, score, explanation) {
  return `
    <div class="beginner-metric ${scoreClass(score)}">
      <div class="beginner-metric-top">
        <span>${title}</span>
        <strong>${scoreWord(score)}</strong>
      </div>
      <div class="mini-progress"><i style="width:${clamp(score, 0, 100)}%"></i></div>
      <small>${explanation}</small>
    </div>`;
}


function detectedCurrency(item) {
  const explicit = String(item.currency || "").toUpperCase();
  if (explicit) return explicit;

  const exchange = String(item.resolvedExchange || "").toUpperCase();
  if (["NASDAQ", "NYSE", "AMEX", "NYSE ARCA"].some(value => exchange.includes(value))) return "USD";
  if (["XETRA", "XETR", "GETTEX", "FWB", "TRADEGATE"].some(value => exchange.includes(value))) return "EUR";
  if (exchange.includes("ASX")) return "AUD";
  return "";
}

function euroValue(item, amount) {
  if (!Number.isFinite(amount)) return "–";

  const currency = detectedCurrency(item);
  if (currency === "EUR") return formatNumber(amount, 2) + " €";

  const rate = Number(item.eurRate);
  if (Number.isFinite(rate) && rate > 0) {
    return formatNumber(amount * rate, 2) + " €";
  }

  return "–";
}

function euroLine(item, amount) {
  const converted = euroValue(item, amount);
  return converted === "–" ? "" : `<small class="eur-conversion">≈ ${converted}</small>`;
}


function originalCurrencyText(item, amount) {
  if (!Number.isFinite(amount)) return "";
  const currency = detectedCurrency(item);
  if (!currency || currency === "EUR") return "";
  return `${formatNumber(amount, 2)} ${currency}`;
}

function primaryPriceHtml(item, amount) {
  const euro = euroValue(item, amount);
  const original = originalCurrencyText(item, amount);

  if (euro !== "–") {
    return `
      <span class="market-price-block">
        <strong class="market-price-main">${euro}</strong>
        ${original ? `<small class="market-price-original">${original}</small>` : ""}
      </span>
    `;
  }

  const currency = detectedCurrency(item);
  return `
    <span class="market-price-block">
      <strong class="market-price-main">${formatNumber(amount, 2)}${currency ? ` ${currency}` : ""}</strong>
      ${currency && currency !== "EUR"
        ? `<small class="fx-unavailable">Euro-Umrechnung derzeit nicht verfügbar</small>`
        : ""}
    </span>
  `;
}

function profitLossExample(item, investmentAmount) {
  if (!Number.isFinite(item.price) || item.price <= 0 || !Number.isFinite(investmentAmount) || investmentAmount <= 0) {
    return { gain: NaN, loss: NaN };
  }
  const targetPct = Number.isFinite(item.crvTarget) ? (item.crvTarget / item.price - 1) : NaN;
  const stopPct = Number.isFinite(item.crvStop) ? (item.crvStop / item.price - 1) : NaN;
  return {
    gain: Number.isFinite(targetPct) ? investmentAmount * targetPct : NaN,
    loss: Number.isFinite(stopPct) ? investmentAmount * stopPct : NaN
  };
}

function scoreBand(score) {
  if (score >= 76) return { cls: "band-great", label: "Sehr attraktiv", range: "76–100" };
  if (score >= 51) return { cls: "band-good", label: "Interessant", range: "51–75" };
  if (score >= 26) return { cls: "band-wait", label: "Abwarten", range: "26–50" };
  return { cls: "band-bad", label: "Eher ungünstig", range: "0–25" };
}


const COLLAPSED_CARDS_KEY = "foxFriendsCollapsedCards";

function getCollapsedCards() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_CARDS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function isCardCollapsed(symbol) {
  return getCollapsedCards().has(String(symbol || "").toUpperCase());
}

function setCardCollapsed(symbol, collapsed) {
  const cards = getCollapsedCards();
  const key = String(symbol || "").toUpperCase();
  if (collapsed) cards.add(key);
  else cards.delete(key);
  localStorage.setItem(COLLAPSED_CARDS_KEY, JSON.stringify([...cards]));
}

function cardHtml(item) {
  const mainScore = item.kind === "sell" ? item.sellScore : item.buyScore;
  const mainLabel = item.kind === "sell" ? "Ausstiegsscore" : "Einstiegsscore";
  const summary = buildBeginnerSummary(item);
  const crv = crvAssessment(item.crv);

  const positiveList = summary.positives.length
    ? `<div class="reason-group positive-reasons"><h4>Was dafür spricht</h4>${summary.positives.map(text => `<div>✓ ${text}</div>`).join("")}</div>`
    : "";

  const cautionList = summary.cautions.length
    ? `<div class="reason-group caution-reasons"><h4>Worauf du achten solltest</h4>${summary.cautions.map(text => `<div>⚠ ${text}</div>`).join("")}</div>`
    : "";

  return `
    <article class="signal-card ${item.kind} ${isCardCollapsed(item.symbol) ? "collapsed" : ""}" data-card-symbol="${item.symbol}">
      <div class="signal-card-header">
        <div class="card-identity">
          <div class="symbol">${item.symbol}</div>
          <div class="company-line">${item.companyName || item.symbol}${item.resolvedExchange ? ` · ${item.resolvedExchange}` : ""}</div>
          <div class="price header-price">
            ${primaryPriceHtml(item, item.price)}
          </div>
        </div>
        <div class="card-header-actions">
          <span class="signal-pill ${item.kind}">${item.label}</span>
          <button class="card-collapse-button" type="button" aria-label="${isCardCollapsed(item.symbol) ? "Aktienkarte ausklappen" : "Aktienkarte einklappen"}">${isCardCollapsed(item.symbol) ? "⌄" : "⌃"}</button>
        </div>
      </div>

      <div class="card-collapsible">
      ${(() => {
        const scoreInfo = scoreExplanation(item);
        const band = scoreBand(mainScore);
        return `
      <section class="verdict-panel ${item.kind}">
        <div class="verdict-score-block">
          <div class="score-with-help">
            <div class="verdict-score">
              <strong>${formatNumber(mainScore, 0)}</strong>
              <span>/100</span>
            </div>
            <button type="button" class="score-popover-button" aria-label="Score-Skala anzeigen">?</button>
          </div>
          <span class="score-meaning ${band.cls}">${band.label}</span>

          <div class="score-popover">
            ${[
              {range:"0–25",label:"Eher ungünstig",cls:"band-bad"},
              {range:"26–50",label:"Abwarten",cls:"band-wait"},
              {range:"51–75",label:"Interessant",cls:"band-good"},
              {range:"76–100",label:"Sehr attraktiv",cls:"band-great"}
            ].map(row => `<div class="${row.cls} ${row.range===band.range ? "active" : ""}"><span>${row.range}</span><strong>${row.label}</strong></div>`).join("")}
          </div>
        </div>

        <div class="verdict-copy">
          <span class="verdict-kicker">${mainLabel}</span>
          <h3>${summary.headline}</h3>
          <p>${scoreInfo.text}</p>
        </div>
      </section>

      <section class="score-explainer">
        <div class="score-explainer-header">
          <div>
            <span>So setzt sich der Score zusammen</span>
            <strong>Je höher, desto positiver für einen Einstieg</strong>
          </div>
        </div>

        <div class="score-breakdown">
          ${beginnerMetric("Trend", item.trendScore, "Sind kurz-, mittel- und langfristiger Trend positiv?")}
          ${beginnerMetric("Schwung", item.momentumScore, "Unterstützen RSI, MACD und Bollinger die Bewegung?")}
          ${beginnerMetric("Bewertung", scoreInfo.valuation, "Liegt der Kurs eher günstig in seiner 3-Monats- und Jahresspanne?")}
          ${beginnerMetric("Chance", item.chanceScore, "Wie viel technischer Spielraum ist nach oben vorhanden?")}
        </div>
      </section>`;
      })()}

      <div class="confidence-row">
        <span>Signal-Vertrauen</span>
        <strong>${formatNumber(item.confidence, 0)} % · ${scoreWord(item.confidence)}</strong>
      </div>
      <div class="progress confidence-progress"><i style="width:${clamp(item.confidence, 0, 100)}%"></i></div>

      <section class="beginner-section compact-overview">
        <h3>Zusätzliche Einordnung</h3>
        <div class="beginner-grid">
          ${beginnerMetric("Sicherheit", item.riskScore, "Je höher, desto günstiger wirken Volatilität und Chancen-Risiko-Verhältnis.")}
          ${beginnerMetric("Signal-Vertrauen", item.confidence, "Je höher, desto besser bestätigen sich die Indikatoren gegenseitig.")}
        </div>
      </section>

      <section class="reason-layout">
        ${positiveList}
        ${cautionList}
      </section>

      ${(() => {
        const amount = Number(byId("investmentAmount")?.value || 1000);
        const example = profitLossExample(item, amount);
        const displayCurrency = detectedCurrency(item);
        const symbolCurrency = displayCurrency ? ` ${displayCurrency}` : "";
        return `
      <section class="trade-plan">
        <div class="trade-plan-header">
          <div>
            <span>Chancen-Risiko-Verhältnis</span>
            <strong class="${crv.className}">${formatNumber(item.crv, 2)} : 1 · ${crv.label}</strong>
          </div>
          <div class="market-comparison ${item.relativeStrengthMarket >= 0 ? "positive" : "negative"}">
            ${relativeMarketText(item.relativeStrengthMarket)}
          </div>
        </div>

        <div class="trade-plan-grid">
          <div>
            <span>Aktueller Kurs</span>
            ${primaryPriceHtml(item, item.price)}
          </div>
          <div>
            <span>Mögliches Ziel</span>
            ${primaryPriceHtml(item, item.crvTarget)}
          </div>
          <div>
            <span>Rechnerischer Stopp</span>
            ${primaryPriceHtml(item, item.crvStop)}
          </div>
          <div>
            <span>Potenzial zum 3M-Hoch</span>
            <strong>+${formatNumber(item.upsidePotential, 1)} %</strong>
          </div>
        </div>

        <div class="example-calculator">
          <div>
            <span>Beispiel bei ${formatNumber(amount, 0)} € Einsatz</span>
            <small>Rein rechnerisch anhand von Ziel und Stopp</small>
          </div>
          <div class="example-gain">
            <span>Möglicher Gewinn</span>
            <strong>${Number.isFinite(example.gain) ? "+" + formatNumber(example.gain, 2) + " €" : "–"}</strong>
          </div>
          <div class="example-loss">
            <span>Möglicher Verlust</span>
            <strong>${Number.isFinite(example.loss) ? formatNumber(example.loss, 2) + " €" : "–"}</strong>
          </div>
        </div>

        <small class="trade-plan-note">Ziel, Stopp und Euro-Umrechnung sind technische Näherungen – keine Garantie und keine Kaufempfehlung.</small>
      </section>`;
      })()}
      </div>

      <details class="indicator-details">
        <summary>
          <span>Technische Details anzeigen</span>
          <small>Für eine genauere Prüfung</small>
        </summary>

        <div class="technical-explainer">
          <div class="tech-card">
            <span>RSI</span>
            <strong>${formatNumber(item.rsi, 1)}</strong>
            <small>${item.rsi < 30 ? "Weit unten – mögliche Gegenbewegung." : item.rsi > 70 ? "Weit oben – Rücksetzer möglich." : "Neutraler Bereich."}</small>
          </div>
          <div class="tech-card">
            <span>RSI-Durchschnitt</span>
            <strong>${formatNumber(item.rsiAverage, 1)}</strong>
            <small>${item.rsi > item.rsiAverage ? "Lila liegt über Gelb – eher positiv." : "Lila liegt unter Gelb – eher vorsichtig."}</small>
          </div>
          <div class="tech-card">
            <span>3-Monats-Lage</span>
            <strong>${formatNumber(item.threeMonthPosition, 0)} %</strong>
            <small>${item.threeMonthPosition <= 33 ? "Im unteren Drittel der Spanne." : item.threeMonthPosition >= 67 ? "Im oberen Drittel der Spanne." : "Im mittleren Drittel."}</small>
          </div>
          <div class="tech-card">
            <span>Jahreslage</span>
            <strong>${formatNumber(item.oneYearPosition, 0)} %</strong>
            <small>Langfristige Einordnung zwischen Jahrestief und Jahreshoch.</small>
          </div>
          <div class="tech-card">
            <span>Volumen</span>
            <strong>${Number.isFinite(item.volumeRatio) ? `${formatNumber(item.volumeRatio * 100, 0)} %` : "–"}</strong>
            <small>Vergleich zum durchschnittlichen Handelsvolumen der letzten 20 Tage.</small>
          </div>
          <div class="tech-card">
            <span>Fibonacci-Zone</span>
            <strong>${formatNumber(item.fibonacciRatio * 100, 1)} %</strong>
            <small>Mögliche technische Unterstützungs- oder Widerstandszone.</small>
          </div>
        </div>

        <div class="indicator-list">
          <div><span>EMA 20 / 50 / 200</span><strong>${formatNumber(item.ema20,2)} / ${formatNumber(item.ema50,2)} / ${formatNumber(item.ema200,2)}</strong></div>
          <div><span>MACD / Signallinie</span><strong>${formatNumber(item.macdValue,3)} / ${formatNumber(item.macdSignal,3)}</strong></div>
          <div><span>Bollinger-Position</span><strong>${formatNumber(item.bollingerPosition,0)} %</strong></div>
          <div><span>ATR / Volatilität</span><strong>${formatNumber(item.atrPercent,1)} %</strong></div>
          <div><span>Relativ zum Markt</span><strong>${Number.isFinite(item.relativeStrengthMarket)?(item.relativeStrengthMarket>=0?"+":"")+formatNumber(item.relativeStrengthMarket,1)+" %-Pkt.":"–"}</strong></div>
          <div><span>Relativ zum Sektor</span><strong>${Number.isFinite(item.relativeStrengthSector)?(item.relativeStrengthSector>=0?"+":"")+formatNumber(item.relativeStrengthSector,1)+" %-Pkt.":"–"}</strong></div>
        </div>
      </details>

      <div class="card-actions">
        <button class="chart-button" data-chart="${item.symbol}" data-tv-symbol="${item.tradingViewSymbol || ""}">
          TradingView-Chart öffnen
        </button>
      </div>
      </div>
    </article>`;
}


function resultKey(item) {
  return String(item?.symbol || item?.requestedSymbol || item?.resolvedSymbol || "")
    .trim()
    .toUpperCase();
}


function dedupeResults(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = resultKey(item);
    if (!key) continue;
    map.set(key, item); // letzter Stand gewinnt
  }
  return [...map.values()];
}

function upsertResult(item) {
  const key = resultKey(item);
  results = dedupeResults([
    ...results.filter(existing => resultKey(existing) !== key),
    item
  ]);
}

function render() {
  results = dedupeResults(results);
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


async function runControl(action = "status", owner = "") {
  const response = await fetch("/.netlify/functions/run-control", {
    method: action === "status" ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: action === "status" ? undefined : JSON.stringify({ action, owner })
  });
  const data = await response.json();
  if (!response.ok || data.status === "error") {
    throw new Error(data.message || "Prüfstatus konnte nicht geladen werden.");
  }
  return data.run || null;
}

function setRunBadge(run) {
  const badge = byId("runBadge");
  if (!badge) return;
  if (run?.running) {
    badge.className = "run-badge running";
    badge.textContent = `Läuft · ${run.owner || "Automatik"}`;
  } else {
    badge.className = "run-badge idle";
    badge.textContent = "Bereit";
  }
}

function berlinParts(date) {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function nextAutomaticRun(now = new Date()) {
  const start = new Date(now.getTime() + 60_000);
  start.setUTCSeconds(0, 0);

  // Auf das nächste Viertelstunden-Raster springen.
  const minute = start.getUTCMinutes();
  const add = (15 - (minute % 15)) % 15;
  start.setUTCMinutes(minute + add);

  // Bis zu 10 Tage suchen; Europe/Berlin berücksichtigt Sommer-/Winterzeit.
  for (let i = 0; i < 24 * 4 * 10; i++) {
    const candidate = new Date(start.getTime() + i * 15 * 60_000);
    const p = berlinParts(candidate);
    const weekend = p.weekday === "Sa" || p.weekday === "So";
    const total = Number(p.hour) * 60 + Number(p.minute);

    if (!weekend && total >= (15 * 60 + 30) && total <= (22 * 60) && Number(p.minute) % 15 === 0) {
      return candidate;
    }
  }
  return null;
}

function updateScheduleCountdown() {
  const target = nextAutomaticRun();
  const element = byId("scheduleCountdown");
  if (!element) return;
  if (!target) {
    const next = byId("scheduleNext");
    if (next) next.textContent = "Nächster Lauf konnte nicht berechnet werden";
    element.textContent = "Bitte Seite neu laden";
    return;
  }
  const milliseconds = Math.max(target - new Date(), 0);
  const totalMinutes = Math.ceil(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const targetText = target.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short", hour: "2-digit", minute: "2-digit"
  });
  const next = byId("scheduleNext");
  if (next) next.textContent = `Nächster Lauf: ${targetText}`;
  element.textContent = hours > 0
    ? `Countdown: ${hours} Std. ${minutes} Min.`
    : `Countdown: ${minutes} Min.`;
}

async function pollSharedState() {
  updateScheduleCountdown();
  try {
    const run = await runControl("status");
    setRunBadge(run);
    if (!run?.running && !analysisInProgress) {
      // Nur den gespeicherten gemeinsamen Stand laden – keine Twelve-Data-Credits.
      // Während einer lokalen Prüfung niemals fremde Ergebnisse hineinmischen.
      await loadSharedDashboard();
    }
  } catch (error) {
    console.warn(error);
  }
}

function setSharedStatus(text) {
  byId("sharedStatus").textContent = text;
}

function sharedDateText(value) {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unbekannt" : date.toLocaleString("de-DE");
}

async function fetchSharedDashboard() {
  const response = await fetch("/.netlify/functions/shared-dashboard", {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store"
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Gemeinsamer Speicher lieferte keine JSON-Antwort (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!response.ok || data.status === "error") {
    throw new Error(data.message || "Gemeinsamer Stand konnte nicht geladen werden.");
  }
  return data.dashboard || null;
}

async function saveSharedDashboard(settings) {
  const response = await fetch("/.netlify/functions/shared-dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      updatedBy: settings.displayName,
      symbols: settings.symbols,
      interval: settings.interval,
      marketBenchmark: settings.marketBenchmark,
      sectorBenchmark: settings.sectorBenchmark,
      rsiLength: settings.rsiLength,
      rsiMaLength: settings.rsiMaLength,
      buyThreshold: settings.buyThreshold,
      sellThreshold: settings.sellThreshold,
      minimumPotential: settings.minimumPotential,
      crossLookback: settings.crossLookback,
      investmentAmount: settings.investmentAmount,
      runCredits: currentRunCredits,
      results
    })
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Gemeinsamer Speicher lieferte keine JSON-Antwort (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!response.ok || data.status === "error") {
    throw new Error(data.message || "Ergebnisse konnten nicht gemeinsam gespeichert werden.");
  }
  return data.dashboard;
}

async function loadSharedDashboard() {
  try {
    setSharedStatus("Gemeinsamer Stand wird geladen …");
    const dashboard = await fetchSharedDashboard();

    if (!dashboard) {
      setSharedStatus("Noch kein gemeinsamer Prüfstand vorhanden.");
      return;
    }

    if (Array.isArray(dashboard.symbols) && dashboard.symbols.length) {
      byId("symbols").value = dashboard.symbols.join("\n");
    }

    if (dashboard.interval && [...byId("interval").options].some(option => option.value === dashboard.interval)) {
      byId("interval").value = dashboard.interval;
    }

    const sharedSettings = ["marketBenchmark","sectorBenchmark","investmentAmount","rsiLength","rsiMaLength","buyThreshold","sellThreshold","minimumPotential","crossLookback"];
    for (const key of sharedSettings) {
      if (dashboard[key] !== undefined && byId(key)) byId(key).value = dashboard[key];
    }
    if ((!dashboard.sectorBenchmark || !String(dashboard.sectorBenchmark).trim()) &&
        Array.isArray(dashboard.symbols) &&
        dashboard.symbols.map(v => String(v).toUpperCase()).includes("INTC")) {
      byId("sectorBenchmark").value = "SOXX";
    }

    if (Array.isArray(dashboard.results)) {
      results = dedupeResults(dashboard.results);
      render();
    }

    setSharedStatus(`Gemeinsamer Stand: ${sharedDateText(dashboard.updatedAt)} · erstellt von ${dashboard.updatedBy || "Unbekannt"}`);
    if (byId("apiUsageInfo")) byId("apiUsageInfo").textContent = `API heute: ${Number(dashboard.apiCreditsToday || 0)} Credits`;
    setStatus("Gespeicherte Ergebnisse geladen – keine Twelve-Data-Credits verbraucht.");
  } catch (error) {
    setSharedStatus(`Gemeinsamer Stand nicht verfügbar: ${error.message}`);
  }
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

async function analyzeWithRetry(symbol, settings, benchmarkDaily = null, sectorDaily = null) {
  let retries = 0;
  while (true) {
    try {
      return await analyzeSymbol(symbol, settings, benchmarkDaily, sectorDaily);
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
  if (analysisInProgress) {
    setStatus("Auf diesem Gerät läuft bereits eine Prüfung.");
    return;
  }

  const settings = getSettings();
  if (!settings.displayName) {
    setStatus("Bitte unter ⚙️ zuerst deinen Namen eintragen.");
    byId("settingsDialog").showModal();
    return;
  }
  if (!settings.symbols.length) {
    setStatus("Bitte mindestens eine Aktie eintragen.");
    byId("settingsDialog").showModal();
    return;
  }

  byId("refreshButton").disabled = true;

  let lockAcquired = false;
  try {
    const run = await runControl("acquire", settings.displayName);
    lockAcquired = Boolean(run?.running && run?.owner === settings.displayName);
    if (!lockAcquired) {
      setStatus(`Eine andere Prüfung läuft bereits${run?.owner ? ` – gestartet von ${run.owner}` : ""}.`);
      setRunBadge(run);
      byId("refreshButton").disabled = false;
      return;
    }
    setRunBadge(run);
    analysisInProgress = true;
  } catch (error) {
    setStatus(`Prüfung konnte nicht gestartet werden: ${error.message}`);
    byId("refreshButton").disabled = false;
    return;
  }

  currentRunCredits = 0;
  results = [];
  render();

  let benchmarkDaily = null;
  let sectorDaily = null;
  try {
    if (settings.marketBenchmark) {
      setStatus(`Lade Marktvergleich ${settings.marketBenchmark} …`);
      const marketData = await fetchMarketData(settings.marketBenchmark, settings.interval, "benchmark");
      benchmarkDaily = marketData.daily.values.map(row=>({close:Number(row.close),low:Number(row.low),high:Number(row.high),volume:Number(row.volume)}));
    }
    if (settings.sectorBenchmark) {
      setStatus(`Lade Sektorvergleich ${settings.sectorBenchmark} …`);
      const sectorData = await fetchMarketData(settings.sectorBenchmark, settings.interval, "benchmark");
      sectorDaily = sectorData.daily.values.map(row=>({close:Number(row.close),low:Number(row.low),high:Number(row.high),volume:Number(row.volume)}));
    }
  } catch (error) {
    setStatus(`Benchmark nicht verfügbar: ${error.message}. Prüfung läuft weiter.`);
  }

  // Jede Aktie benötigt zwei Abfragen. Die App arbeitet die Watchlist deshalb
  // nacheinander ab. Erfolgreiche Aktien bleiben gespeichert. Wird das Minutenlimit
  // erreicht, wartet die App und versucht ausschließlich die aktuell offene Aktie erneut.
  for (let index = 0; index < settings.symbols.length; index++) {
    const symbol = settings.symbols[index];
    setStatus(`Prüfe ${index + 1} von ${settings.symbols.length}: ${symbol} …`);

    try {
      const item = await analyzeWithRetry(symbol, settings, benchmarkDaily, sectorDaily);
      upsertResult(item);
      render();
    } catch (error) {
      upsertResult({
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

  try {
    setStatus("Prüfung abgeschlossen. Gemeinsamer Stand wird gespeichert …");
    results = dedupeResults(results);
    const shared = await saveSharedDashboard(settings);
    setSharedStatus(`Gemeinsamer Stand: ${sharedDateText(shared.updatedAt)} · erstellt von ${shared.updatedBy || settings.displayName}`);
    setStatus(`Aktualisiert und gemeinsam gespeichert: ${new Date().toLocaleString("de-DE")}`);
  } catch (error) {
    setStatus(`Berechnet, aber nicht gemeinsam gespeichert: ${error.message}`);
  } finally {
    if (lockAcquired) {
      try {
        const run = await runControl("release", settings.displayName);
        setRunBadge(run);
      } catch (error) {
        console.warn("Sperre konnte nicht gelöst werden:", error);
      }
    }
    analysisInProgress = false;
    byId("refreshButton").disabled = false;
  }
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
  byId("settingsDialog").close();
  runAnalysis();
});
byId("saveOnlyButton").addEventListener("click", () => {
  saveSettings();
  byId("settingsDialog").close();
  setStatus("Einstellungen gespeichert.");
});
byId("closeChartButton").addEventListener("click", () => byId("chartDialog").close());

loadSettings();
render();
loadSharedDashboard();
updateScheduleCountdown();
runControl("status").then(setRunBadge).catch(() => {});
setInterval(updateScheduleCountdown, 30 * 1000);
setInterval(pollSharedState, 60 * 1000);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}


/* Hilfe-Dialog */
const helpButton = document.getElementById("helpButton");
if (helpButton) {
  helpButton.addEventListener("click", () => {
    document.getElementById("helpDialog")?.showModal();
  });
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    document.getElementById(button.dataset.close)?.close();
  });
});


document.addEventListener("click", event => {
  const button = event.target.closest(".score-popover-button");
  document.querySelectorAll(".score-popover.visible").forEach(popover => {
    if (!button || !popover.closest(".verdict-score-block")?.contains(button)) popover.classList.remove("visible");
  });
  if (!button) return;
  button.closest(".verdict-score-block")?.querySelector(".score-popover")?.classList.toggle("visible");
});


document.addEventListener("click", event => {
  const button = event.target.closest(".card-collapse-button");
  if (!button) return;

  const card = button.closest(".signal-card");
  if (!card) return;

  card.classList.toggle("collapsed");
  const collapsed = card.classList.contains("collapsed");

  setCardCollapsed(card.dataset.cardSymbol, collapsed);
  button.textContent = collapsed ? "⌄" : "⌃";
  button.setAttribute("aria-label", collapsed ? "Aktienkarte ausklappen" : "Aktienkarte einklappen");
});

let macroEvents = [];
let contextNews = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function macroDateText(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Zeit unbekannt" : date.toLocaleString("de-DE", {
    timeZone:"Europe/Berlin", weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
  });
}

function newsDateText(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("de-DE", {
    timeZone:"Europe/Berlin",
    day:"2-digit",
    month:"2-digit",
    hour:"2-digit",
    minute:"2-digit"
  });
}

function macroDistance(value) {
  const minutes = Math.round((new Date(value) - new Date()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < -60) return "bereits veröffentlicht";
  if (minutes < 0) return "vor wenigen Minuten";
  if (minutes < 60) return `in ${minutes} Min.`;
  if (minutes < 1440) return `in ${Math.floor(minutes/60)} Std. ${minutes%60} Min.`;
  return `in ${Math.ceil(minutes/1440)} Tagen`;
}

function macroWarningText(event) {
  const value = `${event.event || ""} ${event.category || ""}`.toLowerCase();
  if (/interest rate|fed|fomc|ezb|ecb/.test(value)) return "Zinsentscheid kann starke marktweite Bewegungen auslösen.";
  if (/inflation|cpi|consumer price|pce/.test(value)) return "Inflationsdaten können Zins- und Aktienerwartungen deutlich verändern.";
  if (/non farm|nfp|payroll|employment|arbeitsmarkt/.test(value)) return "Arbeitsmarktdaten können den US-Markt kurzfristig stark bewegen.";
  return "Technische Signale können rund um diesen Termin kurzfristig weniger zuverlässig sein.";
}

function categoryLabel(category) {
  if (category === "stocks") return "Watchlist";
  if (category === "sector") return "Branche";
  return "Markt";
}

function renderMacroPanel() {
  const panel=byId("macroPanel"), headline=byId("macroHeadline"), detail=byId("macroDetail");
  const upcoming=macroEvents
    .filter(e=>new Date(e.date)>=new Date(Date.now()-60*60000))
    .sort((a,b)=>new Date(a.date)-new Date(b.date));
  const next=upcoming[0];

  if (next) {
    panel.className="macro-panel macro-warning";
    headline.textContent=`${next.country || ""}: ${next.event || next.category}`;
    detail.textContent=`${macroDateText(next.date)} · ${macroDistance(next.date)} · ${macroWarningText(next)}`;
    return;
  }

  if (contextNews.length) {
    const latest = contextNews[0];
    panel.className="macro-panel macro-safe";
    headline.textContent="Keine High-Impact-Termine · aktuelle Nachrichten vorhanden";
    detail.textContent=`📰 ${categoryLabel(latest.category)}: ${latest.title}`;
    return;
  }

  panel.className="macro-panel macro-safe";
  headline.textContent="Keine High-Impact-Termine in den nächsten Tagen";
  detail.textContent="Aktuell liegen keine relevanten Markt-Nachrichten aus der letzten Abfrage vor.";
}

function renderMacroDialog() {
  const eventContent = byId("macroEventsContent");
  const newsContent = byId("newsContextContent");

  if (eventContent) {
    if (!macroEvents.length) {
      eventContent.innerHTML='<div class="context-empty">✅ Keine High-Impact-Termine verfügbar.</div>';
    } else {
      eventContent.innerHTML=`<div class="macro-event-list">${macroEvents.map(event=>`
        <article>
          <div>
            <strong>${escapeHtml(event.event || event.category)}</strong>
            <span>${escapeHtml(event.country || "")} · ${escapeHtml(macroDateText(event.date))} · ${escapeHtml(macroDistance(event.date))}</span>
          </div>
          <p>${escapeHtml(macroWarningText(event))}</p>
        </article>`).join("")}</div>`;
    }
  }

  if (newsContent) {
    if (!contextNews.length) {
      newsContent.innerHTML='<div class="context-empty">Derzeit keine passenden Nachrichten gefunden.</div>';
    } else {
      newsContent.innerHTML=`<div class="news-list">${contextNews.map(item=>`
        <a class="news-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <div class="news-meta">
            <span class="news-category">${escapeHtml(categoryLabel(item.category))}</span>
            ${item.date ? `<span>${escapeHtml(newsDateText(item.date))}</span>` : ""}
            ${item.source ? `<span>${escapeHtml(item.source)}</span>` : ""}
          </div>
          <strong>${escapeHtml(item.title)}</strong>
        </a>`).join("")}</div>`;
    }
  }
}

async function loadMacroCalendar() {
  try {
    const response=await fetch("/.netlify/functions/macro-calendar",{cache:"no-store"});
    const data=await response.json();
    if (!response.ok || data.status==="error") throw new Error(data.message||"Kalender nicht verfügbar");
    macroEvents=Array.isArray(data.events)?data.events:[];
  } catch(error) {
    console.warn("Wirtschaftskalender:", error);
    macroEvents=[];
  }
  renderMacroPanel();
  renderMacroDialog();
}

async function loadNewsContext() {
  try {
    const response = await fetch("/.netlify/functions/news-context", { cache:"no-store" });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!response.ok || data.status === "error") throw new Error(data.message || "Nachrichten nicht verfügbar");
    contextNews = Array.isArray(data.news) ? data.news : [];
  } catch (error) {
    console.warn("Nachrichten-Kontext:", error);
    contextNews = [];
  }
  renderMacroPanel();
  renderMacroDialog();
}

byId("macroDetailsButton")?.addEventListener("click",()=>{
  renderMacroDialog();
  byId("macroDialog")?.showModal();
});

loadMacroCalendar();
loadNewsContext();
setInterval(loadMacroCalendar,30*60*1000);
setInterval(loadNewsContext,15*60*1000);
