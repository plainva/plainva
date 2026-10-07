import {
  ACP_ERROR_INVALID_PARAMS,
  ACP_ERROR_NOT_FOUND,
  AcpRefusal,
  OKF_TRUST_KEYS,
  acpAuthorId,
  acpLines,
  acpVaultPath,
  frontmatterKeys,
  gateDecision,
  readFrontmatterPath,
  upsertFrontmatterKeys,
  type AcpFileRead,
  type AcpFileWrite,
  type EffectivePolicy,
  type EgressRecipient,
} from "@plainva/core";
import type { SuggestionChunk } from "../components/suggestMode";
import { generatedStamp } from "../lib/okfProvenance";
import { selectionChunks, type SuggestionAuthor } from "./aiSelectionActions";
import { defuseNewAddresses } from "./aiWriteLint";

/**
 * What a file request of an external agent becomes (plan KI-Harness P4.6).
 *
 * An agent reads and writes files on its own: it runs with the user's rights
 * and Plainva cannot stop that, and says so. This is about the other way —
 * what Plainva does when the agent ASKS the app for a file, as the protocol
 * lets it. There Plainva's own rules hold, the same as for every other
 * program that sends elsewhere:
 *
 * - Reading: a file of the open vault, not one of Plainva's own folders, and
 *   not a note kept from the cloud. The agent gets the text, or one fixed
 *   sentence why not.
 * - Writing: nothing is written. A change to a note becomes a suggestion
 *   round with the agent as its author, which the user accepts or declines
 *   block by block. A note that does not exist yet waits in the session until
 *   the user creates it. Everything else is refused: Plainva's own folders, a
 *   file that is no Markdown note, a note kept from the cloud, a change to a
 *   note's properties.
 *
 * The sentences an agent is refused with are Plainva's own, in English (its
 * model reads them), and name nothing the agent did not name itself. The
 * session tells the user the same in their language, by the reason's word.
 */

/** The open vault, as far as an agent's file requests reach into it. The shell hands it in. */
export interface AcpVaultAccess {
  /** The vault's folder as the system writes it: where the agent is started, and what its paths are read against. */
  root: string;
  /** The text of a file of the vault as it is now — the editor's pending keystrokes included —, or null where there is none. */
  read(path: string): Promise<string | null>;
  /** The names in a folder of the vault ("" is the vault itself); null where it is no folder. */
  list(folder: string): Promise<string[] | null>;
  policyOf(path: string, text?: string): Promise<EffectivePolicy>;
  /** Writes a suggestion round into a note's comments; nothing enters the note until someone accepts. */
  propose(round: { path: string; base: string; chunks: readonly SuggestionChunk[]; note: string; author: SuggestionAuthor }): Promise<void>;
  /** Creates a note through the vault's own write path. Rejects where a file is there already. */
  create(path: string, content: string): Promise<void>;
  /** True inside an encrypted workspace: no agent is started there. */
  encrypted(): boolean;
}

/** The largest file Plainva hands an agent, in characters: a long note, not a database export. */
export const ACP_READ_LIMIT = 1024 * 1024;
/** More blocks than this in one round is a rewrite nobody reviews block by block. */
export const ACP_MAX_ROUND_BLOCKS = 150;

/** Why Plainva did not do what an agent asked for with a file. */
export const ACP_FILE_REFUSALS = {
  "not-absolute": "Plainva needs an absolute path.",
  outside: "Plainva works with files of the open vault only.",
  unsafe: "Plainva does not take this path.",
  hidden: "Plainva does not hand over or change its own folders.",
  missing: "There is no such file in the vault.",
  "too-large": "The file is too large.",
  kept: "This note is kept from programs that send elsewhere.",
  "not-a-note": "Plainva takes changes to Markdown notes only.",
  sealed: "This vault takes no changes from an agent.",
  rules: "Plainva does not take a note's AI rules or its trust fields from an agent.",
  properties: "Plainva takes changes to the text of a note only; its properties stay as they are.",
  unreadable: "The properties at the top of the note cannot be read.",
  "too-many": "Too many changes for one suggestion. Change less at a time.",
} as const;
export type AcpFileRefusalReason = keyof typeof ACP_FILE_REFUSALS;

/** A refusal with its reason as a word: the agent reads the sentence, the session shows the word in the user's language. */
export class AcpFileRefusal extends AcpRefusal {
  readonly reason: AcpFileRefusalReason;
  /** The vault path the request meant, where it meant one. */
  readonly path: string | null;
  constructor(reason: AcpFileRefusalReason, path: string | null = null) {
    super(reason === "missing" ? ACP_ERROR_NOT_FOUND : ACP_ERROR_INVALID_PARAMS, ACP_FILE_REFUSALS[reason]);
    this.name = "AcpFileRefusal";
    this.reason = reason;
    this.path = path;
  }
}

/** An agent is a recipient like a cloud provider: a note kept from the cloud stays hidden from Plainva's side of it too. */
export function acpRecipient(agentId: string): EgressRecipient {
  return { kind: "cloud", provider: acpAuthorId(agentId), model: "" };
}

const fold = (name: string) => name.normalize("NFC").toLowerCase();

/**
 * The path as the vault spells it. A file system that ignores case opens
 * `notes/plan.md` for `Notes/Plan.md`, but a suggestion belongs to a note by
 * its exact path — so every part is looked up in its folder and takes the
 * spelling found there. `exists` says whether the whole path was found.
 */
export async function acpSpelledPath(vault: Pick<AcpVaultAccess, "list">, path: string): Promise<{ path: string; exists: boolean }> {
  const parts = path.split("/");
  const spelled: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    const names = await vault.list(spelled.join("/")).catch(() => null);
    const found = names ? (names.includes(part) ? part : names.find((name) => fold(name) === fold(part))) : undefined;
    if (found === undefined) return { path: [...spelled, ...parts.slice(index)].join("/"), exists: false };
    spelled.push(found);
  }
  return { path: spelled.join("/"), exists: true };
}

/** The file of the vault a request names, in the vault's own spelling; throws the refusal where it names none. */
export async function acpRequestedPath(vault: AcpVaultAccess, absolute: string): Promise<{ path: string; exists: boolean }> {
  const mapped = acpVaultPath(vault.root, absolute);
  if (!mapped.ok) throw new AcpFileRefusal(mapped.problem);
  return acpSpelledPath(vault, mapped.path);
}

async function allowed(vault: AcpVaultAccess, agentId: string, path: string, text: string): Promise<boolean> {
  return gateDecision(await vault.policyOf(path, text), { recipient: acpRecipient(agentId), webTools: false }).allowed;
}

/**
 * `fs/read_text_file`: the text, or the refusal the agent is answered with.
 * `own` is what the agent itself wrote to this path earlier in the session
 * and nobody accepted yet: it reads its own text back, so that what it works
 * on next is what it believes is there.
 */
export async function acpReadFile(vault: AcpVaultAccess, agentId: string, request: AcpFileRead, own?: (path: string) => string | undefined): Promise<{ path: string; content: string }> {
  const { path, exists } = await acpRequestedPath(vault, request.path);
  const written = own?.(path);
  if (written !== undefined) return { path, content: acpLines(written, request.line, request.limit) };
  const text = exists ? await vault.read(path) : null;
  if (text === null) throw new AcpFileRefusal("missing", path);
  if (text.length > ACP_READ_LIMIT) throw new AcpFileRefusal("too-large", path);
  if (!(await allowed(vault, agentId, path, text))) throw new AcpFileRefusal("kept", path);
  return { path, content: acpLines(text, request.line, request.limit) };
}

/** The properties block at the top of a note, with its fences, exactly as written; "" where there is none. */
export function frontmatterBlock(text: string): string {
  const first = text.startsWith("---\r\n") ? 5 : text.startsWith("---\n") ? 4 : 0;
  if (first === 0) return "";
  let at = first;
  while (at <= text.length) {
    const end = text.indexOf("\n", at);
    const line = (end < 0 ? text.slice(at) : text.slice(at, end)).replace(/\r$/, "");
    if (line === "---") return end < 0 ? text : text.slice(0, end + 1);
    if (end < 0) return "";
    at = end + 1;
  }
  return "";
}

/** What a write of an agent would become. Nothing has happened yet. */
export type AcpWritePlan =
  /** A change to a note: the blocks of a suggestion round, against the note as it is now. */
  | { kind: "round"; path: string; base: string; chunks: SuggestionChunk[]; defused: number }
  /** The note says this already. */
  | { kind: "unchanged"; path: string }
  /** A note that does not exist yet: it waits in the session until the user creates it. */
  | { kind: "new"; path: string; content: string; defused: number };

/**
 * `fs/write_text_file`: what the write would become, or the refusal the agent
 * is answered with. Nothing is written and nothing is proposed here — a
 * session plans every write of a turn and proposes once, when the turn ends.
 */
export async function acpPlanWrite(vault: AcpVaultAccess, agentId: string, request: AcpFileWrite): Promise<AcpWritePlan> {
  const { path, exists } = await acpRequestedPath(vault, request.path);
  return acpPlanNoteWrite(vault, agentId, path, exists, request.content);
}

/** The same for a path of the vault in the vault's own spelling: what a session plans again when a turn ends. */
export async function acpPlanNoteWrite(vault: AcpVaultAccess, agentId: string, path: string, exists: boolean, content: string): Promise<AcpWritePlan> {
  if (!/\.md$/i.test(path)) throw new AcpFileRefusal("not-a-note", path);
  if (vault.encrypted()) throw new AcpFileRefusal("sealed", path);
  const base = exists ? await vault.read(path) : null;

  if (base === null) {
    // A new note. What a note says about its own rules and its own trust is not an agent's to write.
    const keys = frontmatterKeys(content);
    if (readFrontmatterPath(content, ["plainva", "ai"]) !== undefined || keys.some((key) => (OKF_TRUST_KEYS as readonly string[]).includes(key))) throw new AcpFileRefusal("rules", path);
    // The place may have rules of its own: a folder kept from the cloud takes no note from an agent either.
    if (!(await allowed(vault, agentId, path, content))) throw new AcpFileRefusal("kept", path);
    const linted = defuseNewAddresses(content, []);
    try {
      // The stamp that says who wrote the note goes into its properties when it is created: they have to be readable for that.
      acpNewNoteContent(linted.text, agentId, new Date(0));
    } catch {
      throw new AcpFileRefusal("unreadable", path);
    }
    return { kind: "new", path, content: linted.text, defused: linted.defused };
  }

  if (!(await allowed(vault, agentId, path, base))) throw new AcpFileRefusal("kept", path);
  if (content === base) return { kind: "unchanged", path };
  // A note's properties are not text in the margin's sense, and among them are the note's own rules: an agent changes the text, not them.
  if (frontmatterBlock(content) !== frontmatterBlock(base)) throw new AcpFileRefusal("properties", path);
  // The whole new text is linted, then diffed: a block of the round is a fragment, and half an address is none.
  const linted = defuseNewAddresses(content, [base]);
  const chunks = selectionChunks(base, 0, base.length, linted.text, "replace");
  if (chunks.length === 0) return { kind: "unchanged", path };
  if (chunks.length > ACP_MAX_ROUND_BLOCKS) throw new AcpFileRefusal("too-many", path);
  return { kind: "round", path, base, chunks, defused: linted.defused };
}

export interface AcpRoundTexts {
  /** The sentence of the round: who proposes, in the user's language. */
  note: string;
  /** Added to it where addresses the agent brought were made inert. */
  defused: string;
  /** The author as the margin shows it. */
  author: string;
}

/** Lays a planned change on its note as a suggestion round by the agent. Nothing enters the note until someone accepts. */
export async function acpProposeRound(vault: AcpVaultAccess, agentId: string, plan: Extract<AcpWritePlan, { kind: "round" }>, texts: AcpRoundTexts): Promise<void> {
  await vault.propose({
    path: plan.path,
    base: plan.base,
    chunks: plan.chunks,
    note: plan.defused ? `${texts.note} ${texts.defused}` : texts.note,
    author: { id: acpAuthorId(agentId), displayName: texts.author },
  });
}

/**
 * A note an agent wrote, as it is created once the user says so: with the
 * stamp that says who wrote it (ADR 0023 §3) — the agent's id on this device,
 * never the name the agent gives itself.
 */
export function acpNewNoteContent(content: string, agentId: string, now: Date): string {
  return upsertFrontmatterKeys(content, { generated: generatedStamp(acpAuthorId(agentId), now) });
}
