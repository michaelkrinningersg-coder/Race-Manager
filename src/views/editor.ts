import {
  documentRows,
  parseDocument,
  serializeDocument,
  type CsvDocument,
} from '../../tools/bootstrap/csv';
import { TABLES, type ColumnSpec, type TableSpec } from '../../tools/bootstrap/schema';
import { buildTable } from '../../tools/bootstrap/table';
import type { Finding } from '../../tools/bootstrap/report';
import { escapeHtml } from '../ui/format';

/**
 * Stammdaten-Editor (Konzept 17).
 *
 * WARUM DIE CSV-DATEIEN UND NICHT DIE DATENBANK. Der Editor liest
 * `public/data/*.csv`, die das Publish-Werkzeug aus `data/` kopiert - nicht
 * `apex.db`. Zwei Gruende: Die Datenbank kennt die Gliederungskommentare der
 * handgepflegten Dateien nicht, und sie enthaelt 928 Fahrer statt 450, weil die
 * Newgens erst waehrend der Simulation entstehen. Wer in der Datenbank
 * editierte, bekaeme 478 Fahrer angeboten, die in keiner Quelldatei stehen.
 *
 * WARUM HERUNTERLADEN STATT SPEICHERN. Die Seite ist statisch und hat keinen
 * Server, dem sie etwas schicken koennte. Der Weg schliesst sich ueber das
 * Repo: bearbeiten, herunterladen, in `data/` einchecken - der Pages-Workflow
 * rechnet die Welt beim naechsten Push ohnehin neu. Das ist keine Notloesung,
 * sondern die Konsequenz daraus, dass die CSV-Dateien die Wahrheit sind.
 *
 * WAS DER EDITOR NICHT KANN. Die Welt neu rechnen. Die Engine haengt an
 * better-sqlite3 und laeuft nicht im Browser. Der Editor prueft deshalb die
 * Regeln, die ohne Simulation pruefbar sind - Typen, Wertebereiche,
 * Eindeutigkeit, Primaerschluessel, Sortierung - und zwar mit demselben Code
 * wie der Bootstrapper (tools/bootstrap/table.ts). Zwei Fassungen derselben
 * Regel laufen immer auseinander.
 */

/** Die vier Dateien aus Konzept 17. */
const EDITABLE = ['teams.csv', 'drivers.csv', 'tracks.csv', 'league_regulations.csv'] as const;

const FILE_LABEL: Record<string, string> = {
  'teams.csv': 'Teams',
  'drivers.csv': 'Fahrer',
  'tracks.csv': 'Strecken',
  'league_regulations.csv': 'Ligareglements',
};

/** Zustand einer geoeffneten Datei. Ueberlebt den Wechsel zwischen Dateien. */
interface EditorState {
  file: string;
  document: CsvDocument;
  original: string;
  findings: Finding[];
  filter: string;
}

const cache = new Map<string, EditorState>();
let active: EditorState | null = null;

function specFor(file: string): TableSpec | undefined {
  return TABLES.find((table) => table.file === file);
}

/** Erwartungstext einer Spalte - die Regel, gegen die geprueft wird. */
function ruleOf(column: ColumnSpec): string {
  const parts: string[] = [column.type === 'text' ? 'Text' : column.type === 'int' ? 'ganzzahlig' : 'Dezimalzahl'];
  if (column.required) parts.push('Pflicht');
  if (column.unique) parts.push('eindeutig');
  if (column.min !== undefined || column.max !== undefined) {
    parts.push(`${column.min ?? '−∞'} bis ${column.max ?? '∞'}`);
  }
  if (column.length !== undefined) parts.push(`genau ${column.length} Zeichen`);
  if (column.values) parts.push(column.values.join(' | '));
  return parts.join(' · ');
}

function validate(state: EditorState): void {
  const spec = specFor(state.file);
  if (!spec) {
    state.findings = [];
    return;
  }
  const findings: Finding[] = [];
  buildTable(serializeDocument(state.document), spec, findings);
  state.findings = findings;
}

async function load(file: string): Promise<EditorState> {
  const cached = cache.get(file);
  if (cached) return cached;

  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!response.ok) {
    throw new Error(
      `${file} nicht gefunden (HTTP ${response.status}). Die Stammdaten entstehen mit 'npm run publish'.`,
    );
  }
  const text = await response.text();
  const state: EditorState = {
    file,
    document: parseDocument(text),
    original: text,
    findings: [],
    filter: '',
  };
  validate(state);
  cache.set(file, state);
  return state;
}

function isDirty(state: EditorState): boolean {
  return serializeDocument(state.document) !== state.original;
}

function renderFindings(state: EditorState): string {
  const errors = state.findings.filter((finding) => finding.severity === 'error');
  const warnings = state.findings.filter((finding) => finding.severity === 'warning');

  if (!state.findings.length) {
    return `<p class="editor-status editor-status--ok">
              Keine Beanstandungen – die Datei erfüllt alle Regeln des Bootstrappers.
            </p>`;
  }

  const item = (finding: Finding): string =>
    `<li class="editor-finding editor-finding--${finding.severity}">
       ${finding.line ? `<span class="editor-finding__line">Zeile ${finding.line}</span>` : ''}
       ${escapeHtml(finding.message)}
     </li>`;

  return `
    <div class="editor-status ${errors.length ? 'editor-status--error' : 'editor-status--warn'}">
      <strong>${errors.length} Fehler, ${warnings.length} Hinweise</strong>
      ${errors.length ? ' – so eingecheckt bricht der Bootstrapper ab.' : ' – Hinweise blockieren nichts.'}
    </div>
    <ul class="editor-findings">
      ${[...errors, ...warnings].slice(0, 40).map(item).join('')}
    </ul>
    ${
      state.findings.length > 40
        ? `<p class="muted small">… und ${state.findings.length - 40} weitere.</p>`
        : ''
    }`;
}

function renderTable(state: EditorState): string {
  const spec = specFor(state.file);
  if (!spec) return '<p class="muted">Für diese Datei gibt es keine Spaltendefinition.</p>';

  const rows = documentRows(state.document);
  const needle = state.filter.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => row.fields.some((field) => field.value.toLowerCase().includes(needle)))
    : rows;

  // Fehlerzeilen markieren, damit man sie in einer langen Datei findet.
  const badLines = new Set(
    state.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.line),
  );

  const head = spec.columns
    .map(
      (column) =>
        `<th title="${escapeHtml(ruleOf(column))}">
           ${escapeHtml(column.name)}${column.required ? '<span class="editor-req">*</span>' : ''}
         </th>`,
    )
    .join('');

  const body = shown
    .map((row) => {
      const index = rows.indexOf(row);
      const cells = spec.columns
        .map((column, position) => {
          const field = row.fields[position];
          return `<td>
                    <input class="editor-cell" data-row="${index}" data-field="${position}"
                           value="${escapeHtml(field?.value ?? '')}"
                           title="${escapeHtml(column.name)}: ${escapeHtml(ruleOf(column))}" />
                  </td>`;
        })
        .join('');
      return `<tr class="${badLines.has(row.line) ? 'editor-row--bad' : ''}">
                <th class="editor-rownum">${row.line}</th>${cells}
              </tr>`;
    })
    .join('');

  return `
    <div class="table-scroll editor-scroll">
      <table class="table table--compact editor-table">
        <thead><tr><th class="editor-rownum">Zeile</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${
      shown.length < rows.length
        ? `<p class="muted small">${shown.length} von ${rows.length} Zeilen gezeigt.</p>`
        : `<p class="muted small">${rows.length} Zeilen.</p>`
    }`;
}

function renderBody(state: EditorState): string {
  const dirty = isDirty(state);
  return `
    <div class="editor-bar">
      <input class="editor-filter" id="editor-filter" placeholder="Zeilen filtern …"
             value="${escapeHtml(state.filter)}" />
      <button class="editor-button" id="editor-download" ${dirty ? '' : 'disabled'}>
        ${escapeHtml(state.file)} herunterladen
      </button>
      <button class="editor-button editor-button--ghost" id="editor-reset" ${dirty ? '' : 'disabled'}>
        Änderungen verwerfen
      </button>
      <span class="editor-dirty">${dirty ? 'geändert' : 'unverändert'}</span>
    </div>
    ${renderFindings(state)}
    ${renderTable(state)}`;
}

/**
 * Haengt die Ereignisse an. Wird nach jedem Neuzeichnen erneut aufgerufen -
 * die Ansichten dieses Projekts ersetzen ihr HTML komplett, alte Handler sind
 * damit ohnehin verschwunden.
 */
function wire(rerender: () => void): void {
  const container = document.querySelector<HTMLElement>('#editor-body');
  if (!container || !active) return;
  const state = active;

  container.querySelectorAll<HTMLInputElement>('.editor-cell').forEach((input) => {
    input.addEventListener('change', () => {
      const rows = documentRows(state.document);
      const row = rows[Number(input.dataset.row)];
      const field = row?.fields[Number(input.dataset.field)];
      if (!field) return;
      field.value = input.value;
      validate(state);
      rerender();
    });
  });

  const filter = container.querySelector<HTMLInputElement>('#editor-filter');
  filter?.addEventListener('change', () => {
    state.filter = filter.value;
    rerender();
  });

  container.querySelector('#editor-download')?.addEventListener('click', () => {
    const blob = new Blob([serializeDocument(state.document)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.file;
    link.click();
    URL.revokeObjectURL(url);
  });

  container.querySelector('#editor-reset')?.addEventListener('click', () => {
    state.document = parseDocument(state.original);
    validate(state);
    rerender();
  });
}

/**
 * Die Editoransicht ist die einzige, die nach dem ersten Zeichnen weiterlebt:
 * Sie laedt eine Datei nach und zeichnet sich bei jeder Eingabe neu. Deshalb
 * bekommt sie einen eigenen Einhaengepunkt statt nur einer Zeichenkette.
 */
export function renderEditor(file: string): string {
  const chosen = (EDITABLE as readonly string[]).includes(file) ? file : EDITABLE[0];

  const tabs = EDITABLE.map((entry) => {
    const spec = specFor(entry);
    return `<a class="editor-tab${entry === chosen ? ' is-active' : ''}" href="#/editor/${entry}">
              ${escapeHtml(FILE_LABEL[entry] ?? entry)}
              <span class="muted small">${spec ? spec.columns.length : 0} Spalten</span>
            </a>`;
  }).join('');

  queueMicrotask(() => {
    const body = document.querySelector<HTMLElement>('#editor-body');
    if (!body) return;

    const rerender = (): void => {
      if (!active) return;
      body.innerHTML = renderBody(active);
      wire(rerender);
    };

    load(chosen)
      .then((state) => {
        active = state;
        rerender();
      })
      .catch((error: unknown) => {
        body.innerHTML = `<p class="editor-status editor-status--error">
            ${escapeHtml(error instanceof Error ? error.message : String(error))}
          </p>`;
      });
  });

  return `
    <section class="panel">
      <header class="panel__head">
        <div>
          <span class="tier-badge">Stammdaten</span>
          <h1>Editor</h1>
          <p class="lead">
            Teams, Fahrer, Strecken und Ligareglements bearbeiten – geprüft nach denselben
            Regeln wie im Bootstrapper.
          </p>
        </div>
      </header>

      <p class="muted small">
        Bearbeitet werden die <strong>CSV-Dateien</strong>, nicht die Datenbank: Nur dort stehen
        die Gliederungskommentare, und nur dort fehlen die Fahrer, die erst während der
        Simulation entstehen. Gespeichert wird per Download – die Seite ist statisch und hat
        keinen Server. Der Weg schließt sich über das Repo: herunterladen, nach
        <code>data/</code> legen, einchecken; der nächste Push rechnet die Welt neu.
        Die Welt hier im Browser neu zu rechnen ist nicht möglich – die Engine läuft auf Node.
      </p>

      <div class="editor-tabs">${tabs}</div>
      <div id="editor-body"><p class="muted">Datei wird geladen …</p></div>
    </section>`;
}
