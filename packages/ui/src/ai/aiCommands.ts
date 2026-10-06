import { requestGraphTrail } from "../graph/graphTrail";
import { requestAnchorJump } from "../lib/anchorJump";
import { requestCalendarDay } from "../lib/calendarNav";
import type { AppCommand } from "../services/commandRegistry";
import type { AiNavigationCommand } from "./vaultTools";

/**
 * What the assistant can do in the app through `run_command` (ADR 0019, plan
 * KI-Harness §12.3): the commands of the ONE registry both palettes are built
 * from — never a list of its own — and of those only the ones that show or
 * arrange something. A shell that does not have a command does not offer it
 * to the assistant either; that asymmetry is the palette's, written down
 * where the palette's is (`MOBILE_ABSENT_COMMANDS`).
 *
 * The rule a command has to meet to be listed in `AI_COMMANDS`: running it
 * writes nothing — no file, no setting, no clipboard, no backup, no index, no
 * sync run, no message, nothing outside the app — and it opens no surface
 * whose next keystroke would create or change something. The user can leave
 * what it shows without consequence. Everything else stands in
 * `AI_WITHHELD_COMMANDS` with its reason; `aiCommands.test.ts` holds both
 * lists against the registry, so a command added there is decided here or the
 * commit fails. Absent must never mean forgotten.
 */

/** Commands the assistant may run, each with what it does, in the words a model reads. */
export const AI_COMMANDS: Readonly<Record<string, string>> = {
  "open-graph": "Open the graph view",
  "open-tasks": "Open the task list",
  "open-calendar": "Open the calendar; args: { date?: the day to show, YYYY-MM-DD }",
  "open-journal": "Open the journal",
  "open-mail": "Open mail",
  "open-comments": "Open the list of open comments",
  "open-file": "Open the file switcher, where the user types a note's name",
  "open-settings": "Open the settings",
  "show-shortcuts": "Show the keyboard shortcuts",
  "version-history": "Show the version history of the open note",
  "split-vertical": "Split the editor: a second pane to the right",
  "split-horizontal": "Split the editor: a second pane below",
  "toggle-left-sidebar": "Show or hide the left sidebar",
  "toggle-right-sidebar": "Show or hide the right sidebar",
  "focus-mode": "Switch focus mode on or off (both sidebars hidden)",
  "toggle-read-edit": "Switch the open note between reading and editing",
  "toggle-source": "Switch the open note between live preview and Markdown source",
  "reopen-tab": "Reopen the tab that was closed last",
};

/**
 * Why a command of the registry is not the assistant's to run:
 * - `creates`: it makes a file, a folder, a database or a template;
 * - `changes`: it writes — a file, a setting, the clipboard, a backup, the index, a sync run;
 * - `starts-change`: it opens a surface whose next input creates or changes something;
 * - `leaves-app`: it hands something to another program or to the system;
 * - `window`: it opens another window or another vault, or closes what the user looks at;
 * - `self`: it opens the assistant or starts a conversation.
 */
export type AiWithheldReason = "creates" | "changes" | "starts-change" | "leaves-app" | "window" | "self";

export const AI_WITHHELD_COMMANDS: Readonly<Record<string, AiWithheldReason>> = {
  "new-note": "creates",
  "new-note-from-template": "creates",
  // Opens today's note — and writes it from the template where there is none. An existing one opens with `open-note`.
  "daily-note": "creates",
  "new-folder": "creates",
  "new-base": "creates",
  "template-new": "creates",
  "template-from-note": "creates",
  "journal-entry": "starts-change",
  "new-event": "starts-change",
  "new-task": "starts-change",
  "insert-template": "starts-change",
  "rename-active": "starts-change",
  "import-pkm": "starts-change",
  // Search and replace across the vault: the door to a change of many notes. The assistant searches with its own tool.
  "find-replace-vault": "starts-change",
  "toggle-theme": "changes",
  "backup-now": "changes",
  // Reads the vault again — and syncs, on a synced vault.
  "refresh-vault": "changes",
  "rebuild-index": "changes",
  "update-indexes": "changes",
  "mail-copy-html": "changes",
  "mail-draft": "leaves-app",
  "mail-mailto": "leaves-app",
  print: "leaves-app",
  "export-markdown": "leaves-app",
  "open-comms-window": "window",
  "open-second-window": "window",
  "open-vault-window": "window",
  "switch-vault": "window",
  // Reversible, but it takes away what the user looks at — the conversation itself, when it runs as a tab.
  "close-tab": "window",
  "ask-ai": "self",
};

/** What the shell hands over: its palette's commands, and how it opens a note. */
export interface AiNavigationShell {
  /** The palette's commands as the shell builds them now; whether one is available is asked when it runs. */
  commands(): readonly AppCommand[];
  /** Opens a note or a database that exists, by its vault path. */
  openNote(path: string): void;
  /** A note as named — a path, a title, a link target — as its vault path; null when there is none. */
  resolveNote(target: string): Promise<string | null>;
  /** The notes linked with a note, for the graph's focus; absent in a shell without an index. */
  neighbors?(path: string, limit: number): Promise<readonly { path: string }[]>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The notes shown around a note in the graph, at most. */
const GRAPH_NEIGHBORS = 24;

/** The heading a section handle ends with: "Costs > 2026" names the heading "2026". */
function lastHeading(section: string): string {
  const parts = section.split(">");
  return (parts[parts.length - 1] ?? "").trim();
}

/**
 * The commands `run_command` offers in this shell, in the registry's order,
 * and the three that take an argument — a note to open, a note to show in the
 * graph, a day in the calendar. Built when it is asked for, so what a shell
 * cannot do now (no calendar connected, no note open) is not offered or says
 * so when it runs.
 */
export function aiNavigationCommands(shell: AiNavigationShell): AiNavigationCommand[] {
  const list: AiNavigationCommand[] = [];
  const registry = shell.commands();
  for (const command of registry) {
    const label = AI_COMMANDS[command.id];
    if (!label) continue;
    list.push({
      id: command.id,
      label,
      run: (args) => {
        if (command.isAvailable?.() === false) return false;
        // The day is parked before the calendar opens: a calendar that mounts now takes it, one that shows already hears it.
        if (command.id === "open-calendar" && typeof args?.date === "string" && DAY.test(args.date)) requestCalendarDay(args.date);
        command.run();
        return true;
      },
    });
  }
  list.push({
    id: "open-note",
    label: "Open a note or a database; args: { path: its vault-relative path, section?: a heading of the note to open it at }",
    run: async (args) => {
      const target = typeof args?.path === "string" ? args.path : "";
      // Only what exists: an unknown path would make a new tab — or an empty editor — of it.
      const path = target ? await shell.resolveNote(target) : null;
      if (!path) return false;
      shell.openNote(path);
      const heading = typeof args?.section === "string" ? lastHeading(args.section) : "";
      if (heading) requestAnchorJump(path, `#${heading}`);
      return true;
    },
  });
  // The graph takes a trail wherever the shell has a graph to open.
  if (registry.some((command) => command.id === "open-graph")) {
    list.push({
      id: "show-in-graph",
      label: "Show a note in the graph, with the notes it is linked with; args: { path: its vault-relative path }",
      run: async (args) => {
        const target = typeof args?.path === "string" ? args.path : "";
        const path = target ? await shell.resolveNote(target) : null;
        if (!path) return false;
        const linked = shell.neighbors ? await shell.neighbors(path, GRAPH_NEIGHBORS).catch(() => []) : [];
        requestGraphTrail({ seed: path, paths: [path, ...linked.map((n) => n.path).filter((p) => p !== path)] });
        return true;
      },
    });
  }
  return list;
}
