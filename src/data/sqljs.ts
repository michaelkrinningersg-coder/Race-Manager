import type { Database as SqlJsDatabase, Statement as SqlJsStatement, SqlValue } from 'sql.js';
import type { Database, Statement } from '../../engine/db';

/**
 * sql.js hinter der Engine-Schnittstelle (engine/db.ts).
 *
 * Damit laeuft die Engine im Browser - dieselbe, die unter Node die
 * Auslieferwelt rechnet, nicht eine zweite Fassung davon. Der Vorlaeufer
 * dieses Projekts hatte genau diesen Fehler gemacht: eine eigene Simulation im
 * Frontend, die mit der echten nichts zu tun hatte.
 *
 * Der Adapter ist klein, weil die Engine klein bleibt in dem, was sie von der
 * Datenbank verlangt: prepare/all/get/run, exec, transaction, ein pragma.
 *
 * DREI UNTERSCHIEDE muss er ausgleichen:
 *
 *  1. Vorbereitete Anweisungen. better-sqlite3 gibt ein Objekt mit all/get/run
 *     zurueck, sql.js einen Cursor mit bind/step/getAsObject/free. Vor allem
 *     muss `free()` laufen, sonst haelt jede Abfrage ihren Speicher fest -
 *     bei 177 Aufrufstellen und einer Saison mit 130 Rennwochenenden ist das
 *     kein theoretisches Leck.
 *
 *  2. Benannte Parameter. better-sqlite3 nimmt `{season: 1}` zu `@season`,
 *     sql.js verlangt den Praefix im Schluessel (`{'@season': 1}`). Der
 *     Adapter liest die Namen aus dem SQL und setzt den dort verwendeten
 *     Praefix - sonst bindet sql.js stillschweigend nichts und die Abfrage
 *     liefert leere Ergebnisse statt eines Fehlers.
 *
 *  3. Transaktionen. sql.js kennt keine, es gibt nur BEGIN/COMMIT als SQL.
 *     Verschachtelung braucht SAVEPOINT, weil die Engine transaktionale
 *     Funktionen aus transaktionalen Funktionen heraus aufruft.
 */

/** Namen benannter Parameter samt Praefix, in Reihenfolge des Vorkommens. */
function namedParameters(sql: string): string[] {
  // Zeichenketten ausblenden, damit ein '@' im Text nicht als Parameter gilt.
  const withoutLiterals = sql.replace(/'([^']|'')*'/g, "''");
  const found = withoutLiterals.match(/[@:$][A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return [...new Set(found)];
}

type Bindable = Record<string, SqlValue> | SqlValue[];

function bindingFor(sql: string, params: unknown[]): Bindable {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    const given = params[0] as Record<string, SqlValue>;
    const binding: Record<string, SqlValue> = {};
    for (const token of namedParameters(sql)) {
      const name = token.slice(1);
      if (name in given) binding[token] = given[name];
    }
    return binding;
  }
  return params as SqlValue[];
}

class SqlJsStatementAdapter implements Statement {
  private cached: SqlJsStatement | null = null;

  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string,
  ) {}

  /**
   * Bereitet einmal vor und setzt danach zurueck.
   *
   * Die erste Fassung bereitete je Aufruf neu vor - sicher, aber unbrauchbar:
   * Die Vorbereitung der ersten Saison schreibt fuer 167 Teams Bauteile,
   * Fahrer, Personal und Anlagen, und der Browser kam nach drei Minuten nicht
   * durch. `reset()` loescht Bindungen und Cursor, `bind()` setzt neu - damit
   * kann der wiederverwendete Cursor keine Zeilen der Vorabfrage liefern.
   */
  private run$<T>(params: unknown[], read: (statement: SqlJsStatement) => T): T {
    const statement = (this.cached ??= this.db.prepare(this.sql));
    statement.reset();
    const binding = bindingFor(this.sql, params);
    if (Array.isArray(binding) ? binding.length > 0 : Object.keys(binding).length > 0) {
      statement.bind(binding);
    }
    return read(statement);
  }

  all(...params: unknown[]): unknown[] {
    return this.run$(params, (statement) => {
      const result: unknown[] = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    });
  }

  get(...params: unknown[]): unknown {
    return this.run$(params, (statement) =>
      statement.step() ? statement.getAsObject() : undefined,
    );
  }

  run(...params: unknown[]): void {
    this.run$(params, (statement) => {
      statement.step();
    });
  }

  release(): void {
    this.cached?.free();
    this.cached = null;
  }
}

class SqlJsDatabaseAdapter implements Database {
  /** Schachtelungstiefe der Transaktionen - null heisst: keine offen. */
  private depth = 0;

  constructor(private readonly db: SqlJsDatabase) {}

  /**
   * Vorbereitete Anweisungen werden je SQL-Text wiederverwendet. Die Engine
   * bereitet in Schleifen vor - ohne diesen Zwischenspeicher entstuenden je
   * Saison zehntausende Cursor.
   */
  private readonly statements = new Map<string, SqlJsStatementAdapter>();

  prepare(sql: string): Statement {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = new SqlJsStatementAdapter(this.db, sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    const wrapped = (...args: never[]): unknown => {
      // Die aeusserste Transaktion ist eine echte, jede innere ein Savepoint.
      const level = this.depth;
      const name = `sp${level}`;
      this.db.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
      this.depth += 1;
      try {
        const result = fn(...args);
        this.db.exec(level === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (error) {
        this.db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
        throw error;
      } finally {
        this.depth = level;
      }
    };
    return wrapped as unknown as T;
  }

  pragma(source: string): unknown {
    this.db.exec(`PRAGMA ${source}`);
    return undefined;
  }

  close(): void {
    for (const statement of this.statements.values()) statement.release();
    this.statements.clear();
    this.db.close();
  }

  /** Bytes des aktuellen Standes - der Spielstand zum Sichern. */
  export(): Uint8Array {
    return this.db.export();
  }
}

export type EngineDatabase = Database & { export(): Uint8Array };

export function adapt(db: SqlJsDatabase): EngineDatabase {
  return new SqlJsDatabaseAdapter(db) as unknown as EngineDatabase;
}
