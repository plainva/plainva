import {
  AI_POLICY_DIMENSIONS,
  PLAN_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  WRITE_REFUSALS,
  WRITE_RESULTS,
  appendToNote,
  applyNoteEdits,
  editProblemSentence,
  noteBodyStart,
  type AiPolicyDimension,
  type EffectivePolicy,
  type NoteEdit,
  type RunWrites,
  type ToolManifest,
  type ToolOutcome,
  type VaultQueryService,
  type WriteDraftBody,
  type WriteRefusal,
} from "@plainva/core";
import type { SuggestionChunk } from "../components/suggestMode";
import { parseTaskCapture, type CaptureVocabulary } from "../lib/taskCapture";
import { flattenInertLinks } from "./aiCapture";
import { selectionChunks, type SuggestionAuthor } from "./aiSelectionActions";
import { defuseNewAddresses } from "./aiWriteLint";

/**
 * The writing tools of the assistant (plan KI-Harness P5, ADR 0019 §2), one
 * implementation for both shells. None of them changes the vault:
 *
 * - a change to a note that is there is laid on the note as a suggestion
 *   round, in the margin where a person's suggestions wait;
 * - something that does not exist yet is left as a draft;
 * - a rename, a move and a deletion are a question to the user, and the
 *   app's own operation does it after a yes.
 *
 * Everything a tool reads passes the same gate as a read: a note the rules
 * keep from this recipient is answered like a note that is not there, here
 * too. What a tool answers is one of Plainva's own sentences
 * (`WRITE_REFUSALS`, `WRITE_RESULTS`) — counts and the path the model named,
 * never the proposed text, and never a word of a note.
 */

/** A block of a round; `property` where it proposes a value of that property (plan P5-3). */
export interface RoundChunk extends SuggestionChunk {
  property?: string;
}

export interface ProposalRound {
  path: string;
  base: string;
  chunks: readonly RoundChunk[];
  note: string;
  author: SuggestionAuthor;
}

/** What renaming a note would do: where it ends up, and the notes whose links change with it. */
export interface RenamePlan {
  target: string;
  files: { path: string; links: number }[];
  links: number;
}

export type PlanProblem = Extract<WriteRefusal, "bad-name" | "exists" | "same-place" | "no-folder">;

/** What the shell does for the writing tools — its own ways of doing each thing. */
export interface VaultWriteDeps {
  /** True inside an encrypted workspace: nothing is proposed, drafted or planned there (E32). */
  sealed(): boolean;
  /** A note's text as it is now, the editor's pending keystrokes included; null where there is none. */
  current(path: string): Promise<string | null>;
  /** Lays a suggestion round on a note's comments; nothing enters the note until someone accepts. */
  propose(round: ProposalRound): Promise<void>;
  /** Whether the vault has this folder ("" is the vault itself). */
  folderExists(folder: string): Promise<boolean>;
  /** The words a captured task is read with, in the app's language. */
  taskVocabulary(): CaptureVocabulary;
  /**
   * The path whose rules hold where a task, or a line in the journal of `day`,
   * would be written: a note in the task database's folder, the daily note.
   * Null where nobody can say — then nothing that rests on a restricted note is written there.
   */
  draftPlace(kind: "task" | "journal", day: string): Promise<string | null>;
  /** What a rename would do, without doing it. */
  renamePlan(path: string, title: string): Promise<RenamePlan | PlanProblem>;
  /** Renames the note the way the app does — links follow. The new path, or null where it failed. */
  rename(path: string, title: string): Promise<string | null>;
  /** Where a move would put the note, without moving it. */
  movePlan(path: string, folder: string): Promise<{ target: string } | PlanProblem>;
  move(path: string, folder: string): Promise<string | null>;
  /** Opens the app's own delete dialog for the note; true when the user deleted it there. */
  requestDelete(path: string): Promise<boolean>;
}

/**
 * What renaming a note to `title` would do — where it ends up, and which
 * notes' links change with it —, without doing any of it. Both shells ask
 * this before the user is asked; the rename itself is the shell's own.
 */
export async function noteRenamePlan(query: Pick<VaultQueryService, "getBacklinks">, exists: (path: string) => Promise<boolean>, path: string, title: string): Promise<RenamePlan | PlanProblem> {
  const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const target = `${folder ? `${folder}/` : ""}${title}.md`;
  if (target === path) return "same-place";
  // A name that differs only in its letters' case is the same file on most disks, and no other note's.
  if (target.toLowerCase() !== path.toLowerCase() && (await exists(target))) return "exists";
  // Every link that points at the note, where it stands: the index holds one row per link, in the body and in the
  // properties alike. The note's links to itself are no other note's. A lookup that fails is no "nobody links here":
  // it throws, and the plan is not asked about.
  const counts = new Map<string, number>();
  for (const link of await query.getBacklinks(path)) {
    if (link.source_path !== path) counts.set(link.source_path, (counts.get(link.source_path) ?? 0) + 1);
  }
  const files = [...counts].map(([source, links]) => ({ path: source, links }));
  return { target, files, links: files.reduce((sum, file) => sum + file.links, 0) };
}

/** Where moving a note into `folder` ("" is the vault itself) would put it, or why it cannot go there. */
export async function noteMovePlan(exists: (path: string) => Promise<boolean>, path: string, folder: string): Promise<{ target: string } | PlanProblem> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const target = `${folder ? `${folder}/` : ""}${name}`;
  if (target === path) return "same-place";
  if (await exists(target)) return "exists";
  return { target };
}

/** A plan as the user is asked about it. Paths here are for the user's eyes: the model gets only the outcome. */
export type PlanQuestion =
  | { plan: "rename"; path: string; title: string; target: string; files: { path: string; links: number }[]; links: number }
  /** `loosens`: rules the note's folder gives it now that the target folder would not. */
  | { plan: "move"; path: string; folder: string; target: string; loosens: AiPolicyDimension[] }
  | { plan: "delete"; path: string };

/** What a run brings to its writing tools: who writes, what the conversation rests on, how to ask, where a draft goes. */
export interface WriteRun {
  author: SuggestionAuthor;
  /** What the user typed in this conversation: an address in it is the user's own, and stays one. */
  userTexts(): readonly string[];
  /** The rules of everything this conversation has read or carried: a place that takes a proposal of it has to have them too. */
  inherited(): Promise<readonly AiPolicyDimension[]>;
  /** Leaves a draft; the reason where the list does not take it. */
  draft(input: { title: string; body: WriteDraftBody; defused: number }): Promise<{ ok: true; id: string } | { ok: false; problem: "full" | "invalid" }>;
  /** Asks the user about a plan. `nobody`: this run has no one to ask (a door, a regression run). */
  ask(question: PlanQuestion, callId?: string): Promise<"yes" | "no" | "nobody">;
  /** What the run laid down, gathered for its record. */
  writes: RunWrites;
  /** The journal's day and the time, as the app counts them. */
  today(): string;
  clock(): string;
}

/** The executor's own view of the vault: the same gate every read passes. */
export interface WriteToolContext {
  /** A note this run may read, read: counted among what the run read, like every read. */
  readAllowed(raw: unknown): Promise<{ path: string; text: string } | null>;
  /** A vault-relative folder the model may name, or null. */
  safeFolder(raw: unknown): string | null;
  /** Whether a place passes the gate — where a draft would go, where a note would lie after a move. No read. */
  allowed(path: string, text?: string): Promise<boolean>;
  policyOf(path: string, text?: string): Promise<EffectivePolicy>;
  /** The id of the call that runs, where the run has one: a question about it is asked under it. */
  callId?: string;
}

/** The writing tools that have hands, in the order the tool search lists them. */
const SERVED_WRITE_TOOLS: readonly string[] = ["propose_edit", "create_note", "create_task", "add_journal_entry", "rename_note", "move_note", "delete_note"];

/**
 * The writing tools a shell with these deps offers a new conversation. Inside
 * an encrypted workspace it offers none (E32): a conversation started there is
 * told, as before, that it changes nothing — instead of being handed tools
 * that all answer no.
 */
export function writeToolNames(deps: VaultWriteDeps | undefined): string[] {
  return deps && !deps.sealed() ? [...SERVED_WRITE_TOOLS] : [];
}

export function isWriteToolName(name: string): boolean {
  return PROPOSAL_TOOL_NAMES.includes(name) || PLAN_TOOL_NAMES.includes(name);
}

/** More blocks than this in one round is a rewrite nobody reviews block by block. */
export const MAX_ROUND_BLOCKS = 150;

// A no of the user is no failure of the tool: it does not count towards the run's limit of failures in a row.
const refuse = (reason: WriteRefusal): ToolOutcome => ({ content: WRITE_REFUSALS[reason], isError: true, ...(reason === "declined" ? { declined: true } : {}) });
const said = (content: string): ToolOutcome => ({ content });

/** One line: no line breaks, no runs of blank space, cut at `max`. */
function oneLine(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A note's name as its file is called: no path, no extension, nothing a file system refuses. */
export function noteNameOf(title: string): string | null {
  const name = title.replace(/\s+/g, " ").trim().replace(/\.md$/i, "");
  if (!name || name.length > 200 || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name) || name.startsWith(".") || name.endsWith(".") || hasControl(name)) return null;
  return name;
}

function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function recordRound(writes: RunWrites, path: string, blocks: number, properties: number): void {
  const existing = writes.rounds.find((round) => round.path === path);
  if (existing) {
    existing.blocks += blocks;
    existing.properties += properties;
  } else writes.rounds.push({ path, blocks, properties });
}

/**
 * Whether a place already carries every rule the conversation rests on. A
 * note that is created takes the rules along (they are written into it); a
 * note that is there, a task and a line in the journal cannot — so they are
 * only written to where the rules hold anyway. A place nobody can name, or
 * whose rules cannot be read, takes nothing.
 */
async function placeTakes(run: WriteRun, ctx: WriteToolContext, place: string | null, text = ""): Promise<boolean> {
  const inherited = await run.inherited();
  if (!inherited.length) return true;
  if (place === null) return false;
  const policy = await ctx.policyOf(place, text).catch(() => null);
  return policy !== null && inherited.every((dimension) => policy.policy[dimension] === "deny");
}

async function proposeEdit(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const note = await ctx.readAllowed(a.path);
  if (!note) return refuse("no-note");
  if (!/\.md$/i.test(note.path)) return refuse("not-a-note");
  const edits = Array.isArray(a.edits) ? (a.edits as NoteEdit[]) : [];
  const append = typeof a.append === "string" ? a.append : "";
  if ((edits.length > 0) === (append.trim().length > 0)) return refuse("edits-or-append");
  // The editor's pending keystrokes land first: the proposal is made against the note as it is.
  const base = (await deps.current(note.path)) ?? note.text;
  const outcome = edits.length ? applyNoteEdits(base, edits) : appendToNote(base, append, typeof a.section === "string" ? a.section : undefined);
  if (!outcome.ok) return { content: editProblemSentence(outcome.problem, outcome.edit), isError: true };

  // A round inherits nothing, so it may only go where the rules of what the conversation rests on already hold.
  if (!(await placeTakes(run, ctx, note.path, base))) return refuse("restricted");
  // The whole new text is linted, then diffed: a block of the round is a fragment, and half an address is none.
  const linted = defuseNewAddresses(outcome.text, [base, ...run.userTexts()]);
  // Only the note's text is proposed here: its properties stay as they are, whatever the lint made of them.
  const start = noteBodyStart(base);
  const intended = base.slice(0, start) + linted.text.slice(noteBodyStart(linted.text));
  const chunks = selectionChunks(base, 0, base.length, intended, "replace");
  if (chunks.length === 0) return refuse("unchanged");
  if (chunks.length > MAX_ROUND_BLOCKS) return refuse("too-many");
  await deps.propose({ path: note.path, base, chunks, note: oneLine(a.note, 300), author: run.author });
  recordRound(run.writes, note.path, chunks.length, 0);
  return said(WRITE_RESULTS.proposed(note.path, chunks.length, linted.defused));
}

/** The text of a note a model drafted: its addresses inert, its links flat, and no properties block of its own. */
function draftedText(content: string, run: WriteRun): { text: string; defused: number } | null {
  // What a note says about its own rules and its own trust is not an assistant's to write: a draft is text.
  if (noteBodyStart(content) > 0) return null;
  const linted = defuseNewAddresses(content.trim(), run.userTexts());
  return { text: flattenInertLinks(linted.text), defused: linted.defused };
}

async function createNote(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const title = noteNameOf(typeof a.title === "string" ? a.title : "");
  if (!title) return refuse(typeof a.title === "string" && a.title.trim() ? "bad-name" : "no-title");
  let folder: string | null = null;
  if (typeof a.folder === "string" && a.folder.trim()) {
    folder = ctx.safeFolder(a.folder);
    // A folder the rules keep from this recipient takes no note from it either — and is answered like one that is not there.
    if (folder === null || !(await deps.folderExists(folder)) || !(await ctx.allowed(`${folder}/${title}.md`, ""))) return refuse("no-folder");
  }
  const drafted = draftedText(typeof a.content === "string" ? a.content : "", run);
  if (!drafted) return refuse("frontmatter");
  const left = await run.draft({ title, body: { kind: "note", path: null, folder, content: drafted.text }, defused: drafted.defused });
  if (!left.ok) return refuse(left.problem === "full" ? "full" : "failed");
  run.writes.drafts.push({ id: left.id, kind: "note", title });
  return said(WRITE_RESULTS.drafted(`a note "${title}"`, drafted.defused));
}

const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** A task's priority in words: 1 is the most important (`TaskPriority`). */
const PRIORITY_WORDS = ["", "high", "medium", "low"] as const;

async function createTask(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const text = oneLine(a.text, 500);
  if (!text) return refuse("empty");
  if (!(await placeTakes(run, ctx, await deps.draftPlace("task", run.today()).catch(() => null)))) return refuse("restricted");
  const read = parseTaskCapture(text, deps.taskVocabulary(), run.today());
  const title = (read.title.trim() || text).slice(0, 200);
  const left = await run.draft({ title, body: { kind: "task", text, day: run.today() }, defused: 0 });
  if (!left.ok) return refuse(left.problem === "full" ? "full" : "failed");
  run.writes.drafts.push({ id: left.id, kind: "task", title });
  // How Plainva read the words, so the answer can say it: the date is the app's reading, not the model's.
  const details = [
    read.due ? `due ${read.due}${read.minutes !== null ? ` ${clockOf(read.minutes)}` : ""}` : "",
    read.priority ? `priority ${PRIORITY_WORDS[read.priority]}` : "",
    read.tags.length ? `tags ${read.tags.join(", ")}` : "",
    read.repeat ? "repeating" : "",
  ].filter(Boolean);
  return said(WRITE_RESULTS.drafted(`a task "${title}"${details.length ? ` (${details.join("; ")})` : ""}`, 0));
}

async function addJournalEntry(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const raw = typeof a.text === "string" ? a.text.trim() : "";
  if (!raw) return refuse("empty");
  if (!(await placeTakes(run, ctx, await deps.draftPlace("journal", run.today()).catch(() => null)))) return refuse("restricted");
  const linted = defuseNewAddresses(raw.slice(0, 2000), run.userTexts());
  const text = flattenInertLinks(linted.text);
  const title = oneLine(text, 200);
  const left = await run.draft({ title, body: { kind: "journal", text, day: run.today(), time: run.clock(), task: a.task === true }, defused: linted.defused });
  if (!left.ok) return refuse(left.problem === "full" ? "full" : "failed");
  run.writes.drafts.push({ id: left.id, kind: "journal", title });
  return said(WRITE_RESULTS.drafted("a journal entry", linted.defused));
}

async function asked(run: WriteRun, ctx: WriteToolContext, question: PlanQuestion, act: () => Promise<string | null | boolean>, done: (result: string) => string): Promise<ToolOutcome> {
  const answer = await run.ask(question, ctx.callId);
  const record = (outcome: string) => run.writes.plans.push({ kind: question.plan, path: question.path, outcome });
  if (answer !== "yes") {
    record("declined");
    return refuse(answer === "nobody" ? "nobody" : "declined");
  }
  const result = await act().catch(() => null);
  if (result === null || result === false) {
    // A delete dialog the user closed is a no, not a failure.
    record(question.plan === "delete" ? "declined" : "failed");
    return refuse(question.plan === "delete" ? "declined" : "failed");
  }
  record("done");
  return said(done(typeof result === "string" ? result : ""));
}

async function renameNote(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const note = await ctx.readAllowed(a.path);
  if (!note) return refuse("no-note");
  const title = noteNameOf(typeof a.title === "string" ? a.title : "");
  if (!title) return refuse("bad-name");
  const plan = await deps.renamePlan(note.path, title);
  if (typeof plan === "string") return refuse(plan);
  return asked(run, ctx, { plan: "rename", path: note.path, title, target: plan.target, files: plan.files, links: plan.links }, () => deps.rename(note.path, title), WRITE_RESULTS.renamed);
}

async function moveNote(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const note = await ctx.readAllowed(a.path);
  if (!note) return refuse("no-note");
  const folder = typeof a.folder === "string" && a.folder.trim() ? ctx.safeFolder(a.folder) : "";
  if (folder === null || !(await deps.folderExists(folder))) return refuse("no-folder");
  const plan = await deps.movePlan(note.path, folder);
  if (typeof plan === "string") return refuse(plan);
  // A folder kept from this recipient is no place it can name — answered like one that is not there.
  if (!(await ctx.allowed(plan.target, note.text))) return refuse("no-folder");
  // A move can take a note out from under its folder's rule: the user is told before they say yes.
  const [from, to] = await Promise.all([ctx.policyOf(note.path, note.text), ctx.policyOf(plan.target, note.text)]);
  const loosens = AI_POLICY_DIMENSIONS.filter((dimension) => from.policy[dimension] === "deny" && to.policy[dimension] !== "deny");
  return asked(run, ctx, { plan: "move", path: note.path, folder, target: plan.target, loosens }, () => deps.move(note.path, folder), WRITE_RESULTS.moved);
}

async function deleteNote(deps: VaultWriteDeps, run: WriteRun, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome> {
  const note = await ctx.readAllowed(a.path);
  if (!note) return refuse("no-note");
  // The assistant never deletes: after the user's yes here, the app's own dialog opens, and that one decides.
  return asked(run, ctx, { plan: "delete", path: note.path }, () => deps.requestDelete(note.path), () => WRITE_RESULTS.deleted);
}

/**
 * Runs a writing tool; null where the tool is none of them. `deps` absent:
 * this shell cannot write, and the vault takes no changes here. `run` absent:
 * this caller has nobody who could decide about what it lays down — a door, a
 * regression run —, so nothing is laid down.
 */
export async function writeToolOutcome(deps: VaultWriteDeps | undefined, run: WriteRun | undefined, tool: ToolManifest, a: Record<string, unknown>, ctx: WriteToolContext): Promise<ToolOutcome | null> {
  if (!isWriteToolName(tool.name)) return null;
  if (!deps) return refuse("unavailable");
  // Asked again at every call: a conversation can outlive the moment its vault was sealed.
  if (deps.sealed()) return refuse("sealed");
  if (!SERVED_WRITE_TOOLS.includes(tool.name)) return refuse("unavailable");
  if (!run) return refuse("nobody");
  try {
    switch (tool.name) {
      case "propose_edit":
        return await proposeEdit(deps, run, a, ctx);
      case "create_note":
        return await createNote(deps, run, a, ctx);
      case "create_task":
        return await createTask(deps, run, a, ctx);
      case "add_journal_entry":
        return await addJournalEntry(deps, run, a, ctx);
      case "rename_note":
        return await renameNote(deps, run, a, ctx);
      case "move_note":
        return await moveNote(deps, run, a, ctx);
      case "delete_note":
        return await deleteNote(deps, run, a, ctx);
      default:
        return refuse("unavailable");
    }
  } catch {
    // Whatever went wrong inside the app is not the model's to read.
    return refuse("failed");
  }
}
