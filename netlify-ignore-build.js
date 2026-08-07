"use strict";

const { execFileSync } = require("child_process");

const cached = process.env.CACHED_COMMIT_REF;
const current = process.env.COMMIT_REF;

// Wenn Netlify die Vergleichs-Refs ausnahmsweise nicht bereitstellt,
// lieber bauen als einen echten Code-Deploy zu verpassen.
if (!cached || !current) {
  console.log("[ignore-build] Git-Refs fehlen -> Build wird ausgeführt.");
  process.exit(1);
}

let files = [];
try {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", cached, current],
    { encoding: "utf8" }
  );

  files = output
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean);
} catch (error) {
  console.log("[ignore-build] Git-Diff fehlgeschlagen -> Build wird ausgeführt.");
  process.exit(1);
}

if (!files.length) {
  console.log("[ignore-build] Keine Dateiveränderungen -> Build überspringen.");
  process.exit(0);
}

// Alle Laufzeitdaten des Dashboards liegen ausschließlich unter shared/.
// Wenn zwischen dem letzten veröffentlichten Commit und dem aktuellen Commit
// NUR shared/** geändert wurde, handelt es sich um Cache/Status/Ergebnisdaten.
// Dafür darf kein neuer Netlify Production Deploy entstehen.
const runtimeOnly = files.every(file => file === "shared" || file.startsWith("shared/"));

console.log("[ignore-build] Geänderte Dateien:");
for (const file of files) console.log(` - ${file}`);

if (runtimeOnly) {
  console.log("[ignore-build] Nur Runtime-Daten unter shared/** -> Deploy wird übersprungen.");
  process.exit(0);
}

console.log("[ignore-build] Code/Konfiguration wurde geändert -> Deploy wird ausgeführt.");
process.exit(1);
