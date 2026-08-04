"use strict";

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function sameDate(date, other) {
  return date.getUTCFullYear() === other.getUTCFullYear() &&
    date.getUTCMonth() === other.getUTCMonth() &&
    date.getUTCDate() === other.getUTCDate();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function germanMarketHoliday(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const easter = easterSunday(year);
  const holidays = [
    new Date(Date.UTC(year, 0, 1)),
    addDays(easter, -2),
    addDays(easter, 1),
    new Date(Date.UTC(year, 4, 1)),
    new Date(Date.UTC(year, 11, 24)),
    new Date(Date.UTC(year, 11, 25)),
    new Date(Date.UTC(year, 11, 26)),
    new Date(Date.UTC(year, 11, 31))
  ];
  return holidays.some(value => sameDate(date, value));
}

function nthWeekday(year, month, weekday, nth) {
  const date = new Date(Date.UTC(year, month, 1));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCDate(date.getUTCDate() + (nth - 1) * 7);
  return date;
}

function lastWeekday(year, month, weekday) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  while (date.getUTCDay() !== weekday) date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

function observed(date) {
  const day = date.getUTCDay();
  if (day === 6) return addDays(date, -1);
  if (day === 0) return addDays(date, 1);
  return date;
}

function usMarketHoliday(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const easter = easterSunday(year);
  const holidays = [
    observed(new Date(Date.UTC(year, 0, 1))),
    nthWeekday(year, 0, 1, 3),
    nthWeekday(year, 1, 1, 3),
    addDays(easter, -2),
    lastWeekday(year, 4, 1),
    observed(new Date(Date.UTC(year, 5, 19))),
    observed(new Date(Date.UTC(year, 6, 4))),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4),
    observed(new Date(Date.UTC(year, 11, 25)))
  ];
  return holidays.some(value => sameDate(date, value));
}

exports.handler = async function() {
  const p = berlinParts();
  const weekend = p.weekday === "Sat" || p.weekday === "Sun";
  if (weekend) return { statusCode: 200 };

  const year = Number(p.year), month = Number(p.month), day = Number(p.day);
  const germanRun = p.hour === "09" && p.minute === "15" && !germanMarketHoliday(year, month, day);
  const usRun = p.hour === "15" && p.minute === "45" && !usMarketHoliday(year, month, day);

  if (!germanRun && !usRun) return { statusCode: 200 };

  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  await fetch(new URL("/.netlify/functions/auto-refresh-background", base), { method: "POST" });
  return { statusCode: 200 };
};
