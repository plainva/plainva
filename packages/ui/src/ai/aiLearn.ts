import { useSyncExternalStore } from "react";
import {
  cleanMemoryText,
  findMemoryEntry,
  memoryTextProblem,
  nameOf,
  skillDraftDescription,
  SKILL_FILE,
  SKILLS_FOLDER,
  WRITE_DRAFT_LIMITS,
  type ConversationRecord,
  type InstructionEntry,
  type LearnKind,
  type LearnProposal,
  type LearnSkill,
  type MemoryEntry,
  type ModelFailure,
  type WriteDraftBody,
} from "@plainva/core";
import { flattenInertLinks } from "./aiCapture";
import { defuseNewAddresses } from "./aiWriteLint";
import { readSomething } from "./privateData";

/**
 * Learning from a conversation, on the app's side of the request (plan
 * KI-Harness P6, mockup chapter 22): what a review of one conversation may
 * propose, which skills it is told about, and how its proposals become
 * drafts. Rules without a session — the session asks the model and keeps the
 * drafts; nothing here writes.
 */

/** Why a review proposes less than all three kinds. */
export type LearnLimit =
  /** The conversation read text of strangers — a page, a mail, a foreign server: facts only. */
  | "foreign"
  /** The conversation carries notes that are kept from the cloud or the internet: facts only, and they inherit the rule. */
  | "restricted"
  /** The memory is switched off on this device: no entries are proposed for it. */
  | "memory-off"
  /** This shell cannot write skills, or rules: none are proposed. */
  | "read-only";

/** What "Learn from this conversation" would send, shown before it is asked. */
export interface LearnPlan {
  conversationId: string;
  title: string;
  /** The provider's name and the model: the one that led the conversation. */
  provider: string;
  model: string;
  local: boolean;
  /** The kinds a review of this conversation may propose. */
  kinds: LearnKind[];
  limits: LearnLimit[];
  /** Messages of the conversation that go, and how many were left out of its middle. */
  messages: number;
  omitted: number;
  /** The vault's own skills whose instructions go along, by name. */
  skills: string[];
  tokens: number;
  costUsd?: number;
}

/**
 * Why a review does not happen. `gone`: the conversation is not there any
 * more. `empty`: nothing was said and answered in it. `no-model`: the model
 * that led it is not set up on this device any more — it goes to no other.
 * `kept`: it ran on this device and would go to a cloud. `denied`: a note it
 * rests on may not go to this model today. `nothing`: no kind of proposal is
 * left to ask for.
 */
export type LearnRefusal = "off" | "no-vault" | "gone" | "empty" | "no-model" | "kept" | "denied" | "nothing" | "busy" | "cancelled" | "invalid" | "failed";

export type LearnPlanOutcome = { ok: true; plan: LearnPlan } | { ok: false; reason: LearnRefusal };

export type LearnOutcome =
  | {
      kind: "learned";
      conversationId: string;
      /** The drafts laid down, by id, in the order they were proposed. */
      drafts: string[];
      /** What the answer held that became no draft: no proposal at all, or one the app does not take. */
      dropped: number;
      /** Proposals the vault holds already: an entry of the memory that says the same. */
      known: number;
      /** The list of drafts was full: not everything that was proposed could be laid down. */
      full: boolean;
      provider: string;
      model: string;
      local: boolean;
      kinds: LearnKind[];
      limits: LearnLimit[];
      usage: { inputTokens: number; outputTokens: number };
      costUsd?: number;
    }
  | { kind: "refused"; reason: LearnRefusal; failure?: ModelFailure; provider?: string; model?: string };

/**
 * Whether a conversation read text of strangers: a page or a search on the
 * internet, a mail or the description of an appointment, a foreign MCP
 * server. Such text can say anything, also "from now on always …" — and a
 * review would hand it back as a rule. So what a conversation of this kind
 * teaches is facts, which are data wherever they go.
 */
export function readStrangersText(record: Pick<ConversationRecord, "runs">): boolean {
  return record.runs.some((run) => Boolean(run.web && (run.web.pages.length || run.web.searches.length)) || Boolean(run.reading && readSomething(run.reading)) || Boolean(run.mcp?.calls.length));
}

/** The ids of the skills a conversation used: the one it was bound to, and each one a run loaded. */
export function skillsUsedBy(record: Pick<ConversationRecord, "runs" | "instructions">): string[] {
  const ids = new Set<string>();
  if (record.instructions?.skill) ids.add(record.instructions.skill.id);
  for (const run of record.runs) for (const skill of run.skills ?? []) ids.add(skill.id);
  return [...ids];
}

/** A skill a proposal may give other instructions: what the review is told about it, and what a draft binds. */
export interface LearnTarget extends LearnSkill {
  id: string;
  /** What the workshop calls it. */
  title: string;
  /** SHA-256 of its main file as it is now. */
  base: string;
}

/**
 * Whether a proposal may rewrite a skill at all: one of the vault's own,
 * approved on this device at exactly its current files — switched on or off
 * —, and not one the user imported. An imported skill is somebody else's
 * text; a skill that waits for a review has not been read here yet, and a
 * proposal is no way around reading it.
 */
export function canRewriteSkill(entry: InstructionEntry): boolean {
  const { source, approval } = entry;
  if (source.kind !== "skill" || source.origin !== "vault" || !source.skill || source.text === null || source.tooLarge) return false;
  if (entry.status !== "active" && entry.status !== "off") return false;
  return approval !== null && approval.how !== "imported";
}

/** Of the skills a conversation used, the ones a proposal may rewrite — by the name a review calls them. */
export function learnTargets(entries: readonly InstructionEntry[], used: readonly string[]): LearnTarget[] {
  const targets: LearnTarget[] = [];
  for (const id of used) {
    const entry = entries.find((candidate) => candidate.source.id === id);
    if (!entry || !canRewriteSkill(entry)) continue;
    const main = entry.source.files.find((file) => file.path === SKILL_FILE);
    const skill = entry.source.skill!;
    if (!main) continue;
    targets.push({ id, name: nameOf(entry.source), title: skill.plainva.title || nameOf(entry.source), description: skill.description, body: skill.body, base: main.sha256 });
  }
  return targets;
}

const oneLine = (value: string, max: number) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export interface LearnedDraft {
  title: string;
  body: WriteDraftBody;
  defused: number;
  why: string;
}

/**
 * The proposals of a review as drafts. Every text a model wrote goes through
 * what every text a model lays down goes through: an address the user did
 * not type is made inert. A proposal the vault holds already is left out and
 * counted as known; one that cannot be a draft — an entry that is no single
 * line, a skill that would take the name of one that is there, other
 * instructions that change nothing — is dropped.
 */
export function draftsFromLearnings(input: {
  proposals: readonly LearnProposal[];
  /** The entries of the memory as its files hold them now; null where the memory cannot be read. */
  memory: readonly MemoryEntry[] | null;
  /** The skills a proposal may rewrite. */
  targets: readonly LearnTarget[];
  /** The names no new skill may take: every skill the vault has, and every one that comes with the app. */
  taken: readonly string[];
  /** What the user typed in the conversation: an address from there is theirs. */
  userTexts: readonly string[];
}): { drafts: LearnedDraft[]; dropped: number; known: number } {
  const drafts: LearnedDraft[] = [];
  let dropped = 0;
  let known = 0;
  const lint = (text: string) => {
    const linted = defuseNewAddresses(text, input.userTexts);
    return { text: flattenInertLinks(linted.text), defused: linted.defused };
  };
  for (const proposal of input.proposals) {
    const why = oneLine(lint(proposal.why).text, WRITE_DRAFT_LIMITS.why);
    if (proposal.kind === "memory" || proposal.kind === "rule") {
      const linted = lint(proposal.text);
      const text = cleanMemoryText(linted.text).text;
      if (memoryTextProblem(text) !== null) {
        dropped += 1;
        continue;
      }
      if (proposal.kind === "memory") {
        if (input.memory === null) {
          dropped += 1;
          continue;
        }
        if (findMemoryEntry(input.memory, text)) {
          known += 1;
          continue;
        }
        // What a review found goes where the assistant looks things up: "always included" is small, and the user's to fill.
        drafts.push({ title: oneLine(text, WRITE_DRAFT_LIMITS.title), body: { kind: "memory", text, place: "long", replaces: null }, defused: linted.defused, why });
      } else drafts.push({ title: oneLine(text, WRITE_DRAFT_LIMITS.title), body: { kind: "rule", text }, defused: linted.defused, why });
      continue;
    }
    const linted = lint(proposal.body);
    const body = linted.text.trim();
    if (!body || body.length > WRITE_DRAFT_LIMITS.skillBody) {
      dropped += 1;
      continue;
    }
    const target = input.targets.find((candidate) => candidate.name === proposal.name);
    if (target) {
      // The same instructions: nothing to decide about.
      if (target.body.trim() === body) {
        dropped += 1;
        continue;
      }
      drafts.push({ title: oneLine(target.title, WRITE_DRAFT_LIMITS.title), body: { kind: "skill", change: { id: target.id, base: target.base }, name: target.title, description: "", body }, defused: linted.defused, why });
      continue;
    }
    // A name that is taken — by a skill the review was not told about, or one it may not rewrite — is no new skill's.
    const description = flattenInertLinks(defuseNewAddresses(proposal.description, input.userTexts).text).replace(/\s+/g, " ").trim();
    if (input.taken.includes(proposal.name) || !skillDraftDescription(description)) {
      dropped += 1;
      continue;
    }
    drafts.push({ title: proposal.name, body: { kind: "skill", change: null, name: proposal.name, description, body }, defused: linted.defused, why });
  }
  return { drafts, dropped, known };
}

/** The names of the skills that exist, as a new skill's name is held against them: the vault's folders and the app's. */
export function takenSkillNames(entries: readonly InstructionEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.source.kind !== "skill") continue;
    names.add(nameOf(entry.source));
    if (entry.source.root.startsWith(`${SKILLS_FOLDER}/`)) names.add(entry.source.root.slice(SKILLS_FOLDER.length + 1));
    if (entry.source.id.startsWith("plainva:")) names.add(entry.source.id.slice("plainva:".length));
  }
  return [...names];
}

// --- which of learning's surfaces is open ---------------------------------

/**
 * The dialogs of learning that are open in this window: the review of a
 * conversation, a skill's draft under review, a skill's earlier versions.
 * Opened from wherever a conversation, a draft or a skill is shown — the
 * companion, the dock, the tab, the list of what waits, the workshop — and
 * shown by the shell in one place, in the order they were opened: a skill's
 * draft is reviewed over the result of the review it came from, and closing
 * it leads back there.
 */
export type LearnSurface = { kind: "learn"; conversationId: string } | { kind: "skill-draft"; draftId: string } | { kind: "skill-versions"; skillId: string };

const keyOf = (surface: LearnSurface): string => (surface.kind === "learn" ? `learn:${surface.conversationId}` : surface.kind === "skill-draft" ? `draft:${surface.draftId}` : `versions:${surface.skillId}`);

let surfaces: readonly LearnSurface[] = [];
const listeners = new Set<() => void>();
const changed = (next: readonly LearnSurface[]) => {
  surfaces = next;
  for (const listener of [...listeners]) listener();
};

/** Opens one of learning's dialogs over whatever is open; one that is open already comes to the front. */
export function openLearnSurface(surface: LearnSurface): void {
  const key = keyOf(surface);
  changed([...surfaces.filter((open) => keyOf(open) !== key), surface]);
}

export function closeLearnSurface(surface: LearnSurface): void {
  const key = keyOf(surface);
  if (surfaces.some((open) => keyOf(open) === key)) changed(surfaces.filter((open) => keyOf(open) !== key));
}

/** A key for a surface's element, so its own state lives as long as it is open. */
export const learnSurfaceKey = keyOf;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Tells a shell how many of learning's dialogs are open, each time that
 * changes — for whatever has to make room for them (the desktop's floating
 * companion is drawn above a dialog). Returns the way to stop listening.
 */
export function watchLearnSurfaces(listener: (open: number) => void): () => void {
  return subscribe(() => listener(surfaces.length));
}

export function useLearnSurfaces(): readonly LearnSurface[] {
  return useSyncExternalStore(
    subscribe,
    () => surfaces,
    () => surfaces,
  );
}
