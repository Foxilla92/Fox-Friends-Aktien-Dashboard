FOX & FRIENDS AKTIEN DASHBOARD – VERSION 2

DIE KORREKTE GITHUB-STRUKTUR

Direkt im Hauptverzeichnis müssen liegen:
- index.html
- app.js
- styles.css
- manifest.webmanifest
- sw.js
- netlify.toml
- README.txt

Zusätzlich muss diese Datei exakt hier liegen:
- netlify/functions/market-data.js

WICHTIG FÜR DEN UPLOAD AM HANDY

GitHub kann im mobilen Browser Ordner beim Dateiupload unpraktisch behandeln.
Lade zuerst alle Dateien aus der obersten Ebene hoch.

Danach erstellst du die Function direkt in GitHub:
1. Add file → Create new file.
2. Als Dateiname exakt eingeben:
   netlify/functions/market-data.js
3. Den Inhalt aus GITHUB_MOBILE_market-data.js.txt vollständig kopieren.
4. Commit changes.

Alternativ am PC:
Den gesamten entpackten Inhalt einschließlich des Ordners „netlify“ per Drag-and-drop
in das leere Repository ziehen.

NETLIFY

1. Das neue GitHub-Repository mit Netlify verbinden.
2. Build command leer lassen.
3. Publish directory: .
4. Functions directory: netlify/functions
5. Environment variable erstellen:
   TWELVE_DATA_API_KEY = dein Twelve-Data-Key
6. Nach dem Speichern neu deployen.

FUNKTION TESTEN

Öffne nach dem Deploy:
https://DEINE-SEITE.netlify.app/.netlify/functions/market-data

Korrekte Antwort:
{"status":"ok","message":"Fox & Friends Backend läuft.","apiKeyConfigured":true}

Erst wenn dieser Test funktioniert, im Dashboard auf „Jetzt prüfen“ tippen.

DATENQUELLE

Das Backend verwendet Twelve Data. Dein Schlüssel bleibt serverseitig verborgen.
Alle Besucher teilen jedoch die Limits deines Twelve-Data-Tarifs. Bestimmte Börsen
oder Symbole können im kostenlosen Tarif nicht verfügbar sein.

US-Aktien sollten im Dashboard grundsätzlich über ihr Hauptsymbol analysiert werden:
AAPL, INTC, NVDA, MSFT, AMD usw. Handeln kannst du dieselbe Aktie anschließend
weiterhin über Trade Republic in Euro.
