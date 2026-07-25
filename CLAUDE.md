# Arbeitsregeln für Claude in diesem Repo

## 1. Keine eigenständigen Entscheidungen

**Wichtigste Regel:** Claude trifft keine inhaltlichen, konzeptionellen oder technischen
Entscheidungen eigenständig. Sobald es mehr als einen sinnvollen Weg gibt, wird
**nachgefragt** – und zwar mit **konkreten Optionen zur Auswahl**, nicht mit einer offenen Frage.

Das gilt insbesondere für:

* Auswahl von Technologien, Bibliotheken, Frameworks, Hosting
* Repo-Struktur, neue Repositories, Branch- und Tag-Strategie
* Spielmechaniken, Balancing-Werte, Regelwerke, Namen
* Umfang und Schnitt von Features (MVP-Grenzen)
* Datenmodell-Entwürfe, Schema-Änderungen
* Alles, was später schwer rückgängig zu machen ist

**Format der Rückfrage:** immer 2–4 benannte Optionen, je mit einem Satz zu Vor-/Nachteilen,
und eine klar gekennzeichnete Empfehlung. Erst nach der Antwort wird umgesetzt.

Wenn während der Arbeit eine Unklarheit auftaucht: zuerst alles erledigen, was
unabhängig davon ist, und dann mit Optionen nachfragen – nicht raten.

## 2. Sprache

Konzepte, Dokumentation, Commit-Messages und Antworten auf Deutsch.
Code, Bezeichner und Dateinamen auf Englisch.

## 3. Branch & Commits

* Entwicklung auf dem jeweils vereinbarten Feature-Branch, niemals direkt auf `main`.
* Commits klein, thematisch geschnitten und mit aussagekräftiger deutscher Message.
* Kein Pull Request ohne ausdrückliche Aufforderung.

## 4. Versionierung (von Beginn an)

* **SemVer-Tags** `v0.x.y` – ab dem ersten Arbeitsstand.
  * `v0.1.0` = Konzept + Ligen-Explorer + Pages-Deployment
  * Neuer Meilenstein aus der Roadmap → Minor-Sprung (`v0.2.0`, `v0.3.0`, …)
  * Korrekturen und kleine Ergänzungen → Patch-Sprung (`v0.1.1`, …)
  * `v1.0.0` erst, wenn eine vollständige Karriere spielbar ist.
* Tags entstehen **automatisch** über `.github/workflows/tag.yml`: Der Workflow liest die
  Version aus `package.json` und legt `v<version>` an, sobald sie auf `main` erhöht wird.
  Für eine neue Version genügt also das Anheben von `version` in `package.json`.
  (Hintergrund: Aus der Claude-Session heraus sind Tag-Pushes durch den Git-Proxy gesperrt.)

## 5. Deployment

* GitHub Pages wird über `.github/workflows/pages.yml` aus dem Vite-Build (`npm run build`)
  bei jedem Push auf `main` deployed.
* `vite.config.ts` setzt `base: '/Race-Manager/'` – beim Umbenennen des Repos muss der
  Basispfad mitgezogen werden.

## 6. Projektüberblick

* `docs/KONZEPT_MEHRLIGA_RENNMANAGER.md` – vollständiges Designdokument (APEX)
* `docs/DATENMODELL_APEX_M0.md` – Schema der CSV-Stammdaten und der `world_data.db` (M0–M2)
* `src/data/leagues.ts` – Stammdaten der zehn Ligen
* `src/data/world.ts` – deterministischer Weltgenerator + Light-Sim einer Saison
* `src/views/` – Ansichten des Ligen-Explorers
