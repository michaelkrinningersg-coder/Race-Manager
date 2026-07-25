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
* die **Saison-Engine**: simuliert beliebig viele Saisons über alle zehn Ligen, inklusive
  Auf- und Abstieg, Barrage, Lizenzprüfung und Fallschirmzahlungen.

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

## Saison-Engine (M1 – M4)

```bash
npm run bootstrap                  # Voraussetzung: erzeugt build/world_data.db
npm run season                     # Saison 1, schreibt build/savegame.db
npm run season -- --seasons 10     # zehn Saisons mit Auf- und Abstieg
npm run season -- --tick-tier 1    # Tier 1 rundenweise statt Light-Sim
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

**Autos in Saison 1** entstehen aus Ligadeckel, Prestige und Motorenhersteller. Die Feldbreite
ist bewusst **keine** Prozentzahl des Deckels, sondern wächst nach unten: Kostendeckel und ATR
ziehen die oberen Ligen zusammen, unten greift keins von beidem. Prestige ist damit ein reiner
Startwert – ab Saison 2 zählt nur noch der gewachsene Bauteilwert.

### Entwicklung (M3)

Ein Entwicklungsschritt je Saison, nach der Formel aus Konzept 6.3: Ressourcen mit abnehmendem
Grenzertrag, Personal als Multiplikator, ATR-Faktor, Fahrer-Feedback, Sättigung nahe am Deckel.
Über zehn Saisons wächst das Tier-1-Feld im Schnitt von 786 auf 934 bei Deckel 1000.

Der **Sättigungsterm ist der Anti-Dominanz-Regler**: Wer nah am Deckel steht, gewinnt kaum noch
dazu, wer weit weg ist, holt schnell auf. Zusammen mit der ATR – der Meister bekommt die
wenigste Windkanalzeit – wechselt der Tier-1-Titel in 15 Saisons sechsmal den Besitzer.

Gespeichert wird stets der **echte** Bauteilwert; der Reglementdeckel kappt erst beim Einsatz
(Konzept 6.2). Ein Absteiger behält damit sein Auto, auch wenn er es unten nicht ausfahren darf.

Zwei Dinge kann ein Schritt pro Saison nicht: Upgrade-Pakete (Konzept 6.4) und die Ereignisse
Durchbruch und Sackgasse. Beide setzen einen Wochentakt voraus. Aus demselben Grund ist die
Streuung schmal – 39 Wochenwürfe mitteln sich aus, sie summieren sich nicht.

### Rundenweise Rennsimulation (M4)

`--tick-tier N` rechnet eine Liga rundenweise durch, die übrigen neun bleiben Light-Sim – die
Aufteilung aus Konzept 12.7. Jede Runde jedes Autos landet in `lap_records`: Rundenzeit,
Position, Rückstand, Mischung, Verschleiß, Spritmenge und Ereignis.

Die Rundenzeit entsteht aus der sauberen Pace (Auto und Fahrer über das Sektorprofil),
Reifenverschleiß, Spritmasse und Verkehr. **Die Reifenklippe ist der Kern:** Unterhalb kostet
Abbau wenig, oberhalb sehr viel – deshalb kostet ein zu später Stopp ein Rennen. Die Mischungen
sind so kalibriert, dass eine volle Renndistanz die Klippe erreicht; ohne das wäre kein Stopp
nötig und die Strategieebene bliebe wirkungslos.

Die Stoppzahl ergibt sich aus Verschleiß, Mischung und Boxengassenverlust, verrauscht mit der
Qualität des Chefstrategen. Das Ergebnis variiert mit der Strecke: Lombardia (Abrieb 0,42) wird
ohne Stopp gefahren, Anatolia (0,86) mit einem.

`race_analysis` hält je Fahrer und Rennen fest, wie viele Sekunden an Reifen, Sprit, Verkehr und
Boxenstopps verloren gingen – die Zeitzerlegung aus Design-Säule 3.

Nicht enthalten: Safety Car und Wetter. Beide gehören laut Roadmap zu M7. Ohne sie bleibt die
Strategie eine Rechenaufgabe statt einer Entscheidung.

### Auf- und Abstieg (M2)

Am Saisonende laufen Barrage, Auf-/Abstieg und Lizenzprüfung in der Reihenfolge aus Konzept 13.2.

**Die Symmetrie ist strukturell garantiert.** An jeder Ligengrenze steigen exakt so viele Teams
ab, wie aufsteigen – nicht weil die Regeldatei es so vorgibt, sondern weil die Zahl der
Absteiger aus der Zahl der tatsächlich lizenzfähigen Aufsteiger abgeleitet wird. Findet sich
kein aufstiegsberechtigtes Team, bleibt auch der Absteiger oben. Ohne diese Kopplung
schrumpfen und wachsen die Ligen über die Saisons hinweg unbemerkt.

**Die Lizenz kann einen Aufstieg kosten.** Geprüft wird gegen die Anforderungen der Zielliga:
Liquidität als Anteil ihres Kostendeckels, Infrastruktur, Personal, Motorenvertrag. Scheitert
ein Team, rückt das nächstplatzierte lizenzfähige nach – die Suche endet zwei Plätze hinter der
Aufstiegszone. Infrastruktur und Personal werden bis M5/M6 aus Liga und Prestige abgeleitet;
getauscht wird dann nur die Ableitung, nicht die Prüflogik.

**Die Barrage** läuft über zwei Läufe auf neutraler Strecke unter dem Reglement der *unteren*
Liga – das Auto des höherklassigen Teams wird auf deren Deckel gekappt. Über zehn Saisons
gewinnt der Herausforderer 31 von 90 Duellen: Der Titelverteidiger ist begünstigt, aber nicht
sicher.

Gleiche CSVs und gleicher Seed ergeben ein byteweise identisches Savegame – auch über zehn
Saisons hinweg.

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
│   ├── lightsim.ts                        # Rennwochenende (Light-Sim)
│   ├── racesim.ts                         # rundenweise Rennsimulation
│   ├── facilities.ts                      # abgeleitete Infrastruktur
│   ├── licence.ts                         # Lizenzprüfung
│   ├── finance.ts                         # Ausschüttung und Fallschirm
│   ├── promotion.ts                       # Auf-/Abstieg und Barrage
│   ├── season.ts                          # Saisonlauf, Tabellen, Finanzen
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
