import { setPimTraceSink, type PimTaskTrace } from "@plainva/core";

/**
 * The task trace's shell side (finding 2026-09-19): a device switch, a small
 * buffer, and the section it adds to the diagnostics export.
 *
 * The switch is OFF unless somebody turns it on, and it is meant to be turned
 * off again: it exists to answer one question with the provider's own rows
 * ("what does the API return for a recurring task before and after I tick it
 * off elsewhere?"), not to run forever. The buffer survives a restart - on a
 * phone the app may well be gone between the two syncs the comparison needs -
 * and turning the switch off empties it.
 *
 * What is kept is what core/pimTrace.ts lets through: identity, state, dates,
 * revision, a title cut to a few characters plus its hash. No notes, no tokens.
 */

const FLAG_KEY = "plainva-pim-trace";
const LOG_KEY = "plainva-pim-trace-log";
/** Pulls kept. A comparison needs two per list; the rest is headroom for several lists. */
const MAX_TRACES = 24;
/** Rows kept per pull - a list longer than this is cut, and the export says so. */
const MAX_ROWS = 400;
/** Pages of ONE pull arrive within moments of each other and are one trace. */
const SAME_PULL_MS = 10_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readLog(): PimTaskTrace[] {
  try {
    const raw = storage()?.getItem(LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PimTaskTrace[]) : [];
  } catch {
    return [];
  }
}

function writeLog(log: PimTaskTrace[]): void {
  try {
    storage()?.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* a full or blocked store loses the trace, never the sync */
  }
}

/** Adds one page of a pull. Exported for the test; the sink below is its only caller. */
export function recordPimTrace(trace: PimTaskTrace): void {
  const log = readLog();
  const last = log[log.length - 1];
  if (last && last.provider === trace.provider && last.listId === trace.listId && trace.at - last.at < SAME_PULL_MS) {
    last.rows = [...last.rows, ...trace.rows].slice(0, MAX_ROWS);
  } else {
    log.push({ ...trace, rows: trace.rows.slice(0, MAX_ROWS) });
  }
  writeLog(log.slice(-MAX_TRACES));
}

export function isPimTraceEnabled(): boolean {
  return storage()?.getItem(FLAG_KEY) === "on";
}

/** Turns the trace on or off. Off also forgets what was recorded. */
export function setPimTraceEnabled(on: boolean): void {
  const store = storage();
  if (on) store?.setItem(FLAG_KEY, "on");
  else {
    store?.removeItem(FLAG_KEY);
    store?.removeItem(LOG_KEY);
  }
  setPimTraceSink(on ? recordPimTrace : null);
}

/** Re-installs the listener after a start when the switch was left on. */
export function initPimTrace(): void {
  setPimTraceSink(isPimTraceEnabled() ? recordPimTrace : null);
}

const COLUMNS = ["id", "status", "hidden", "deleted", "due", "completed", "updated", "etag", "parent", "position", "title", "titleHash"] as const;

/** The export's section, or nothing while the switch is off and the buffer empty. */
export function formatPimTraceExport(): string[] {
  const log = readLog();
  if (!isPimTraceEnabled() && log.length === 0) return [];
  const lines = [
    "",
    "## Aufgaben-Rohdaten (Diagnose-Schalter)",
    "",
    "Die Zeilen eines Abrufs, wie der Anbieter sie geliefert hat: Kennung, Status, Daten, Revision. Keine Notizen, keine Zugangsdaten; Titel auf 16 Zeichen gekürzt, daneben ein Hash des ganzen Titels.",
  ];
  if (log.length === 0) lines.push("", "(noch kein Abruf aufgezeichnet - einmal abgleichen)");
  for (const trace of log) {
    lines.push("", `### ${trace.provider} · Liste ${trace.listId} · ${new Date(trace.at).toISOString()} · ${trace.rows.length} Zeilen${trace.rows.length >= MAX_ROWS ? " (gekürzt)" : ""}`, "");
    lines.push(`| ${COLUMNS.join(" | ")} |`, `|${COLUMNS.map(() => "---").join("|")}|`);
    for (const row of trace.rows) {
      const cells = COLUMNS.map((column) => {
        const value = (row as unknown as Record<string, unknown>)[column];
        return value === undefined ? "" : String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
      });
      lines.push(`| ${cells.join(" | ")} |`);
    }
  }
  return lines;
}
