/** Kurzfassung des Konzepts mit Verweis auf das vollstaendige Dokument. */
export function renderConcept(): string {
  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <h1>Konzept in Kurzform</h1>
          <p class="lead">
            APEX – Racing Director ist ein Motorsport-Manager in der Tradition von
            <em>Grand Prix Manager</em> (MicroProse), aber mit deutlich groesserer Tiefe:
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
          <p>Sportlicher Aufstieg reicht nicht: Liquiditaet, Infrastruktur und Personal
             muessen die Lizenzstufe der Zielliga erfuellen, sonst rueckt ein anderes Team nach.</p>
        </article>
        <article class="card">
          <h3>Neun Bauteilgruppen</h3>
          <p>Chassis, Fluegel, Unterboden, Antrieb, ERS, Getriebe, Fahrwerk, Bremsen – je mit
             Performance, Zuverlaessigkeit, Gewicht und Reifegrad.</p>
        </article>
        <article class="card">
          <h3>Kein Tod nach dem Abstieg</h3>
          <p>Fallschirmzahlungen ueber zwei Saisons, Werterhalt der Bauteile – aber
             Fixkosten einer zu grossen Fabrik koennen ein Team trotzdem ruinieren.</p>
        </article>
        <article class="card">
          <h3>Nachvollziehbare Simulation</h3>
          <p>Nach jedem Rennen wird der Rueckstand zerlegt: Auto, Fahrer, Setup, Reifen,
             Boxenstopps, Verkehr – in Sekunden, nicht in Bauchgefuehl.</p>
        </article>
      </div>

      <h2>Diese Seite</h2>
      <p>
        Der Ligen-Explorer zeigt eine deterministisch erzeugte Beispielwelt: 167 Teams,
        knapp 300 Stammfahrer, jede Liga ueber eine volle Saison im Light-Sim-Verfahren
        durchgerechnet. Gleicher Seed, gleiche Welt – die Tabellen sind bei jedem Aufruf
        identisch.
      </p>
      <p>
        Das vollstaendige Designdokument liegt im Repository unter
        <code>docs/KONZEPT_MEHRLIGA_RENNMANAGER.md</code> und beschreibt Reglements,
        Entwicklungsformeln, Rennsimulation, Wirtschaft, Datenmodell und Roadmap im Detail.
      </p>
    </section>`;
}
