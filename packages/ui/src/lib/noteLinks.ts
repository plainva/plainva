import {
  buildNoteLinkUrl,
  chooseLinkVault,
  noteLinkAnchor,
  noteLinkNameCandidates,
  parseNoteLinkUrl,
  type LinkVault,
  type NoteLinkTarget,
} from "@plainva/core";
import i18n from "../i18n";
import { logDiagnostic } from "../services/diagnosticsLog";
import { toast } from "../services/toastStore";
import { resolveOpenAction } from "./openTarget";

/**
 * Where a `plainva://open?…` address goes once it reached the app (ADR 0037) —
 * the same way for every route in, in both shells:
 *
 *   - from the system: a deep link the desktop's Rust side or the phone's
 *     Capacitor `appUrlOpen` received;
 *   - from inside: a link clicked in a note, a mail, an event or a task —
 *     every one of them ends in a shell's `openExternal`, whose guard
 *     (`guardedExternalOpener`) hands a Plainva address here instead of to
 *     the system.
 *
 * An address waits in this inbox until a shell has a vault open and has said
 * how it opens a note (`setNoteLinkHandler`). That is the cold start: the
 * system starts Plainva for a link, and the vault loads after it arrived.
 */

const MAX_WAITING = 8;

interface Waiting {
  url: string;
  /** Set once the person agreed to switch to the vault it names: never asked twice. */
  switched: boolean;
}

let waiting: Waiting[] = [];
let handler: ((url: string, switched: boolean) => void) | null = null;

/** An address for the app to open. Kept until a shell can open it. */
export function deliverNoteLink(url: string): void {
  if (handler) {
    handler(url, false);
    return;
  }
  waiting = [...waiting, { url, switched: false }].slice(-MAX_WAITING);
}

/**
 * The shell's way to open a note link, registered while a vault is open (and
 * again for each vault it switches to). Addresses that waited are opened now.
 * Returns the unregister function.
 */
export function setNoteLinkHandler(next: (url: string, switched: boolean) => void): () => void {
  handler = next;
  const queued = waiting;
  waiting = [];
  for (const entry of queued) next(entry.url, entry.switched);
  return () => {
    if (handler === next) handler = null;
  };
}

/** Parks an address until the vault it names is open (after the switch the person agreed to). */
function waitForVault(url: string): void {
  waiting = [...waiting, { url, switched: true }].slice(-MAX_WAITING);
}

/** For tests: forget everything. */
export function resetNoteLinkInbox(): void {
  waiting = [];
  handler = null;
}

/** What a shell tells `openNoteLink` about itself. `K` is how it keys a vault (a folder, an id). */
export interface NoteLinkShell<K> {
  /** The vault this window shows, or `null`. */
  shownVault: LinkVault<K> | null;
  /** Every vault this device knows (the shown one may be among them). */
  knownVaults: () => Promise<readonly LinkVault<K>[]>;
  /** Asks whether to switch to another vault. Never switch without it. */
  confirmSwitch: (vaultName: string) => Promise<boolean>;
  /**
   * Switches. The link waits and is opened by the handler of the new vault;
   * `false` says the switch did not happen (the person kept unsaved work),
   * and the link is dropped rather than opened by some later switch.
   */
  switchVault: (key: K) => Promise<boolean | void> | boolean | void;
  /** Whether a vault path is a file in the open vault. */
  exists: (path: string) => Promise<boolean>;
  /** The link rule (ADR 0027): where a name leads in the open vault, or `null`. */
  resolveName: (name: string) => Promise<string | null>;
  /** Shows the note; `anchor` is a heading text or `^id` for the anchor jump. */
  openNote: (path: string, anchor: string | null) => void;
}

export type NoteLinkOutcome =
  | "opened"
  | "invalid"
  | "vault-unknown"
  | "vault-ambiguous"
  | "declined"
  | "switching"
  | "not-found"
  | "not-openable";

/**
 * Opens what an address names, or says in one sentence why not. Nothing else
 * happens: an address cannot create a note, write, run or reach the system.
 */
export async function openNoteLink<K>(url: string, shell: NoteLinkShell<K>, switched = false): Promise<NoteLinkOutcome> {
  const parsed = parseNoteLinkUrl(url);
  if (!parsed.ok) {
    logDiagnostic("note-link", `refused an address (${parsed.reason})`);
    toast.warning(i18n.t("noteLink.invalid"));
    return "invalid";
  }
  const target = parsed.target;
  const choice = chooseLinkVault(target.vault, shell.shownVault, await shell.knownVaults().catch(() => []));
  if (choice.kind === "unknown") {
    toast.warning(target.vault ? i18n.t("noteLink.vaultUnknown", { name: target.vault }) : i18n.t("noteLink.noVault"));
    return "vault-unknown";
  }
  if (choice.kind === "ambiguous") {
    toast.warning(i18n.t("noteLink.vaultAmbiguous", { name: target.vault }));
    return "vault-ambiguous";
  }
  if (choice.kind === "switch") {
    // Agreed once already, and the vault is not shown yet: the old vault
    // registered again while the switch runs. The link keeps waiting for the
    // vault it names — it is never asked about twice.
    if (switched) {
      waitForVault(url);
      return "switching";
    }
    if (!(await shell.confirmSwitch(choice.vault.name))) return "declined";
    waitForVault(url);
    const went = await shell.switchVault(choice.vault.key);
    if (went === false) {
      waiting = waiting.filter((entry) => entry.url !== url);
      return "declined";
    }
    return "switching";
  }
  const path = await resolveNoteLinkTarget(target, shell);
  if (!path) {
    toast.warning(i18n.t("noteLink.notFound", { name: target.path.split("/").pop() ?? target.path }));
    return "not-found";
  }
  // A link opens what Plainva shows itself — a note, a database, an image, a
  // text file — never a file the system would RUN (`.exe`, `.sh`, …).
  if (resolveOpenAction(path) === "external") {
    toast.warning(i18n.t("noteLink.notOpenable"));
    return "not-openable";
  }
  shell.openNote(path, noteLinkAnchor(target));
  return "opened";
}

/** The path as written, else where the link rule leads its names — the note was moved or renamed. */
async function resolveNoteLinkTarget<K>(target: NoteLinkTarget, shell: NoteLinkShell<K>): Promise<string | null> {
  if (await shell.exists(target.path).catch(() => false)) return target.path;
  for (const name of noteLinkNameCandidates(target.path)) {
    const found = await shell.resolveName(name).catch(() => null);
    if (found) return found;
  }
  return null;
}

/** The text "Copy link" puts on the clipboard for a note, a heading or a block. */
export function noteLinkUrlFor(vaultName: string | null, path: string, anchor?: { heading?: string; block?: string }): string {
  return buildNoteLinkUrl({ vault: vaultName && vaultName.trim() ? vaultName : null, path, ...(anchor ?? {}) });
}

/**
 * "Copy link" of a file: its address onto the clipboard. A path Plainva
 * would not open from an address (an internal folder) gets no link, and the
 * person is told — never an exception out of a menu entry.
 */
export async function copyNoteLink(vaultName: string | null, path: string, anchor?: { heading?: string; block?: string }): Promise<boolean> {
  let url: string;
  try {
    url = noteLinkUrlFor(vaultName, path, anchor);
  } catch {
    toast.warning(i18n.t("noteLink.invalid"));
    return false;
  }
  return copyLinkText(url);
}

/**
 * Puts a link on the clipboard and says so. Both shells copy through here, so
 * a failed copy (a WebView without clipboard permission) reads the same.
 */
export async function copyLinkText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(i18n.t("noteLink.copied"));
    return true;
  } catch {
    toast.error(i18n.t("contextMenu.copyFailed"));
    return false;
  }
}

/**
 * A note link as a Markdown link, for a text that is Markdown but no note —
 * an event's description: `[Title](plainva://open?…)`. Brackets and
 * backslashes of the title are escaped, so the label cannot end the link.
 */
export function noteLinkMarkdown(title: string, url: string): string {
  const label = title.replace(/[\\[\]]/g, (c) => "\\" + c).replace(/\s+/g, " ").trim() || url;
  return `[${label}](${url})`;
}

/** `text` with `line` appended on a line of its own. */
export function appendLine(text: string, line: string): string {
  if (text.trim() === "") return line;
  return `${text.trimEnd()}\n\n${line}`;
}
