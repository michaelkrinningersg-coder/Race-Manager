# APEX – Racing Director

Motorsport-Manager in der Tradition von *Grand Prix Manager* (MicroProse, 1995) – deutlich
tiefer, mit einer **10-stufigen Ligenpyramide** und **saisonalem Auf- und Abstieg**.

Dieses Repository enthält aktuell:

* das vollständige Designdokument → [`docs/KONZEPT_MEHRLIGA_RENNMANAGER.md`](docs/KONZEPT_MEHRLIGA_RENNMANAGER.md)
* die Schema-Spezifikation der Stammdaten → [`docs/DATENMODELL_APEX_M0.md`](docs/DATENMODELL_APEX_M0.md)
* den **Ligen-Explorer**: eine Vite/TypeScript-App, die eine deterministisch erzeugte
  Beispielwelt (167 Teams, 334 Stammfahrer, alle zehn Ligen über eine volle Saison
  durchsimuliert) im Browser darstellt.
* den **Bootstrapper**: liest `data/*.csv`, prüft sie gegen das Schema und erzeugt daraus
  `build/world_data.db`.
* die **Saison-Engine**: simuliert eine komplette Saison über alle zehn Ligen und schreibt
  Ergebnisse und Tabellen in ein Savegame.

**Live:** https://michaelkrinningersg-coder.github.io/Race-Manager/

---

## Das Spiel in drei Sätzen

Der Spieler führt ein Rennteam als Teamchef: Technik, Personal, Wirtschaft. Die Welt besteht
aus zehn Ligen – von der Amateurserie (Tier 10) bis zur Weltmeisterschaft (Tier 1) –, in denen
jede Saison die beiden Ersten aufsteigen, die beiden Letzten absteigen und Platz 3 gegen den
Drittletzten der höheren Liga in einer Barrage antritt. Aufstieg ist dabei nie automatisch:
Liquidität, Infrastruktur und Personal müssen die Lizenzstufe der Zielliga erfüllen.

| | |
| :--- | :--- |
| Ligen | 10, linear verbunden |
| Teams | 167 (11 in Tier 1 bis 22 in Tier 10) |
| Auto | 9 Bauteilgruppen mit Performance, Zuverlässigkeit, Gewicht, Reifegrad |
| Auf-/Abstieg | 2 direkt hoch, 2 direkt runter, 1 Barrage je Ligengrenze |
| Simulation | sektorbasierte Tick-Sim für die eigene Liga, Light-Sim für die übrigen neun |

Details, Formeln und Roadmap stehen im [Konzeptdokument](docs/KONZEPT_MEHRLIGA_RENNMANAGER.md).

---

## Ligen-Explorer

Die Seite zeigt, was das Konzept meint, statt es nur zu beschreiben:

* **Pyramide** – alle zehn Ligen mit Eckdaten und amtierendem Meister
* **Liga** – Team- und Fahrerwertung einer durchsimulierten Saison, mit farblich markierten
  Auf-, Barrage- und Abstiegszonen
* **Team** – Bauteilwerte gegen den Reglementdeckel der jeweiligen Liga, Kader, Budget
* **Konzept** – Kurzfassung der Designidee

Die Welt wird aus einem festen Seed erzeugt (`buildWorld()` in `src/data/world.ts`), die
Tabellen sind daher bei jedem Aufruf identisch. Der Saisonverlauf entsteht aus der in
Abschnitt 12.7 des Konzepts beschriebenen Light-Sim: Auto-Score (60 %) und Fahrer-Score (40 %)
plus konsistenzabhängiges Rauschen, dazu Ausfälle nach Zuverlässigkeit und Ligastufe.

---

## Bootstrapper

Der Bootstrapper ist der Weg von den handgepflegten Stammdaten zur Spieldatenbank. Er liest
`data/*.csv`, prüft sie in fünf Stufen (Syntax, Typen, Wertebereiche, Referenzen,
Konsistenzregeln) und schreibt `build/world_data.db`.

```bash
npm run bootstrap                # prüfen und schreiben
npm run bootstrap -- --partial   # Bestandslücken nur als Warnung
npm run bootstrap:check          # nur prüfen, nichts schreiben
```

Zwei Eigenschaften sind bewusst so gebaut:

* **Alle Prüfungen laufen durch, bevor abgebrochen wird.** Der Bericht listet sämtliche
  Befunde auf einmal – bei 617 handgepflegten Zeilen ist ein Validator, der beim ersten
  Fehler stehen bleibt, unbenutzbar.
* **Kein Zufall, keine Zeitstempel.** Gleiche CSVs ergeben eine byteweise identische
  Datenbank, damit Balancing-Änderungen im Diff sichtbar werden.

Fehler verhindern das Schreiben, Warnungen nicht. Solange die 167 Teams und 450 Fahrer noch
entstehen, gilt `--partial`: Alle inhaltlichen Regeln greifen scharf, nur die Vollständigkeit
des Bestandes wird gestundet.

`build/` ist nicht versioniert – versioniert wird ausschließlich `data/*.csv`.

Schema, Wertebereiche und Validierungsregeln: [`docs/DATENMODELL_APEX_M0.md`](docs/DATENMODELL_APEX_M0.md).

---

## Saison-Engine (M1)

```bash
npm run bootstrap    # Voraussetzung: erzeugt build/world_data.db
npm run season       # simuliert Saison 1, schreibt build/savegame.db
npm run season -- --quiet --seed 12345
```

Die Engine kopiert `world_data.db` zum Savegame und schreibt nur dorthin – die Weltdatenbank
bleibt unberührt. Ein Durchlauf umfasst 130 Rennwochenenden, 5.492 Einzelergebnisse und
braucht rund 110 ms; das Konzept setzt drei Sekunden als Ziel.

**Wie ein Ergebnis entsteht:** Für jedes Auto wird aus `track_sector_profile` ein Auto- und ein
Fahrer-Score gebildet – je Sektor gewichtet nach Bauteilgruppen und Fahrerwerten. Beide gehen
zu 60 zu 40 in einen Gesamtscore ein, darauf kommt ein Rauschen, dessen Streuung von der
Konstanz des Fahrers abhängt. Startplatz und Überholschwierigkeit der Strecke verschieben das
Ergebnis, Ausfälle entstehen per Monte Carlo aus der Ligaquote und der Zuverlässigkeit des Autos.
Jede Zahl ist damit herleitbar – die Forderung aus Design-Säule 3 des Konzepts.

Autos gibt es bis M3 noch nicht als gewachsene Werte. Sie werden aus dem Ligadeckel, dem
Prestige des Teams innerhalb seiner Liga und – für Antrieb und ERS – dem Motorenhersteller
abgeleitet. Die Feldbreite ist dabei bewusst **keine** Prozentzahl des Deckels, sondern wächst
nach unten hin: Kostendeckel und ATR ziehen die oberen Ligen zusammen, unten greift keins von
beidem.

Gleiche CSVs und gleicher Seed ergeben ein byteweise identisches Savegame.

---

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # Typprüfung + Produktionsbuild nach dist/
npm run preview    # gebauten Stand lokal ansehen
npm run typecheck  # App und Bootstrapper prüfen
```

**Projektstruktur**

```text
Race-Manager/
├── docs/
│   ├── KONZEPT_MEHRLIGA_RENNMANAGER.md    # Designdokument
│   └── DATENMODELL_APEX_M0.md             # Schema der Stammdaten
├── data/                                  # CSV-Stammdaten (die Wahrheit)
├── engine/                                # Saison-Engine (M1)
│   ├── rng.ts                             # deterministischer Zufall
│   ├── savegame.ts                        # Savegame-Kopie + Verlaufstabellen
│   ├── car.ts                             # Bauteilwerte aus Deckel und Prestige
│   ├── scoring.ts                         # Auto- und Fahrer-Score je Strecke
│   ├── lightsim.ts                        # Rennwochenende
│   ├── season.ts                          # Saisonlauf und Tabellen
│   └── index.ts                           # CLI
├── tools/bootstrap/
│   ├── csv.ts                             # CSV-Leser nach den Konventionen
│   ├── schema.ts                          # Spaltendefinitionen der acht Dateien
│   ├── load.ts                            # Typen, Wertebereiche, Eindeutigkeit
│   ├── validate.ts                        # dateiübergreifende Konsistenzregeln
│   ├── db.ts                              # DDL und SQLite-Erzeugung
│   ├── report.ts                          # Befunde und ihre Ausgabe
│   └── index.ts                           # CLI
├── src/
│   ├── data/leagues.ts                    # Stammdaten der 10 Ligen, Punkte, Bewegungsregeln
│   ├── data/world.ts                      # Weltgenerator (Seed) + Light-Sim einer Saison
│   ├── ui/format.ts                       # Formatierungs-Helfer
│   ├── views/                             # Pyramide, Liga, Team, Konzept
│   ├── main.ts                            # Hash-Router und Layout
│   └── style.css
├── .github/workflows/pages.yml            # Build + Deployment auf GitHub Pages
├── tsconfig.tools.json                    # Typprüfung für tools/ (außerhalb des App-Builds)
└── vite.config.ts                         # base: '/Race-Manager/' für Pages
```

---

## Deployment

Jeder Push auf `main` baut die App und veröffentlicht `dist/` über GitHub Pages
(Workflow `Deploy to GitHub Pages`). Einmalig muss in den Repository-Einstellungen unter
**Settings → Pages → Source** der Wert **GitHub Actions** ausgewählt sein.

## Versionierung

SemVer-Tags ab dem ersten Stand: `v0.1.0` = Konzept + Ligen-Explorer + Pages.
Jeder Roadmap-Meilenstein bekommt einen Minor-Sprung.

Getaggt wird automatisch: Der Workflow `Tag bei Versionswechsel` liest die `version` aus
`package.json` und legt bei jedem Push auf `main` den passenden Tag an, falls er noch fehlt.
Für ein neues Release genügt daher das Anheben der Versionsnummer in `package.json`.
Siehe [`CLAUDE.md`](CLAUDE.md).

## Hinweis

Alle Teams, Fahrer, Serien und Namen in diesem Projekt sind frei erfunden und deterministisch
generiert. Es besteht keine Verbindung zu realen Rennserien, Teams oder Personen.
