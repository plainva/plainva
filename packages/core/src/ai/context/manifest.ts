import type { GateReason } from "../egressGate.js";
import type { ContextPackage, DataClass, PackageTier, SourceHint } from "./package.js";
import type { SensitiveKind } from "./sensitiveHints.js";
import { folderOf, type CandidateSignal } from "./ranking.js";

/**
 * The send overview (egress manifest, plan §13.3): before anything goes to a
 * provider, what goes — provider and model, the notes and sections, which
 * kinds of data, the folders they come from, what was withheld, an estimate
 * of tokens and cost, the tools the model may call.
 *
 * It is also the consent (Apple 5.1.2(i), Google Play's prominent
 * disclosure), given per SCOPE, not per request (E25): the full overview
 * appears on the first request of a session and whenever the scope grows —
 * another provider or model, a new kind of data, a new folder, tools or the
 * web, a much larger request. Within an approved scope each answer carries
 * its compact line, which opens the same overview.
 */

export interface ManifestSource {
  path: string;
  title: string;
  tier: PackageTier;
  /** The section that went, "" for the text before the first heading; absent = the whole note or a handle. */
  section?: string;
  chars: number;
  unchanged?: boolean;
  /** Why it was chosen, strongest first — the context view's "why". */
  reasons: CandidateSignal[];
  /** Only the passage the user selected went (an action at a selection, plan P1.5). */
  selection?: boolean;
  /** A recording that went to be transcribed, by its size in bytes (plan P1.5). */
  audioBytes?: number;
  /** The remarks of a comment thread on the note went, this many (plan P3-6). */
  comments?: number;
  /** A gist by the model on this computer went for it (plan P2b-3). */
  gist?: boolean;
  /** What the local patterns saw in what it sends (plan P2b-6). */
  sensitive?: SensitiveKind[];
  /** Spans of it sent redacted, at the reader's choice. */
  redacted?: number;
}

export interface EgressManifest {
  providerId: string;
  providerLabel: string;
  model: string;
  /** Where it goes: a provider's cloud, or a server on this computer. */
  local: boolean;
  sources: ManifestSource[];
  dataClasses: DataClass[];
  /** Top-level folders of the notes that go ("" = the vault's root). */
  folders: string[];
  /** What stayed back: notes the rules keep, links to them, place stamps, mood values, and numbers or secrets the reader redacted (P2b-6). */
  withheld: { notes: number; links: number; places: number; moodProperties: number; sensitive?: number };
  /**
   * The kinds the local patterns saw in what goes unredacted (plan P2b-6):
   * one the session has not approved yet brings the overview back.
   */
  sensitive?: SensitiveKind[];
  /** What they saw in the situation's own text — tasks, appointments, the open note's details. */
  situationHint?: SourceHint;
  /** The notes a privacy rule kept back — shown on this device only, never sent. */
  excluded: { path: string; reason: GateReason }[];
  estimatedTokens: number;
  /** When the provider publishes prices for the model. */
  estimatedCostUsd?: number;
  /** The tools the model may call in this run; each call is listed with the answer. */
  tools: string[];
  /**
   * Further tools the conversation reaches through its tool search (ADR
   * 0019): not part of what was approved here — a kind of data among them
   * that no overview named, like mail, asks at its first call.
   */
  more?: string[];
  /** The conversation may use the internet (plan KI-Harness P4): read pages, search. Each request asks while notes are in it. */
  web: boolean;
  /** Sites whose pages are read without asking when the address was named by the user or a source. */
  webHosts?: string[];
  /**
   * A standing approval instead of one request (plan P2a-5, search by
   * meaning with a cloud model): the notes the rules let go — now and each
   * again whenever it changes — and the search questions. `sources` stays
   * empty; `notes` counts them.
   */
  standing?: { notes: number };
  /**
   * Instructions that go with the request (plan KI-Harness P3): approved on
   * this device or part of the app, never data. Those from the vault are the
   * vault's text — the first time they go to a cloud, the scope grows.
   */
  instructions?: ManifestInstructions;
}

export interface ManifestInstructions {
  /** The skill the conversation runs. */
  skill?: { id: string; name: string; origin: "plainva" | "vault"; tokens: number; localPreferred?: boolean };
  /** The skills the model may load; `vault` names the vault's own among them by id. */
  catalog?: { count: number; vault: string[]; tokens: number };
  /** The vault owner's `AGENTS.md`. */
  vault?: { tokens: number };
}

/** The ids of the vault's own instructions a request carries — what the scope counts. */
export function vaultInstructionIds(instructions: ManifestInstructions | undefined): string[] {
  if (!instructions) return [];
  const ids = [...(instructions.catalog?.vault ?? [])];
  if (instructions.skill?.origin === "vault") ids.push(instructions.skill.id);
  if (instructions.vault) ids.push("AGENTS.md");
  return [...new Set(ids)];
}

function topFolder(path: string): string {
  const folder = folderOf(path);
  const cut = folder.indexOf("/");
  return cut < 0 ? folder : folder.slice(0, cut);
}

export function manifestOf(
  pack: ContextPackage,
  provider: { id: string; label: string; local: boolean },
  model: string,
  options: { tools: readonly string[]; more?: readonly string[]; web?: boolean; webHosts?: readonly string[]; priceUsdPerMillionInput?: number; questionChars?: number; instructions?: ManifestInstructions },
): EgressManifest {
  const sources: ManifestSource[] = pack.refs.map((ref) => ({
    path: ref.path,
    title: ref.title,
    tier: ref.tier,
    ...(ref.section !== undefined ? { section: ref.section } : {}),
    chars: ref.chars,
    ...(ref.unchanged ? { unchanged: true } : {}),
    ...(ref.gist ? { gist: true } : {}),
    ...(ref.sensitive ? { sensitive: ref.sensitive } : {}),
    ...(ref.redacted ? { redacted: ref.redacted } : {}),
    reasons: ref.reasons,
  }));
  const folders = [...new Set(pack.refs.map((ref) => topFolder(ref.path)))].sort();
  const instructionTokens = (options.instructions?.skill?.tokens ?? 0) + (options.instructions?.catalog?.tokens ?? 0) + (options.instructions?.vault?.tokens ?? 0);
  const estimatedTokens = pack.estimatedTokens + Math.ceil((options.questionChars ?? 0) / 3.5) + instructionTokens;
  return {
    providerId: provider.id,
    providerLabel: provider.label,
    model,
    local: provider.local,
    sources,
    dataClasses: pack.dataClasses,
    folders,
    withheld: {
      notes: pack.excluded.length,
      links: pack.redactions.withheldLinks,
      places: pack.redactions.places,
      moodProperties: pack.redactions.moodProperties,
      ...(pack.redactions.sensitive ? { sensitive: pack.redactions.sensitive } : {}),
    },
    ...(pack.sensitive ? { sensitive: pack.sensitive } : {}),
    ...(pack.situationHint ? { situationHint: pack.situationHint } : {}),
    excluded: pack.excluded.map((e) => ({ path: e.path, reason: e.reason })),
    estimatedTokens,
    ...(options.priceUsdPerMillionInput !== undefined ? { estimatedCostUsd: (estimatedTokens / 1_000_000) * options.priceUsdPerMillionInput } : {}),
    tools: [...options.tools],
    ...(options.more?.length ? { more: [...options.more] } : {}),
    web: options.web ?? false,
    ...(options.web && options.webHosts?.length ? { webHosts: [...options.webHosts] } : {}),
    ...(options.instructions && (options.instructions.skill || options.instructions.catalog || options.instructions.vault) ? { instructions: options.instructions } : {}),
  };
}

/**
 * The overview of a standing approval for search by meaning (plan P2a-5):
 * `paths` are the notes the rules let go, `withheld` the ones they keep, and
 * the estimate covers the whole vault once — later edits go as they happen.
 */
export function standingManifestOf(
  recipient: { providerId: string; providerLabel: string; model: string; price?: { input: number; output: number } },
  vault: { paths: readonly string[]; withheld: number; bytes: number },
): EgressManifest {
  const estimatedTokens = Math.ceil(vault.bytes / 3.5);
  return {
    providerId: recipient.providerId,
    providerLabel: recipient.providerLabel,
    model: recipient.model,
    local: false,
    sources: [],
    dataClasses: ["notes", "searches"],
    folders: [...new Set(vault.paths.map(topFolder))].sort(),
    withheld: { notes: vault.withheld, links: 0, places: 0, moodProperties: 0 },
    excluded: [],
    estimatedTokens,
    ...(recipient.price ? { estimatedCostUsd: (estimatedTokens / 1_000_000) * recipient.price.input } : {}),
    tools: [],
    web: false,
    standing: { notes: vault.paths.length },
  };
}

/** What the user has approved in this session. */
export interface ApprovedScope {
  /** `providerId/model` pairs. */
  recipients: string[];
  dataClasses: DataClass[];
  folders: string[];
  tools: string[];
  web: boolean;
  /** The largest request approved so far (estimated tokens). */
  maxTokens: number;
  /** Kinds of sensitive text approved to go (plan P2b-6). */
  sensitive?: SensitiveKind[];
  /** The vault's own instructions approved to go (plan KI-Harness P3), by id. */
  instructions?: string[];
  /**
   * Kinds of data a tool brings into a run that no overview named — mail,
   * reached through the tool search (plan KI-Harness P4-4) —, each approved
   * for one recipient: `mail>provider/model`. Asked in the conversation, at
   * the first call; never implied by another recipient's approval.
   */
  toolData?: string[];
}

const toolDataKey = (dataClass: string, recipient: string) => `${dataClass}>${recipient}`;

/** Whether this session approved a kind of tool data for a recipient (`providerId/model`). */
export function toolDataApproved(scope: ApprovedScope | null, dataClass: string, recipient: string): boolean {
  return scope?.toolData?.includes(toolDataKey(dataClass, recipient)) ?? false;
}

/** The scope after the user allowed a kind of tool data to go to a recipient. */
export function approveToolData(scope: ApprovedScope | null, dataClass: string, recipient: string): ApprovedScope {
  const base: ApprovedScope = scope ?? { recipients: [], dataClasses: [], folders: [], tools: [], web: false, maxTokens: 0 };
  const key = toolDataKey(dataClass, recipient);
  return base.toolData?.includes(key) ? base : { ...base, toolData: [...(base.toolData ?? []), key] };
}

export type ScopeGrowth =
  | { kind: "first" }
  | { kind: "recipient"; recipient: string }
  | { kind: "dataClass"; dataClass: DataClass }
  | { kind: "folder"; folder: string }
  | { kind: "tools"; tools: string[] }
  | { kind: "web" }
  | { kind: "size"; tokens: number; approved: number }
  | { kind: "sensitive"; sensitive: SensitiveKind[] }
  | { kind: "instructions"; ids: string[] };

/** A request this much larger than any approved one counts as a new scope ("budget jump"). */
export const SCOPE_SIZE_FACTOR = 3;
/** Small requests never count as a jump, whatever the factor says. */
export const SCOPE_SIZE_FLOOR = 4_000;

/**
 * Why this request needs the full overview; empty when it stays within the
 * approved scope. A request to a server on this computer leaves the device
 * with nothing and needs no approval.
 */
export function scopeGrowth(manifest: EgressManifest, scope: ApprovedScope | null): ScopeGrowth[] {
  if (manifest.local) return [];
  if (!scope) return [{ kind: "first" }];
  const out: ScopeGrowth[] = [];
  const recipient = `${manifest.providerId}/${manifest.model}`;
  if (!scope.recipients.includes(recipient)) out.push({ kind: "recipient", recipient });
  for (const dataClass of manifest.dataClasses) if (!scope.dataClasses.includes(dataClass)) out.push({ kind: "dataClass", dataClass });
  for (const folder of manifest.folders) if (!scope.folders.includes(folder)) out.push({ kind: "folder", folder });
  const newTools = manifest.tools.filter((tool) => !scope.tools.includes(tool));
  if (newTools.length) out.push({ kind: "tools", tools: newTools });
  if (manifest.web && !scope.web) out.push({ kind: "web" });
  const newKinds = (manifest.sensitive ?? []).filter((kind) => !(scope.sensitive ?? []).includes(kind));
  if (newKinds.length) out.push({ kind: "sensitive", sensitive: newKinds });
  const newInstructions = vaultInstructionIds(manifest.instructions).filter((id) => !(scope.instructions ?? []).includes(id));
  if (newInstructions.length) out.push({ kind: "instructions", ids: newInstructions });
  if (manifest.estimatedTokens > SCOPE_SIZE_FLOOR && manifest.estimatedTokens > scope.maxTokens * SCOPE_SIZE_FACTOR) {
    out.push({ kind: "size", tokens: manifest.estimatedTokens, approved: scope.maxTokens });
  }
  return out;
}

/** The scope after the user approved this request. */
export function widenScope(scope: ApprovedScope | null, manifest: EgressManifest): ApprovedScope {
  const base: ApprovedScope = scope ?? { recipients: [], dataClasses: [], folders: [], tools: [], web: false, maxTokens: 0 };
  const union = <T>(a: readonly T[], b: readonly T[]) => [...new Set([...a, ...b])];
  return {
    recipients: union(base.recipients, [`${manifest.providerId}/${manifest.model}`]),
    dataClasses: union(base.dataClasses, manifest.dataClasses),
    folders: union(base.folders, manifest.folders),
    tools: union(base.tools, manifest.tools),
    web: base.web || manifest.web,
    maxTokens: Math.max(base.maxTokens, manifest.estimatedTokens),
    ...(vaultInstructionIds(manifest.instructions).length || base.instructions ? { instructions: union(base.instructions ?? [], vaultInstructionIds(manifest.instructions)) } : {}),
    ...(base.sensitive || manifest.sensitive ? { sensitive: union(base.sensitive ?? [], manifest.sensitive ?? []) } : {}),
    // Approvals given in a conversation stay: another request's overview neither grants nor withdraws them.
    ...(base.toolData ? { toolData: base.toolData } : {}),
  };
}
