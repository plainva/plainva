/**
 * The sample vault of the Tasks query fixtures (plan Tasks-Abfragen, T0): five
 * notes under `vault/`, read the way `VaultQueryService.listTasks()` reads the
 * index — the note text through `scanTasks`, path, title, and the
 * `plainva.tasks: false` opt-out. Today is Thursday 2026-10-29, ISO week 44
 * (Monday 26 October to Sunday 1 November).
 *
 * The tasks, by the label the fixtures use (description without tags):
 *
 * - Projekte/Bahn.md, heading "Bahn-Projekt": Petition einreichen (open,
 *   #rettediebahn, due 10-30, high) with the subtasks Unterschriften zählen
 *   (open) and Text schreiben (done 10-20); Flyer drucken (done 10-25,
 *   #rettediebahn); Pressemitteilung (open, #presse, due 11-05); under
 *   "Termine": Treffen mit Verband (#rettediebahn, scheduled 10-28).
 * - Projekte/Haus.md, heading "Renovierung": Maler anrufen (due 10-27,
 *   highest), Angebote vergleichen (in progress, starts 10-26, medium),
 *   Teppich kaufen (cancelled 10-24), Dach prüfen (every year, due 2027-04-01,
 *   low), Keller aufräumen (lowest, starts 11-10).
 * - Inbox.md, no heading: Zahnarzt Termin (#privat), Steuer (due 2026-02-30 —
 *   an invalid date), Rechnung bezahlen (done 10-16, due 10-15, #finanzen),
 *   Wöchentlicher Bericht (every week, scheduled 11-02, created 10-01, #arbeit).
 * - Daily/2026-10-29.md, heading "Heute": Offene Todos sammeln (#rettediebahn),
 *   Buch zurückgeben (due today) — and the tester's query in a callout.
 * - Vorlagen/Vorlage.md, `plainva.tasks: false`: Vorlage-Aufgabe (#rettediebahn).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFrontmatterPath } from "../../../src/frontmatter-surgical.js";
import { scanTasks } from "../../../src/vault/taskScan.js";
import type { TaskRecord } from "../../../src/vault/VaultQueryService.js";
import { tasksQueryDescription } from "../../../src/tasksQuery/evaluate.js";

export const SAMPLE_TODAY = "2026-10-29";
export const SAMPLE_VAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "vault");

/** Every note of a folder, vault-relative paths with `/`, sorted. */
export function readVaultNotes(dir: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) out.push({ path: path.relative(dir, full).split(path.sep).join("/"), content: fs.readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The records `listTasks()` would return for these notes. */
export function taskRecordsOf(notes: ReadonlyArray<{ path: string; content: string }>): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const note of notes) {
    const scanned = scanTasks(note.content);
    if (scanned.length === 0) continue;
    const title = note.path.split("/").pop()!.replace(/\.md$/i, "");
    const excluded = readFrontmatterPath(note.content, ["plainva", "tasks"]) === false;
    for (const task of scanned) out.push({ path: note.path, title, excluded, ...task });
  }
  return out;
}

export function sampleTasks(): TaskRecord[] {
  return taskRecordsOf(readVaultNotes(SAMPLE_VAULT_DIR));
}

/** The label a fixture names a task by: its description without tags. */
export function taskLabel(task: Pick<TaskRecord, "text">): string {
  return tasksQueryDescription(task.text).replace(/(^|\s)#[^\s#]+/gu, "$1").replace(/\s{2,}/g, " ").trim();
}
