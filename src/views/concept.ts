/** Kurzfassung des Konzepts mit Verweis auf das vollständige Dokument. */
export function renderConcept(): string {
  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <h1>Konzept in Kurzform</h1>
          <p class="lead">
            APEX – Racing Director ist ein Motorsport-Manager in der Tradition von
            <em>Grand Prix Manager</em> (MicroProse), aber mit deutlich größerer Tiefe:
            zehn Ligen, saisonaler Auf- und Abstieg, ein Auto aus neun Bauteilgruppen und
            eine nachvollziehbare Rennsimulation.
          </p>
        </div>
      </header>

      <div class="cards">
        <article class="card">
          <h3>Aufstieg als Kernfantasie</h3>
          <p>Von der Amateurliga bis zur Weltmeisterschaft. Jede Stufe hat eigenes Reglement,
             eigenes Budget, eigenes Wochenendformat.</p>
        </article>
        <article class="card">
          <h3>Auf- und Abstieg</h3>
          <p>Zwei direkte Aufsteiger, zwei direkte Absteiger, dazu eine Barrage zwischen
             dem Dritten unten und dem Drittletzten oben – gefahren auf neutraler Strecke.</p>
        </article>
        <article class="card">
          <h3>Lizenz statt Automatik</h3>
          <p>Sportlicher Aufstieg reicht nicht: Liquidität, Infrastruktur und Personal
             müssen die Lizenzstufe der Zielliga erfüllen, sonst rückt ein anderes Team nach.</p>
        </article>
        <article class="card">
          <h3>Neun Bauteilgruppen</h3>
          <p>Chassis, Flügel, Unterboden, Antrieb, ERS, Getriebe, Fahrwerk, Bremsen – je mit
             Performance, Zuverlässigkeit, Gewicht und Reifegrad.</p>
        </article>
        <article class="card">
          <h3>Kein Tod nach dem Abstieg</h3>
          <p>Fallschirmzahlungen über zwei Saisons, Werterhalt der Bauteile – aber
             Fixkosten einer zu großen Fabrik können ein Team trotzdem ruinieren.</p>
        </article>
        <article class="card">
          <h3>Nachvollziehbare Simulation</h3>
          <p>Nach jedem Rennen wird der Rückstand zerlegt: Auto, Fahrer, Setup, Reifen,
             Boxenstopps, Verkehr – in Sekunden, nicht in Bauchgefühl.</p>
        </article>
      </div>

      <h2>Diese Seite</h2>
      <p>
        Was hier steht, ist kein Beispiel, sondern das Ergebnis der Engine. Der
        Bootstrapper prüft die handgepflegten Stammdaten aus <code>data/*.csv</code> und
        erzeugt daraus die Welt; die Engine simuliert zwanzig Saisons mit Rennen, Auf- und
        Abstieg, Bauteilentwicklung, Fahrerkarrieren, Personal und Infrastruktur. Das
        Ergebnis wird als SQLite-Datenbank ausgeliefert und im Browser abgefragt – daher
        der kurze Ladebalken beim ersten Aufruf.
      </p>
      <p>
        Alles bleibt deterministisch: gleicher Seed, gleiche Welt. Die Tabellen sind bei
        jedem Aufruf identisch, und eine geänderte CSV-Zeile schlägt beim nächsten
        Deployment bis in die letzte Fahrerakte durch.
      </p>
      <p class="muted small">
        Den Rundenverlauf gibt es nur für die Schlusssaison der obersten Liga – zwanzig
        Saisons rundenweise wären rund 570.000 Datenzeilen und über 60 MB gewesen. Alle
        übrigen Rennen liefern Ergebnisse, aber keinen Verlauf.
      </p>
      <p>
        Das vollständige Designdokument liegt im Repository unter
        <code>docs/KONZEPT_MEHRLIGA_RENNMANAGER.md</code> und beschreibt Reglements,
        Entwicklungsformeln, Rennsimulation, Wirtschaft, Datenmodell und Roadmap im Detail.
      </p>
    </section>`;
}
