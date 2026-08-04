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


VERSION 2.1 – AUTOMATISCHE BÖRSENAUSWAHL

- TradingView erhält kein pauschales LS:-Präfix mehr.
- Das Backend versucht Börsen in dieser Reihenfolge:
  1. NASDAQ
  2. NYSE
  3. XETRA
  4. LSE
  5. automatische Twelve-Data-Auswahl
- Der erfolgreich verwendete Handelsplatz wird an das Dashboard zurückgegeben.
- Der TradingView-Chart öffnet das aufgelöste Symbol, z. B. NASDAQ:MSFT.
- Eine explizite Eingabe bleibt möglich, z. B. XETR:RHM oder NASDAQ:MSFT.

Hinweis: Jeder fehlgeschlagene Börsenversuch kann API-Credits verbrauchen. Das Ergebnis
wird über Netlify zwischengespeichert, wodurch wiederholte identische Abrufe reduziert werden.


VERSION 2.2 – CREDIT-SAFE FIX

Problem in 2.1:
Die automatische Börsensuche konnte pro Aktie mehrere Handelsplätze testen.
Jeder Test brauchte zwei Twelve-Data-Credits. Dadurch wurde das Minutenlimit
schnell erreicht und die App wiederholte die offene Aktie immer wieder.

Lösung:
- Pro Aktie nur noch genau ein Datenversuch.
- Ohne Börsenpräfix wählt Twelve Data selbst den verfügbaren Haupttreffer.
- Aus der Antwort wird der tatsächliche Handelsplatz für TradingView übernommen.
- Explizite Eingabe bleibt möglich, z. B. NASDAQ:MSFT oder XETR:RHM.
- Beim Minutenlimit erfolgt höchstens ein automatischer Wiederholungsversuch.
  Danach erscheint ein Fehler statt einer Endlosschleife.

Empfehlung:
US-Aktien einfach als AAPL, MSFT, INTC, NVDA usw. eintragen.
Wenn eine eindeutige Börse erforderlich ist, das Präfix explizit angeben.
