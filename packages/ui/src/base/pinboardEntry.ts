import { deleteFrontmatterPath, readFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import { finalizeItemContent } from "../lib/newItemContent";
import { resolveNewItemTarget } from "./baseRelations";
import { viewPrefill } from "./newItemPrefill";
import { captureFileName, captureTimestampName } from "./pinboardModel";

/**
 * A new pinboard entry — ONE core for both shells (plan Befunde 2026-09-24,
 * E14–E16).
 *
 * The board used to have two capture paths that had drifted apart: the
 * desktop's `quickCapture` and the phone's `captureBaseItem`. The phone wrote
 * its own frontmatter literal and dropped the ACTIVE labels (a note captured
 * under a label filter vanished from the board it was captured on), the
 * desktop ignored the view's `==` filters; neither read the default template,
 * and with several folder sources the phone silently took the first.
 *
 * The entry is written by the real editor now, and an editor needs a FILE —
 * images are stored relative to the note, links complete against its folder.
 * So the core splits in two:
 *
 *  - `planPinboardEntry` creates the draft in the target folder the moment the
 *    entry opens, with a timestamp name, the default template's body (its
 *    questions asked before anything is written) and everything the board
 *    requires of its members: source tags, the active labels, the view's
 *    filters. What was inherited on top of membership comes back as removable
 *    chips.
 *  - `finalizePinboardEntry` ends it: an entry nobody wrote into is removed
 *    again, anything else keeps its content — a typed title becomes `# Title`
 *    (never twice) and the file name, through the shell's link-safe rename, so
 *    a draft that was already uploaded arrives on the other devices as a move.
 *    Closing (X, Escape, the back key) NEVER throws away what was typed; only
 *    "Discard" does, after a question, and into the trash.
 *
 * Pure except for the injected file operations; no React, no settings.
 */

/** One inherited value the person can take off again before saving. */
export interface PinboardEntryChip {
  /** Stable key for the list and for `removedChips`. */
  id: string;
  /** `tag`: a value of `tags`. `value`: a value of the property `key`. */
  kind: "tag" | "value";
  /** Frontmatter key the value lives in (`tags` for a tag). */
  key: string;
  value: string;
  /** Where it came from: an active label chip of the board or a filter of the view. */
  from: "label" | "filter";
}

export interface PinboardDraft {
  /** Vault-relative path of the draft (timestamp name until it gets a title). */
  path: string;
  /** Vault-relative folder, "" for the vault root. */
  folder: string;
  /** File name without `.md` — the timestamp. */
  stem: string;
  /** The content as written at creation; "untouched" compares against it. */
  initial: string;
  /** Caret offset in `initial` from the template's `{{cursor}}`, or null. */
  caret: number | null;
  /** Inherited values beyond membership, shown as removable chips. */
  chips: PinboardEntryChip[];
}

/** The shell's file operations — each one its normal write path. */
export interface PinboardEntryFiles {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  /**
   * Renames within the folder through the shell's link-safe path, so the
   * change travels as a move. Resolves to the new path.
   */
  rename(path: string, stem: string): Promise<string>;
  /** Removes the draft through the shell's ordinary delete (the trash on the desktop). */
  remove(path: string): Promise<void>;
}

export type PinboardEntryPlan =
  | { status: "ask-folder"; mode: "setup" | "choice" }
  | { status: "cancelled" }
  | { status: "ready"; draft: PinboardDraft };

export interface PlanPinboardEntryOptions {
  config: any;
  viewIndex: number;
  /** The board's active label chips. */
  activeLabels: readonly string[];
  /** Null in tags mode; otherwise the multiselect property the board labels by. */
  labelProperty: string | null;
  /** The folder the storage question just answered, while the config has not caught up. */
  folder?: string | null;
  noteType: string;
  now: Date;
  /** Further frontmatter the shell requires (the relation of a scoped, embedded board). */
  extraPrefills?: Record<string, unknown>;
  /** Column input lookup that types the filter values; defaults to the config's columns. */
  getInput?: (column: string) => string | undefined;
  /**
   * The base's default template, resolved by the shell WITH its questions.
   * `undefined` = no template (the entry starts empty); `null` = the person
   * cancelled the questions, and nothing is created.
   */
  template?: (ctx: { title: string; folder: string }) => Promise<{ text: string; caret: number | null } | null | undefined>;
}

const withDir = (folder: string, stem: string) => (folder ? `${folder}/${stem}.md` : `${stem}.md`);

/**
 * The property a board labels by, or null in tags mode — read from the view
 * the same way the chip bar of both shells reads it.
 */
export function pinboardLabelProperty(view: any): string | null {
  const raw = typeof view?.pinboardFilterBy === "string" ? view.pinboardFilterBy : "tags";
  return raw !== "tags" ? raw.replace(/^note\./, "") : null;
}

function cleanFolder(folder: string): string {
  let start = 0;
  let end = folder.length;
  while (start < end && (folder[start] === "/" || folder[start] === "\\")) start++;
  while (end > start && (folder[end - 1] === "/" || folder[end - 1] === "\\")) end--;
  return folder.slice(start, end).trim();
}

/** Offset where the body starts, after a leading frontmatter block (0 when there is none). */
export function frontmatterEndOf(content: string): number {
  const first = content.startsWith("---\r\n") ? 5 : content.startsWith("---\n") ? 4 : -1;
  if (first < 0) return 0;
  let from = first - 1;
  for (;;) {
    const at = content.indexOf("\n---", from);
    if (at < 0) return 0;
    const after = at + 4;
    if (after === content.length) return after;
    if (content[after] === "\n") return after + 1;
    if (content[after] === "\r" && content[after + 1] === "\n") return after + 2;
    from = at + 1;
  }
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined || value === null || value === "" ? [] : [String(value)];
}

/** Creates the draft of a new pinboard entry; see the module comment. */
export async function planPinboardEntry(files: PinboardEntryFiles, opts: PlanPinboardEntryOptions): Promise<PinboardEntryPlan> {
  const target = resolveNewItemTarget(opts.config);
  const answered = opts.folder != null ? cleanFolder(opts.folder) : null;
  const folder = answered ?? (target.folder != null ? cleanFolder(target.folder) : null);
  // Several folder sources are a question on BOTH shells — the phone used to
  // take the first one without saying so.
  if (folder === null) return { status: "ask-folder", mode: target.pending === "choice" ? "choice" : "setup" };

  const base = captureTimestampName(opts.now);
  let stem = base;
  for (let n = 2; await files.exists(withDir(folder, stem)).catch(() => false); n++) stem = `${base} ${n}`;
  const path = withDir(folder, stem);

  const template = opts.template ? await opts.template({ title: stem, folder }) : undefined;
  if (template === null) return { status: "cancelled" };

  // Membership first (the source tags are never offered for removal), then
  // what the board narrows by: the active labels and the view's filters.
  const inherited = viewPrefill(opts.config, opts.viewIndex, opts.getInput);
  const labels = opts.activeLabels.map((l) => String(l).replace(/^#/, "")).filter(Boolean);
  const labelTags = opts.labelProperty ? [] : labels;
  const tags = [...target.inheritTags];
  for (const tag of [...labelTags, ...inherited.tags]) if (!tags.includes(tag)) tags.push(tag);
  const props: Record<string, unknown> = { ...inherited.props };
  if (opts.labelProperty && labels.length > 0) {
    const merged = listOf(props[opts.labelProperty]);
    for (const l of labels) if (!merged.includes(l)) merged.push(l);
    props[opts.labelProperty] = merged;
  }
  Object.assign(props, opts.extraPrefills ?? {});

  const body = template?.text ?? "";
  const initial = finalizeItemContent(body, opts.noteType, tags, props);
  // `{{cursor}}` is measured in the template. The template's body text comes
  // through unchanged at the END of the note — only the frontmatter in front
  // of it is rewritten — so the caret is measured from where that text starts
  // in the note, not from the end of the new frontmatter: writing the OKF
  // header can put a blank line in between, and a block the frontmatter
  // reader does not take as one ends up in front of the body as well.
  let caret: number | null = null;
  if (template && template.caret !== null) {
    const bodyInTemplate = frontmatterEndOf(body);
    const bodyText = body.slice(bodyInTemplate);
    const bodyStart = initial.endsWith(bodyText) ? initial.length - bodyText.length : frontmatterEndOf(initial);
    caret = Math.min(initial.length, bodyStart + Math.max(0, template.caret - bodyInTemplate));
  }

  // Chips only for what actually landed — a template key wins over a filter,
  // and a chip for a value the note does not carry would lie.
  const chips: PinboardEntryChip[] = [];
  const add = (chip: Omit<PinboardEntryChip, "id">) => {
    const id = `${chip.kind}:${chip.key}:${chip.value}`;
    if (!chips.some((c) => c.id === id)) chips.push({ ...chip, id });
  };
  const written = (key: string) => listOf(readFrontmatterPath(initial, [key]));
  const source = new Set(target.inheritTags);
  for (const tag of [...labelTags, ...inherited.tags]) {
    if (source.has(tag) || !written("tags").includes(tag)) continue;
    add({ kind: "tag", key: "tags", value: tag, from: labelTags.includes(tag) ? "label" : "filter" });
  }
  for (const [key, value] of Object.entries(props)) {
    if (opts.extraPrefills && key in opts.extraPrefills) continue;
    const present = written(key);
    for (const v of listOf(value)) {
      if (!present.includes(v)) continue;
      const fromLabel = key === opts.labelProperty && labels.includes(v);
      add({ kind: "value", key, value: v, from: fromLabel ? "label" : "filter" });
    }
  }

  await files.write(path, initial);
  return { status: "ready", draft: { path, folder, stem, initial, caret, chips } };
}

/**
 * What a draft holds right now:
 *  - `blank`: no title and nothing in the body;
 *  - `untouched`: no title and exactly what was created (e.g. a template
 *    nobody wrote into);
 *  - `content`: anything a person typed.
 */
export type PinboardDraftState = "blank" | "untouched" | "content";

export function pinboardDraftState(current: string, initial: string, title: string): PinboardDraftState {
  if (title.trim()) return "content";
  if (current.slice(frontmatterEndOf(current)).trim() === "") return "blank";
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
  return norm(current) === norm(initial) ? "untouched" : "content";
}

const STATE_WEIGHT: Record<PinboardDraftState, number> = { blank: 0, untouched: 1, content: 2 };

/**
 * The state of the file AND of the editor's live text, whichever holds more.
 * A keystroke whose save has not landed yet must never read as "nothing was
 * typed" — that is the one way closing could lose text.
 */
function draftStateOf(current: string, live: string | undefined, initial: string, title: string): PinboardDraftState {
  const onDisk = pinboardDraftState(current, initial, title);
  if (live === undefined) return onDisk;
  const inEditor = pinboardDraftState(live, initial, title);
  return STATE_WEIGHT[inEditor] > STATE_WEIGHT[onDisk] ? inEditor : onDisk;
}

function leadingH1(body: string): { start: number; end: number; text: string } | null {
  let i = 0;
  while (i < body.length) {
    const nl = body.indexOf("\n", i);
    const lineEnd = nl < 0 ? body.length : nl;
    const line = body.slice(i, lineEnd);
    if (line.trim() === "") {
      if (nl < 0) return null;
      i = nl + 1;
      continue;
    }
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!clean.startsWith("# ") && !clean.startsWith("#\t")) return null;
    return { start: i, end: i + clean.length, text: clean.slice(2).trim() };
  }
  return null;
}

/**
 * Puts the typed title on the note: `# Title` at the top of the body — never a
 * second one. A heading that mirrors the draft's timestamp name (a template's
 * `# {{title}}`) is taken over, so is a frontmatter `title` that mirrors it.
 * Without a title the content stays as it is.
 */
export function applyPinboardEntryTitle(content: string, title: string, stem: string): string {
  const t = title.trim();
  if (!t) return content;
  let next = content;
  try {
    if (frontmatterEndOf(next) > 0 && readFrontmatterPath(next, ["title"]) === stem) next = setFrontmatterPath(next, ["title"], t);
  } catch {
    /* unparseable frontmatter: leave it alone, the heading still carries the title */
  }
  const bodyStart = frontmatterEndOf(next);
  const head = next.slice(0, bodyStart);
  const body = next.slice(bodyStart);
  const h1 = leadingH1(body);
  if (h1 && h1.text === t) return next;
  if (h1 && h1.text === stem) return head + body.slice(0, h1.start) + `# ${t}` + body.slice(h1.end);
  let rest = body;
  while (rest.startsWith("\n") || rest.startsWith("\r\n")) rest = rest.slice(rest.startsWith("\r\n") ? 2 : 1);
  return head + `# ${t}\n` + (rest.trim() ? `\n${rest}` : "");
}

/** Takes the chips the person removed off the note again. */
export function removePinboardEntryChips(content: string, removed: readonly PinboardEntryChip[]): string {
  let next = content;
  for (const chip of removed) {
    try {
      const current = readFrontmatterPath(next, [chip.key]);
      if (Array.isArray(current)) {
        const kept = current.filter((v) => String(v) !== chip.value);
        if (kept.length === current.length) continue;
        next = kept.length > 0 ? setFrontmatterPath(next, [chip.key], kept) : deleteFrontmatterPath(next, [chip.key]);
      } else if (current !== undefined && String(current) === chip.value) {
        next = deleteFrontmatterPath(next, [chip.key]);
      }
    } catch {
      /* unparseable frontmatter: the chip stays — nothing is guessed */
    }
  }
  return next;
}

export interface FinalizePinboardEntryOptions {
  draft: PinboardDraft;
  title: string;
  /** Chips the person took off. */
  removedChips?: readonly PinboardEntryChip[];
  /**
   * `save`: the person saved — an untouched template is kept.
   * `close`: the window closed (X, Escape, back) — an untouched draft goes.
   * Neither ever throws away something that was typed.
   */
  intent: "save" | "close";
  /**
   * The editor's text right now, when the shell has it. The draft is removed
   * only when the file AND this are empty — see `draftStateOf`.
   */
  live?: string;
}

export interface PinboardEntryResult {
  /** `removed`: nothing was written into the draft, it is gone again. */
  outcome: "removed" | "kept";
  /** Where the entry lives now (null when removed). */
  path: string | null;
  /** The title could not become the file name (a name taken in the meantime); the entry kept its timestamp name. */
  renameFailed?: boolean;
}

/** Ends an entry; see the module comment. The shell flushes its editor first. */
export async function finalizePinboardEntry(files: PinboardEntryFiles, opts: FinalizePinboardEntryOptions): Promise<PinboardEntryResult> {
  const { draft, title } = opts;
  let current: string;
  try {
    current = await files.read(draft.path);
  } catch {
    // Gone already (deleted elsewhere, or moved by the person): nothing to end.
    return { outcome: "removed", path: null };
  }
  const state = draftStateOf(current, opts.live, draft.initial, title);
  if (state === "blank" || (opts.intent === "close" && state === "untouched")) {
    await files.remove(draft.path);
    return { outcome: "removed", path: null };
  }
  let next = removePinboardEntryChips(current, opts.removedChips ?? []);
  next = applyPinboardEntryTitle(next, title, draft.stem);
  if (next !== current) await files.write(draft.path, next);

  const name = title.trim() ? captureFileName(title, 80) : null;
  if (!name || name === draft.stem) return { outcome: "kept", path: draft.path };
  let stem = name;
  for (let n = 2; ; n++) {
    const candidate = withDir(draft.folder, stem);
    const own = candidate.toLowerCase() === draft.path.toLowerCase();
    if (own || !(await files.exists(candidate).catch(() => false))) break;
    stem = `${name} ${n}`;
  }
  try {
    const path = await files.rename(draft.path, stem);
    return { outcome: "kept", path };
  } catch {
    return { outcome: "kept", path: draft.path, renameFailed: true };
  }
}

/**
 * "Discard": an entry nobody wrote into goes without a question; one with
 * content only after `confirm` — and then into the trash, never silently.
 */
export async function discardPinboardEntry(
  files: PinboardEntryFiles,
  opts: { draft: PinboardDraft; title: string; confirm: () => Promise<boolean>; live?: string },
): Promise<"removed" | "kept"> {
  let current: string;
  try {
    current = await files.read(opts.draft.path);
  } catch {
    return "removed";
  }
  if (draftStateOf(current, opts.live, opts.draft.initial, opts.title) === "content" && !(await opts.confirm())) return "kept";
  await files.remove(opts.draft.path);
  return "removed";
}
