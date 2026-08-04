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


VERSION 6.1 – SCORE VERSTÄNDLICH ERKLÄRT

- Neutralere Labels:
  Kaufchance, Beobachten, Gewinnmitnahme prüfen, Verkaufsrisiko.
- Einstiegsscore wird direkt eingeordnet:
  0–25 eher ungünstig, 26–50 abwarten, 51–75 interessant, 76–100 sehr attraktiv.
- Direkte Aufteilung des Scores in:
  Trend, Schwung, Bewertung und Chance.
- Automatische Erklärung, welcher Teilwert die Bewertung am stärksten stützt
  und welcher sie am meisten bremst.
- Score-Skala lässt sich direkt auf der Aktienkarte ein- und ausblenden.
- Klarer Hinweis: Das Dashboard weiß nicht, ob jemand die Aktie besitzt.
- Keine zusätzlichen API-Abfragen.


VERSION 6.2 – SCORE, EURO, AUTOMATIK & BEISPIELRECHNER

SCORE
- Aktive Score-Einordnung direkt neben dem Wert.
- Kleine Hilfe-Schaltfläche direkt am Score.
- Aufklappbare Vierer-Skala direkt neben der Zahl.
- Aktiver Bereich wird farbig hervorgehoben.

EURO-UMRECHNUNG
- USD-Kurse werden zusätzlich ungefähr in EUR angezeigt.
- EUR/USD wird einmal täglich geladen und gemeinsam gecacht.
- Aktueller Kurs, technisches Ziel und rechnerischer Stopp werden umgerechnet.
- Die Umrechnung ist eine Näherung und berücksichtigt keine Broker-Spreads.

BEISPIELRECHNER
- Frei einstellbarer Beispielbetrag, standardmäßig 1.000 Euro.
- Anzeige des rechnerischen Gewinns am technischen Ziel.
- Anzeige des rechnerischen Verlusts am technischen Stopp.
- Keine persönliche Depotverwaltung.

AUTOMATIK
- Getrennte Anzeige von nächstem Lauf und Countdown.
- Letzte Aktualisierung und Ersteller werden angezeigt.
- Geschätzter API-Verbrauch des aktuellen Tages wird gemeinsam gespeichert.
- API-Zähler basiert auf den vom Dashboard ausgelösten Twelve-Data-Abfragen.

ZUSÄTZLICHER API-VERBRAUCH
- EUR/USD benötigt höchstens einen zusätzlichen Credit pro Kalendertag.
- Danach wird der gemeinsame Tagescache verwendet.


VERSION 6.3 – EURO-FIX IM CRV-BEREICH

- Bei US-Börsen wird USD nun auch dann erkannt, wenn Twelve Data das Feld
  „currency“ in den Metadaten nicht mitsendet.
- Die Euro-Umrechnung versucht zuerst USD/EUR und ersatzweise EUR/USD.
- Im CRV-Bereich wird für USD-Aktien jetzt Euro als Hauptwert angezeigt.
- Der originale Dollarwert steht kleiner darunter.
- Nach dem Deploy muss die Aktie einmal neu geprüft werden, damit Währung und
  Tageswechselkurs im gemeinsamen Ergebnis gespeichert werden.


VERSION 6.4 – ANZEIGE- UND COUNTDOWN-FIX

- Die letzte Aktualisierung wird nicht mehr doppelt angezeigt.
- Der gemeinsame Stand bleibt ausschließlich in der oberen Statuszeile sichtbar.
- Im Automatik-Kasten bleiben Status, Countdown, feste Uhrzeiten und API-Verbrauch.
- Der Countdown wurde korrigiert und findet 09:15 sowie 15:45 jetzt zuverlässig.
- Ursache war ein nicht auf Viertelstunden ausgerichtetes Suchraster.


VERSION 6.5
- Unter dem Ticker wird nun kompakt der Firmenname und der Börsenplatz angezeigt (z. B. 'Intel Corporation · NASDAQ').


VERSION 6.6 – TREND-TRADER-PROFIL

Neue Standard-Gewichtung:
- Trend (EMA): 30 %
- Preis & Fibonacci: 25 %
- Momentum (MACD/Bollinger): 20 %
- Volumen: 15 %
- RSI: 10 %

Der RSI dient jetzt bewusst nur noch als Warn- und Zusatzfilter.
Die Gewichtung wurde im Einstellungsdialog und im Hilfebereich angepasst.


VERSION 7 – MAKRO, KLAPPKARTEN UND SYMBOL-FIX
- Firmenname und Börse kompakt unter jedem Kürzel.
- Aktienkarten lassen sich einzeln ein- und ausklappen.
- Earnings-Anzeige und Earnings-API-Abfrage entfernt.
- High-Impact-Wirtschaftskalender für USA, Eurozone und Deutschland.
- Optional: TRADING_ECONOMICS_API_KEY in Netlify; ohne Key wird guest:guest versucht.
- Symbol-Aliase verhindern falsche US-Treffer: SIE=Siemens AG/XETRA, ENR=Siemens Energy/XETRA, DRO/DRH=DroneShield/ASX.
- Explizite US-Symbole bleiben möglich, z. B. NYSE:ENR oder NYSE:DRH.
- Keine stille Substitution auf ein anderes Unternehmen mehr.


VERSION 7.1 – KARTEN-, SYMBOL- UND MAKRO-FIX

SYMBOLSICHERHEIT
- ENR wird bereits im Browser als XETR:ENR angefragt.
- SIE wird als XETR:SIE angefragt.
- DRH, DRO und DroneShield werden als ASX:DRO angefragt.
- Alte gespeicherte NYSE-Fehlzuordnungen werden nicht mehr angezeigt,
  sondern ausdrücklich als falscher Datensatz markiert.
- Falls ASX:DRO im Twelve-Data-Tarif nicht verfügbar ist, erscheint ein Fehler
  statt DiamondRock Hospitality.

FIRMENNAMEN
- Bekannte Unternehmen erhalten ausgeschriebene Namen, unter anderem:
  Intel Corporation, Apple Inc., Microsoft Corporation, Siemens AG,
  Siemens Energy AG, Rheinmetall AG und DroneShield Limited.
- Der Firmenname wird im gemeinsamen Ergebnis gespeichert.

EINKLAPPBARE KARTEN
- Der komplette Inhalt einschließlich technischer Details und TradingView wird
  eingeklappt.
- Eingeklappt bleiben nur Ticker, Firmenname/Börse, Kurs und Status sichtbar.
- Der Zustand wird pro Browser gespeichert und überlebt Refresh sowie
  die automatische Aktualisierung des gemeinsamen Standes.
- Eingeklappte Karten behalten keine leere Höhe mehr.

WIRTSCHAFTSKALENDER
- HTML-Fehlerantworten werden nicht mehr als JSON verarbeitet.
- Ohne TRADING_ECONOMICS_API_KEY erscheint eine klare Aktivierungsinformation.
- Mit API-Key werden High-Impact-Termine weiterhin geladen und gecacht.


VERSION 7.2 – KARTEN- UND EURO-FIX

- Eingeklappte Aktienkarten zeigen nur noch:
  Ticker, ausgeschriebenen Firmennamen, Börse, Kurs und Status.
- Technische Details und TradingView werden vollständig ausgeblendet.
- Die leere Resthöhe der Karten wurde entfernt.
- Der eingeklappte Zustand bleibt nach Refresh und automatischen Aktualisierungen erhalten.
- Die Euro-Erkennung verwendet zusätzlich den Börsenplatz, falls Twelve Data
  keine Währung im gemeinsamen Ergebnis gespeichert hat.
- Für die tatsächliche Euro-Umrechnung muss die Aktie nach dem Deploy einmal
  neu geprüft werden, damit der aktuelle Wechselkurs gespeichert wird.


VERSION 7.3 – EURO KONSEQUENT

- Bei Nicht-Euro-Aktien wird der Euro-Wert groß als Hauptwert angezeigt.
- Die Originalwährung steht kleiner darunter.
- Dies gilt für:
  - den Kurs oben in der Aktienkarte
  - den aktuellen Kurs im Chancen-Risiko-Bereich
  - das mögliche Ziel
  - den rechnerischen Stopp
- Bei Euro-Aktien erscheint nur der Euro-Wert.
- Nach dem Deploy müssen die Aktien einmal neu geprüft werden, damit der
  aktuelle Wechselkurs im gemeinsamen Ergebnis gespeichert wird.
