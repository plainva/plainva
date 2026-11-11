import {
  buildNoteLinkUrl,
  chooseLinkVault,
  contentPathRefusal,
  isHiddenPath,
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
 * It waits a minute at most while the app could take it, and only one
 * question about links is ever open at a time.
 */

/**
 * How long an address waits for a vault to take it, counted only while the
 * app could take it — no vault loading. A cold start (the system starts
 * Plainva for a link, the vault loads after it) loses nothing; a link that
 * came while no vault was open does not open one some later afternoon.
 */
export const NOTE_LINK_LIFETIME_MS = 60_000;
const MAX_WAITING = 8;

interface Waiting {
  url: string;
  /** Set once the person agreed to switch to the vault it names: never asked twice. */
  switched: boolean;
  /** Milliseconds it waited while a vault could have taken it. */
  waited: number;
  /** When it was parked — a link waiting for a switch the person agreed to runs on this clock alone. */
  parkedAt: number;
}

/**
 * A link the person just agreed to switch vaults for does not expire while
 * that switch runs, however long a large vault takes to open — only a switch
 * that never came lets it go, after this long.
 */
const SWITCH_LIFETIME_MS = 15 * 60_000;

let waiting: Waiting[] = [];
let handler: ((url: string, switched: boolean) => void) | null = null;
/** True until a shell says it is ready: before that, no clock runs. */
let vaultLoading = true;
let clock: () => number = () => Date.now();
let clockMark = clock();
/** Whether the person was already told, for the question that is open, that a link waits for its answer. */
let toldToAnswer = false;
/** A question (switch, open here) is open: further links are dropped, not queued behind it. */
let asking = false;
/** Addresses being opened right now: the same one again is the same click, not a second one. */
const inFlight = new Set<string>();

/** Advances the waiting clocks and lets go of what waited too long — silently. */
function tick(): void {
  const at = clock();
  if (!vaultLoading) for (const entry of waiting) if (!entry.switched) entry.waited += at - clockMark;
  clockMark = at;
  const before = waiting.length;
  waiting = waiting.filter((entry) => (entry.switched ? at - entry.parkedAt <= SWITCH_LIFETIME_MS : entry.waited <= NOTE_LINK_LIFETIME_MS));
  if (waiting.length < before) logDiagnostic("note-link", `dropped ${before - waiting.length} address(es) nobody took in time`);
}

function park(url: string, switched: boolean): void {
  tick();
  if (waiting.some((entry) => entry.url === url)) return;
  waiting = [...waiting, { url, switched, waited: 0, parkedAt: clock() }].slice(-MAX_WAITING);
}

/**
 * Whether a vault is loading (or none is open yet and one may come): the
 * waiting clock stands still. Both shells say `false` once a vault is shown,
 * or once the start ended without one.
 */
export function setNoteLinksVaultLoading(loading: boolean): void {
  tick();
  vaultLoading = loading;
}

/** An address for the app to open. Kept until a shell can open it. */
export function deliverNoteLink(url: string): void {
  if (handler) {
    handler(url, false);
    return;
  }
  park(url, false);
}

/**
 * The shell's way to open a note link, registered while a vault is open (and
 * again for each vault it switches to). Addresses that waited are opened now.
 * Returns the unregister function.
 */
export function setNoteLinkHandler(next: (url: string, switched: boolean) => void): () => void {
  tick();
  handler = next;
  const queued = waiting;
  waiting = [];
  for (const entry of queued) next(entry.url, entry.switched);
  return () => {
    if (handler === next) handler = null;
  };
}

/** For tests: forget everything; `now` replaces the clock. */
export function resetNoteLinkInbox(now?: () => number): void {
  waiting = [];
  handler = null;
  asking = false;
  toldToAnswer = false;
  inFlight.clear();
  clock = now ?? (() => Date.now());
  clockMark = clock();
  vaultLoading = true;
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
   * Asks whether to open the note in the vault that is shown, when the vault
   * the address names is not on this device (or not by that name).
   */
  confirmOpenHere: (vaultName: string, notePath: string, ambiguous: boolean) => Promise<boolean>;
  /**
   * Switches. The link waits and is opened by the handler of the new vault;
   * `false` says the switch did not happen (the person kept unsaved work),
   * and the link is dropped rather than opened by some later switch.
   */
  switchVault: (key: K) => Promise<boolean | void> | boolean | void;
  /**
   * Whether a vault path is a file the open vault's INDEX holds. Never the
   * disk: the index holds real, visible spellings only, so `.Plainva/x`,
   * `PLAINV~1/x` or `NUL` never match there.
   */
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
  | "not-openable"
  | "busy";

/** Asks one question at a time; `null` when another one is open (the link is dropped). */
async function askOnce(question: () => Promise<boolean>): Promise<boolean | null> {
  if (asking) return null;
  asking = true;
  toldToAnswer = false;
  try {
    return await question();
  } finally {
    asking = false;
  }
}

/** Whether a path the shell found may be opened by a link: what Plainva shows itself, nothing hidden, nothing the system runs. */
function openableByLink(path: string): boolean {
  if (isHiddenPath(path)) return false;
  // The path came from the index or the link rule: a real spelling of this vault.
  if (contentPathRefusal(path) === "internal") return false;
  return resolveOpenAction(path) !== "external";
}

const noteNameOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/**
 * Opens what an address names, or says in one sentence why not. Nothing else
 * happens: an address cannot create a note, write, run or reach the system.
 */
export async function openNoteLink<K>(url: string, shell: NoteLinkShell<K>, switched = false): Promise<NoteLinkOutcome> {
  // A burst of the same address (a double click, a flood from outside) opens once.
  if (inFlight.has(url) || asking) {
    logDiagnostic("note-link", asking ? "dropped an address while a question was open" : "dropped a repeated address");
    // Once per open question: a second click is told why nothing happens; a flood after it is not.
    if (asking && !inFlight.has(url) && !toldToAnswer) {
      toldToAnswer = true;
      toast.info(i18n.t("noteLink.answerFirst"));
    }
    return "busy";
  }
  inFlight.add(url);
  try {
    return await openNoteLinkOnce(url, shell, switched);
  } finally {
    inFlight.delete(url);
  }
}

async function openNoteLinkOnce<K>(url: string, shell: NoteLinkShell<K>, switched: boolean): Promise<NoteLinkOutcome> {
  const parsed = parseNoteLinkUrl(url);
  if (!parsed.ok) {
    logDiagnostic("note-link", `refused an address (${parsed.reason})`);
    toast.warning(i18n.t("noteLink.invalid"));
    return "invalid";
  }
  const target = parsed.target;
  const choice = chooseLinkVault(target.vault, shell.shownVault, await shell.knownVaults().catch(() => []));
  if (choice.kind === "unknown" || choice.kind === "ambiguous") {
    // The same vault often has another name on the other device (the phone's
    // built-in vault is even named by the language). Where the note is in the
    // vault that is shown, the person is asked — never opened silently.
    if (target.vault && shell.shownVault) {
      const here = await resolveNoteLinkTarget(target, shell);
      if (here && openableByLink(here)) {
        // The path of the note that will open: the link rule may lead to another folder than the address named.
        const yes = await askOnce(() => shell.confirmOpenHere(target.vault!, here, choice.kind === "ambiguous"));
        if (yes === null) return "busy";
        if (!yes) return "declined";
        shell.openNote(here, noteLinkAnchor(target));
        return "opened";
      }
    }
    if (choice.kind === "ambiguous") {
      toast.warning(i18n.t("noteLink.vaultAmbiguous", { name: target.vault }));
      return "vault-ambiguous";
    }
    toast.warning(target.vault ? i18n.t("noteLink.vaultUnknown", { name: target.vault }) : i18n.t("noteLink.noVault"));
    return "vault-unknown";
  }
  if (choice.kind === "switch") {
    // Agreed once already, and the vault is not shown yet: the old vault
    // registered again while the switch runs. The link keeps waiting for the
    // vault it names — it is never asked about twice.
    if (switched) {
      park(url, true);
      return "switching";
    }
    const yes = await askOnce(() => shell.confirmSwitch(choice.vault.name));
    if (yes === null) return "busy";
    if (!yes) return "declined";
    park(url, true);
    const went = await shell.switchVault(choice.vault.key);
    if (went === false) {
      waiting = waiting.filter((entry) => entry.url !== url);
      return "declined";
    }
    return "switching";
  }
  const path = await resolveNoteLinkTarget(target, shell);
  if (!path) {
    toast.warning(i18n.t("noteLink.notFound", { name: noteNameOf(target.path) }));
    return "not-found";
  }
  // Checked again on the path that is opened, after the link rule led there:
  // a link opens what Plainva shows itself — never a hidden or internal file,
  // never one the system would RUN (`.exe`, `.sh`, …).
  if (!openableByLink(path)) {
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
