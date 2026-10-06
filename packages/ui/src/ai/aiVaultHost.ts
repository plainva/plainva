import {
  DEFAULT_AI_POLICY,
  EDITED_HALF_LIFE_MS,
  effectivePolicy,
  isCloudRecipient,
  ENCRYPTED_WORKSPACE_AI_POLICY,
  isAiHiddenPath,
  notePolicyFrom,
  OPENED_HALF_LIFE_MS,
  parsePolicyFile,
  questionTerms,
  readFrontmatterPath,
  readInstructionFile,
  scanInstruction,
  scanVaultInstructions,
  recencySignal,
  setFrontmatterPath,
  type Candidate,
  type ContextNote,
  type ContextPolicyHost,
  type EffectivePolicy,
  type EgressRecipient,
  type InstructionIO,
  type PackageGists,
  type ParsedPolicyFile,
  type SituationInput,
} from "@plainva/core";
import { notesEmbedding } from "./aiImage";
import type { AiInstructionsHost, AiVaultHost } from "./aiSession";
import { createAiVaultStores, type AiFileStore, type InstructionApprovalStore } from "./aiStores";
import { CHAT_TOOL_NAMES, createVaultToolExecutor, furtherToolNames, unmarkSnippet, withoutBrokenLinks, type ToolScope, type VaultToolDeps } from "./vaultTools";

/**
 * The vault side of the AI session, built the same way in both shells: the
 * shells hand in how to read a note and what is open, this module decides
 * what the policy says about it (ADR 0018).
 */

/** Where folder rules live. Plainva writes no marker files into the user's folders. */
export const AI_POLICY_FILE = ".agent/policy.yml";

export interface VaultPolicyHost extends ContextPolicyHost {
  /** The parsed folder rules, re-read at most every few seconds. */
  rules(): Promise<ParsedPolicyFile>;
  /** Forget the cached rules (after the settings wrote the file). */
  invalidate(): void;
}

export function createVaultPolicy(opts: {
  readFile(path: string): Promise<string | null>;
  resolveLink(target: string, fromPath: string): Promise<string | null>;
  /** True inside an encrypted workspace: the cloud is off unless the rules say otherwise. */
  encrypted(): boolean;
  now?: () => number;
}): VaultPolicyHost {
  const now = opts.now ?? (() => Date.now());
  let cached: { at: number; parsed: ParsedPolicyFile } | null = null;
  const rules = async (): Promise<ParsedPolicyFile> => {
    if (cached && now() - cached.at < 3000) return cached.parsed;
    let text: string | null;
    try {
      text = await opts.readFile(AI_POLICY_FILE);
    } catch {
      // Unreadable is not "no rules": fall back to the defaults, and say so.
      const parsed = { rules: [], problems: [`${AI_POLICY_FILE} could not be read`] };
      cached = { at: now(), parsed };
      return parsed;
    }
    const parsed = text === null ? { rules: [], problems: [] } : parsePolicyFile(text);
    cached = { at: now(), parsed };
    return parsed;
  };
  return {
    rules,
    invalidate() {
      cached = null;
    },
    async policyOf(path: string, text?: string): Promise<EffectivePolicy> {
      let content = text;
      if (content === undefined) {
        try {
          content = (await opts.readFile(path)) ?? "";
        } catch {
          content = "";
        }
      }
      const plainva = readFrontmatterPath(content, ["plainva"]);
      const own = notePolicyFrom(plainva === undefined ? {} : { plainva });
      return effectivePolicy(path, own, (await rules()).rules, opts.encrypted() ? ENCRYPTED_WORKSPACE_AI_POLICY : DEFAULT_AI_POLICY);
    },
    resolveLink: opts.resolveLink,
  };
}

export interface AiVaultHostInput {
  files: AiFileStore;
  /** A stable handle of the vault (see `aiVaultKey`). */
  vaultKey: string;
  policy: VaultPolicyHost;
  /** The note open in the shell right now — its saved text. */
  activeNote(): Promise<Omit<ContextNote, "pinned"> | null>;
  readNote(path: string): Promise<Omit<ContextNote, "pinned"> | null>;
  /** Where the user is: gathered by the shell, gated and written by the context package. */
  situation(): Promise<SituationInput>;
  /** The vault's candidate sources; null in a shell without an index. */
  retrieval: CandidateRetrieval | null;
  /** The tools' access to the vault; null when this shell offers no tools. */
  toolDeps: Omit<VaultToolDeps, "policyOf" | "resolveLink"> | null;
  /** Writes a note's own "never to the cloud" rule — the user's action in "View context". */
  keepOnDevice?(path: string): Promise<void>;
  /** Checked gists of the model on this computer (plan P2b-3), asked when a message is built. */
  gists?(): PackageGists | null;
  /** Writes an AI suggestion round into a note's comments (plan P1.5); absent where the shell cannot. */
  propose?: AiVaultHost["propose"];
  /** True inside an encrypted workspace, whose sealed suggestions cannot carry an author yet (E32). */
  encrypted?: AiVaultHost["encrypted"];
  /** Posts the assistant's reply into a comment thread (plan P3-6); absent where the shell cannot. */
  reply?: AiVaultHost["reply"];
  /** The vault's folder entries and file bytes, for its own instructions (plan KI-Harness P3); absent, only the app's skills exist. */
  instructionIO?: InstructionIO;
  /** Writes and removes the workshop's skills (plan P3-5); absent, the workshop only reads. */
  instructionWriter?: InstructionWriter;
}

export interface InstructionWriter {
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Writing through a vault adapter: the folder first, then the file; a removal as the file tree does it, confirmed. */
export function adapterInstructionWriter(adapter: {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeBinaryFile(path: string, content: Uint8Array): Promise<void>;
  deleteItem(path: string, recursive?: boolean, confirmation?: { confirmed: true }): Promise<void>;
}): InstructionWriter {
  return {
    async write(path, bytes) {
      const folder = path.slice(0, path.lastIndexOf("/"));
      if (folder && !(await adapter.exists(folder))) await adapter.createDir(folder);
      await adapter.writeBinaryFile(path, bytes);
    },
    // The user confirmed in the workshop; the adapters back the files up before they go.
    remove: (path) => adapter.deleteItem(path, true, { confirmed: true }),
  };
}

/** The scan's view of a vault adapter — folder entries and file bytes, nothing written (plan KI-Harness P3). */
export function adapterInstructionIO(adapter: {
  exists(path: string): Promise<boolean>;
  listDir(path?: string, recursive?: boolean): Promise<readonly { name: string; isDirectory: boolean }[]>;
  readBinaryFile(path: string): Promise<Uint8Array>;
}): InstructionIO {
  return {
    async list(folder) {
      try {
        if (!(await adapter.exists(folder))) return [];
        return (await adapter.listDir(folder, false)).map((entry) => ({ name: entry.name, folder: entry.isDirectory }));
      } catch {
        return [];
      }
    },
    async read(path) {
      try {
        return (await adapter.exists(path)) ? await adapter.readBinaryFile(path) : null;
      } catch {
        return null;
      }
    },
  };
}

function instructionsHost(io: InstructionIO, approvals: InstructionApprovalStore, writer?: InstructionWriter): AiInstructionsHost {
  return {
    scan: () => scanVaultInstructions(io),
    scanOne: (id) => scanInstruction(io, id),
    readFile: (source, rel) => readInstructionFile(io, source, rel),
    approvals,
    ...(writer ? { write: writer.write, remove: writer.remove } : {}),
  };
}

/** A note's text with its own rule "never to the cloud" (the plainva namespace, ADR 0018). */
export function withCloudDenied(text: string): string {
  return setFrontmatterPath(text, ["plainva", "ai", "cloud"], "deny");
}

/** Where candidates come from (plan §8.1): the index, and what this device opened. */
export interface CandidateRetrieval {
  searchCandidates(terms: readonly string[], limit: number): Promise<{ path: string; title: string; score: number; snippet: string | null }[]>;
  linkNeighbors(path: string, limit: number): Promise<{ path: string; title: string; incoming: number; outgoing: number }[]>;
  recentlyChanged(limit: number): Promise<{ path: string; title: string; mtime: number }[]>;
  /** Opened on this device, newest first (`.plainva/recents.json`). */
  recentlyOpened(): Promise<{ path: string; openedAt: number }[]>;
  now(): number;
  /** Notes close in meaning (plan P2b); absent while the vault has no search by meaning. */
  semanticCandidates?(question: string, limit: number, options: { cloudQuestion: boolean }): Promise<{ path: string; ordinal: number; hash: string; score: number }[]>;
  /** Note sizes as the index knows them, for what a naive request would have sent (plan P2b-5). */
  noteSizes?(paths: readonly string[]): Promise<Map<string, number>>;
  /**
   * The notes whose text contains one of these spellings literally (plan
   * P4-5, `VaultQueryService.notesContaining`): how "which notes embed this
   * picture" starts. Absent, nobody can tell — and a picture then goes to no cloud.
   */
  notesContaining?(needles: readonly string[]): Promise<{ paths: string[]; truncated: boolean }>;
}

const noteTitle = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/**
 * The candidate lists for a question: full-text hits (any term, relative to
 * the best hit), the open note's link neighbours, and what changed or was
 * opened lately. Nothing here is gated or ranked — the package does both,
 * the gate first.
 */
export async function gatherCandidates(retrieval: CandidateRetrieval, question: string, activePath: string | null, recipient?: EgressRecipient): Promise<Candidate[][]> {
  const now = retrieval.now();
  const terms = questionTerms(question);
  const cloudQuestion = recipient ? isCloudRecipient(recipient) : false;
  const [hits, neighbors, changed, opened, meaning] = await Promise.all([
    terms.length ? retrieval.searchCandidates(terms, 30).catch(() => []) : Promise.resolve([]),
    activePath ? retrieval.linkNeighbors(activePath, 20).catch(() => []) : Promise.resolve([]),
    retrieval.recentlyChanged(20).catch(() => []),
    retrieval.recentlyOpened().catch(() => []),
    retrieval.semanticCandidates ? retrieval.semanticCandidates(question, 20, { cloudQuestion }).catch(() => []) : Promise.resolve([]),
  ]);
  const best = Math.max(...hits.map((h) => h.score), 0) || 1;
  const lists: Candidate[][] = [
    hits.map((h) => ({ path: h.path, title: h.title || noteTitle(h.path), signals: { lexical: Math.max(0, h.score) / best }, ...(h.snippet ? { snippet: withoutBrokenLinks(unmarkSnippet(h.snippet)) } : {}) })),
    neighbors.map((n) => ({ path: n.path, title: n.title || noteTitle(n.path), signals: { graph: Math.min(1, 0.6 + 0.15 * (n.incoming + n.outgoing - 1)) } })),
    changed.map((c) => ({ path: c.path, title: c.title || noteTitle(c.path), signals: { edited: recencySignal(now - c.mtime, EDITED_HALF_LIFE_MS) } })),
    opened
      .filter((o) => /\.md$/i.test(o.path))
      .map((o) => ({ path: o.path, title: noteTitle(o.path), signals: { opened: recencySignal(now - o.openedAt, OPENED_HALF_LIFE_MS) } })),
    meaning.map((m) => ({ path: m.path, title: noteTitle(m.path), signals: { semantic: m.score }, chunk: { ordinal: m.ordinal, hash: m.hash } })),
  ];
  // `.agent/` and the other hidden roots are never candidates (ADR 0020): the package drops them too.
  return lists.map((list) => list.filter((candidate) => !isAiHiddenPath(candidate.path)));
}

export function createAiVaultHost(input: AiVaultHostInput): AiVaultHost {
  const stores = createAiVaultStores(input.files, input.vaultKey);
  return {
    ...stores,
    activeNote: input.activeNote,
    readNote: input.readNote,
    situation: input.situation,
    candidates: (question, activePath, recipient) => (input.retrieval ? gatherCandidates(input.retrieval, question, activePath, recipient) : Promise.resolve([])),
    ...(input.retrieval?.noteSizes ? { noteSizes: input.retrieval.noteSizes.bind(input.retrieval) } : {}),
    policy: input.policy,
    ...(input.keepOnDevice ? { keepOnDevice: input.keepOnDevice } : {}),
    ...(input.gists ? { gists: input.gists } : {}),
    ...(input.propose ? { propose: input.propose } : {}),
    ...(input.encrypted ? { encrypted: input.encrypted } : {}),
    ...(input.reply ? { reply: input.reply } : {}),
    // Which notes embed a picture (plan P4-5): their rules decide with the picture's own. Without an index nobody can tell — `null`, never "none".
    embedders: (path) => {
      const containing = input.retrieval?.notesContaining?.bind(input.retrieval);
      return containing ? notesEmbedding(path, { containing, read: async (note) => (await input.readNote(note))?.text ?? null }) : Promise.resolve(null);
    },
    ...(input.instructionIO ? { instructions: instructionsHost(input.instructionIO, stores.instructionApprovals, input.instructionWriter) } : {}),
    tools(recipient: EgressRecipient, scope?: ToolScope, redact?: ReadonlySet<string>, web?: boolean, narrowed?: () => readonly string[] | null) {
      if (!input.toolDeps) return null;
      const retrieval = input.retrieval;
      const deps: VaultToolDeps = {
        // The index sources the context package ranks with serve the tools too.
        ...(retrieval ? { neighbors: retrieval.linkNeighbors, recentlyOpened: retrieval.recentlyOpened, recentlyChanged: retrieval.recentlyChanged } : {}),
        ...input.toolDeps,
        policyOf: input.policy.policyOf,
        resolveLink: input.policy.resolveLink,
      };
      // What this shell serves beyond a conversation's own list: found with the tool search, never loaded on its own.
      const more = furtherToolNames(deps);
      // A shell without appointments does not offer the tools that read them.
      const names = deps.events ? CHAT_TOOL_NAMES : CHAT_TOOL_NAMES.filter((name) => name !== "get_calendar" && name !== "get_event");
      // In a conversation with the internet a note whose rules say `web: deny` does not exist for the tools either.
      return { names, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}) }) };
    },
  };
}
