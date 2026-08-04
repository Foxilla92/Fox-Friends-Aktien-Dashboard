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


VERSION 3 – GEMEINSAMES DASHBOARD
- Beim Öffnen wird der letzte gemeinsame Stand aus Netlify Blobs geladen.
- Das Öffnen und Aktualisieren der Browserseite verbraucht keine Twelve-Data-Credits.
- Ergebnisse bleiben nach Refresh sowie auf anderen Geräten erhalten.
- Wer „Jetzt prüfen“ drückt, erzeugt und speichert den neuen gemeinsamen Stand.
- Angezeigt werden Erstellername und Zeitpunkt.
- Alle Nutzer mit dem öffentlichen Link sehen dieselbe Watchlist und dieselben Ergebnisse.
- Twelve-Data-Credits entstehen nur beim aktiven Klick auf „Jetzt prüfen“.

Neue Dateien:
- netlify/functions/shared-dashboard.js
- package.json


VERSION 3.1 – GEMEINSAMER SPEICHER ÜBER GITHUB

Netlify Blobs wurde entfernt. Der gemeinsame Stand wird jetzt als
shared/dashboard.json im GitHub-Repository gespeichert.

Zusätzliche Netlify-Umgebungsvariable:
- GITHUB_DASHBOARD_TOKEN

Optional, bereits passend vorbelegt:
- GITHUB_DASHBOARD_OWNER = Foxilla92
- GITHUB_DASHBOARD_REPO = Fox-Friends-Aktien-Dashboard
- GITHUB_DASHBOARD_BRANCH = main

Der Token benötigt Schreibzugriff auf Repository-Inhalte.
Empfohlen wird ein Fine-grained Personal Access Token nur für dieses Repository
mit der Repository-Berechtigung „Contents: Read and write“.

Ablauf:
- Seite öffnen/refreshen: shared/dashboard.json wird über das Backend gelesen.
  Keine Twelve-Data-Credits.
- „Jetzt prüfen“: Twelve Data wird abgefragt; anschließend wird der fertige
  gemeinsame Stand in shared/dashboard.json gespeichert.
- GitHub löst dadurch einen neuen Netlify-Deploy aus. Die bereits offene Seite
  erhält das Ergebnis direkt aus der Function-Antwort; spätere Besucher laden
  den gespeicherten Stand.

Hinweis:
Jede erfolgreiche Prüfung erzeugt einen kleinen Commit in GitHub.


VERSION 4 – PRO
Neu: MACD, EMA 20/50/200, Bollinger-Bänder, ATR, CRV, Trend-/Momentum-/Risiko-/Chance-Scores,
Marktvergleich und optionaler Sektorvergleich.

Analystenratings, Earnings, Dividende und Fear & Greed sind als Kontextfelder vorbereitet,
werden aber bewusst nicht erfunden. Der aktuelle kostenlose Datenfeed liefert diese Daten
nicht für alle Symbole zuverlässig. Eine echte Befüllung benötigt später eine weitere
Datenquelle oder einen passenden Datentarif.

API-Verbrauch: Marktbenchmark kostet pro aktiver Prüfung eine zusätzliche Aktienabfrage.
Ein optionaler Sektorbenchmark kostet ebenfalls eine zusätzliche Aktienabfrage.


VERSION 4.1 – NÄCHSTE QUARTALSZAHLEN

- Pro Aktie wird zusätzlich der Twelve-Data-Endpunkt /earnings_calendar abgefragt.
- Angezeigt werden der nächste bekannte Termin innerhalb von 180 Tagen,
  die verbleibenden Tage und – sofern vorhanden – Veröffentlichungszeit/EPS-Schätzung.
- Ampellogik:
  Grün > 14 Tage, Gelb 8–14 Tage, Orange 3–7 Tage, Rot 0–2 Tage.
- Ist der Datensatz für ein Symbol oder den Tarif nicht verfügbar, bleibt die
  Aktienanalyse funktionsfähig und zeigt „Earnings: nicht verfügbar“.

API-VERBRAUCH
Eine Aktienprüfung benötigt jetzt normalerweise drei Credits:
1. Intraday-Kursreihe
2. Tages-Kursreihe
3. Earnings-Kalender
Zusätzlich benötigen Markt- und optionale Sektorbenchmarks jeweils ihre bisherigen
Kursabfragen. Beim Öffnen/Refresh entstehen weiterhin keine Twelve-Data-Credits.


VERSION 4.2 – ANFÄNGERFREUNDLICHE OBERFLÄCHE

- Klarer Ergebnisblock mit verständlichem Einstieg-/Ausstiegsscore.
- Signal-Vertrauen wird getrennt dargestellt.
- Trend, Schwung, Sicherheit und Kurspotenzial werden in Worten erklärt.
- Automatische Zusammenfassung der wichtigsten positiven Punkte und Risiken.
- CRV-Bereich mit Kurs, Ziel, rechnerischem Stopp und Marktvergleich.
- Technische Kennzahlen sind standardmäßig eingeklappt und verständlich erläutert.
- „Risiko“ wurde in der Oberfläche zu „Sicherheit“ umbenannt:
  Ein hoher Wert ist positiv, ein niedriger Wert deutet auf ungünstigere Bedingungen hin.
- Keine zusätzlichen API-Abfragen gegenüber Version 4.1.


VERSION 4.3 – ERKLÄRUNGSBEREICH

- Neuer Hilfe-Button „?“ neben den Einstellungen.
- Erläuterung aller Hauptwerte und technischen Indikatoren.
- Erklärung der Score-Gewichtung.
- Beispiele, warum eine Aktie als Kaufen, Prüfen oder Verkaufen bewertet wird.
- Speziell für Anfänger formuliert.
- Keine zusätzlichen API-Anfragen.


VERSION 5 – ZENTRALE AUTOMATISCHE PRÜFUNG

- Zentrale automatische Prüfung werktags um 09:00 Uhr deutscher Zeit.
- Zweite Prüfung werktags um 15:30 Uhr deutscher Zeit.
- Sommer- und Winterzeit werden über Europe/Berlin berücksichtigt.
- Deutsche Börsenfeiertage werden beim 09:00-Lauf übersprungen.
- US-Börsenfeiertage werden beim 15:30-Lauf übersprungen.
- Automatische Läufe werden als „Automatik“ gespeichert.
- Countdown bis zum nächsten Lauf auf der Oberfläche.
- Offene Browser laden den gemeinsamen Stand alle 60 Sekunden neu.
  Dabei entstehen keine Twelve-Data-Credits.
- Eine zentrale Sperre verhindert, dass manuelle und automatische Prüfungen
  gleichzeitig starten.
- Die bisherige Browser-Auto-Aktualisierung wurde entfernt.

TECHNIK
- auto-refresh-scheduled.js läuft alle 30 Minuten und prüft intern die Berliner Zeit.
- auto-refresh-background.js verarbeitet die Watchlist im Hintergrund.
- Maximal zwei Kursdatenpakete je Minute werden geladen, um das kostenlose
  Twelve-Data-Minutenlimit konservativ einzuhalten.
- Background Functions können auf Netlify bis zu 15 Minuten laufen.
- Bei sehr großen Watchlists kann der Lauf trotzdem an die Laufzeitgrenze stoßen.


VERSION 6 – CREDIT-OPTIMIERUNG

NEUE AUTOMATISCHE ZEITEN
- Werktags 09:15 Uhr deutscher Zeit
- Werktags 15:45 Uhr deutscher Zeit

API-OPTIMIERUNG
- Intraday-Daten werden weiterhin bei jeder aktiven Prüfung geladen.
- Tagesdaten werden nur einmal pro Aktie und Kalendertag geladen und danach
  im GitHub-Hilfscache wiederverwendet.
- Earnings werden ebenfalls nur einmal pro Aktie und Kalendertag geladen.
- Markt- und Sektorbenchmark verwenden nur Tagesdaten und keine Intraday-
  oder Earnings-Abfrage.
- Beim Öffnen/Refresh entstehen weiterhin keine Twelve-Data-Credits.

TYPISCHER VERBRAUCH
- Erste Aktienprüfung des Tages: bis zu 3 Credits pro Aktie
  (Intraday + Tagesdaten + Earnings).
- Weitere Prüfungen am selben Tag: normalerweise 1 Credit pro Aktie
  (nur Intraday).
- Marktbenchmark: beim ersten Lauf des Tages 1 Credit, danach 0 Credits.
- Optionaler Sektorbenchmark: beim ersten Lauf des Tages 1 Credit, danach 0 Credits.

Der Hilfscache wird unter shared/cache/ im GitHub-Repository gespeichert.
