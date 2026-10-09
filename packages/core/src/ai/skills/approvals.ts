import { blockingProblems } from "./skillFile.js";
import type { InstructionFile, InstructionSource } from "./sources.js";

/**
 * Approvals of instructions on this device (ADR 0020, plan §14.3): nothing
 * that arrives — through sync, an import, a published folder or a vault
 * switch — becomes active by arriving. An approval binds exactly the files and
 * SHA-256 values the user saw; any change lifts it. It lives in the app's data
 * for this vault, never in the vault: whoever can write the vault could write
 * an approval there.
 */

export type InstructionStatus =
  /** Approved at its current content, or one that comes with the app; switched on. */
  | "active"
  /** Never approved on this device. */
  | "new"
  /** Approved once; a file was added, removed or changed since. */
  | "changed"
  /** Not a skill as the format defines it; shown with its problems, never run. */
  | "invalid"
  /** Over the size limits; never read in full, never run. */
  | "too-large"
  /** Switched off on this device by the user. */
  | "off";

/**
 * How an approval came about — the workshop names it. `learned`: the user
 * took a proposal over (plan P6) — they saw the new text in its review —,
 * `restored`: they went back to an earlier version.
 */
export type ApprovalHow = "review" | "created" | "copied" | "imported" | "learned" | "restored";

const APPROVAL_HOWS: readonly ApprovalHow[] = ["review", "created", "copied", "imported", "learned", "restored"];

/** A version taken over from a proposal is watched for this many runs (plan P6); without a failure the watch then ends. */
export const OBSERVED_RUNS = 3;

/**
 * A version under observation (plan P6, mockup chapter 22): the runs that
 * used it since it was taken over, how many of them failed, and the way
 * back. Nothing goes back by itself — a version nobody looked at would be in
 * force then —: a failure only makes the workshop offer it.
 */
export interface ApprovalObservation {
  /** Since when (ISO 8601). */
  since: string;
  runs: number;
  failed: number;
  /** The main file as it was before this version, whole. */
  previous: string;
}

export interface InstructionApproval {
  /** The source's id (`InstructionSource.id`). */
  id: string;
  /** Relative path → SHA-256 of every file, as approved. */
  files: Record<string, string>;
  /** When (ISO 8601). */
  at: string;
  how: ApprovalHow;
  /** The main file's text as approved, for the word comparison once it changes (capped). */
  text?: string;
  /** Where an imported skill came from: the file the user picked, and the archive's SHA-256. */
  from?: { label: string; sha256?: string };
  /**
   * For a script (plan P5.5, ADR 0020 decision 6): this device's signature
   * over what was approved — the vault, the script and its seal —, base64. A
   * script's approval without one that holds is none.
   */
  signature?: string;
  /** Set while this version is watched: it came from a proposal the user took over. Gone with the next approval. */
  observe?: ApprovalObservation;
}

export interface InstructionApprovals {
  approved: InstructionApproval[];
  /** Ids switched off on this device — the app's own skills included. */
  off: string[];
}

export const EMPTY_INSTRUCTION_APPROVALS: InstructionApprovals = { approved: [], off: [] };

/** The approved main text kept for the word comparison, at most this long. */
export const APPROVED_TEXT_MAX = 65_536;

const isText = (v: unknown): v is string => typeof v === "string";
const HEX64 = /^[0-9a-f]{64}$/;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** An observation as it was stored, or null: one that does not read watches nothing — and offers no way back it cannot name. */
function readObservation(raw: unknown): ApprovalObservation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isText(o.since) || !Number.isFinite(Date.parse(o.since)) || !isCount(o.runs) || !isCount(o.failed) || o.failed > o.runs) return null;
  if (!isText(o.previous) || !o.previous || o.previous.length > APPROVED_TEXT_MAX) return null;
  return { since: o.since, runs: o.runs, failed: o.failed, previous: o.previous };
}

/**
 * The stored approvals, field by field. A damaged file approves nothing —
 * every vault instruction asks again; what is switched off stays off only as
 * far as it reads.
 */
export function readInstructionApprovals(raw: string | null): InstructionApprovals {
  if (raw === null) return EMPTY_INSTRUCTION_APPROVALS;
  let value: { version?: unknown; approved?: unknown; off?: unknown };
  try {
    value = JSON.parse(raw) as typeof value;
  } catch {
    return EMPTY_INSTRUCTION_APPROVALS;
  }
  if (!value || value.version !== 1) return EMPTY_INSTRUCTION_APPROVALS;
  const approved: InstructionApproval[] = [];
  for (const item of Array.isArray(value.approved) ? value.approved : []) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (!isText(a.id) || !a.id || !isText(a.at) || !a.files || typeof a.files !== "object" || Array.isArray(a.files)) continue;
    const files = Object.entries(a.files as Record<string, unknown>);
    if (!files.length || !files.every(([path, sha]) => path && isText(sha) && HEX64.test(sha))) continue;
    const how = APPROVAL_HOWS.find((h) => h === a.how) ?? "review";
    const from = a.from && typeof a.from === "object" && isText((a.from as Record<string, unknown>).label) ? (a.from as { label: string; sha256?: unknown }) : null;
    const observe = readObservation(a.observe);
    approved.push({
      id: a.id,
      files: Object.fromEntries(files) as Record<string, string>,
      at: a.at,
      how,
      ...(isText(a.text) ? { text: a.text.slice(0, APPROVED_TEXT_MAX) } : {}),
      ...(from ? { from: { label: from.label.slice(0, 200), ...(isText(from.sha256) && HEX64.test(from.sha256) ? { sha256: from.sha256 } : {}) } } : {}),
      ...(isText(a.signature) && a.signature.length <= 128 ? { signature: a.signature } : {}),
      ...(observe ? { observe } : {}),
    });
  }
  const off = (Array.isArray(value.off) ? value.off : []).filter((id): id is string => isText(id) && id.length > 0);
  return { approved, off: [...new Set(off)] };
}

export function serializeInstructionApprovals(approvals: InstructionApprovals): string {
  return `${JSON.stringify({ version: 1, approved: approvals.approved, off: approvals.off }, null, 2)}\n`;
}

/** True when the files are exactly the approved ones: the same paths, the same hashes. */
export function sameFiles(approved: Record<string, string>, files: readonly InstructionFile[]): boolean {
  const keys = Object.keys(approved);
  return keys.length === files.length && files.every((f) => approved[f.path] === f.sha256);
}

export function approvalOf(approvals: InstructionApprovals, id: string): InstructionApproval | null {
  return approvals.approved.find((a) => a.id === id) ?? null;
}

/**
 * Whether a script's approval is this device's: its signature holds for the
 * script as it is now (`verifyScriptApproval`, with the public half of the
 * key in this device's keychain).
 */
export type ScriptApprovalCheck = (source: InstructionSource, approval: InstructionApproval) => boolean;

/**
 * A source's state on this device. The app's own skills need no approval —
 * they are part of the app, like its code — and can only be switched off.
 *
 * A script (plan P5.5) asks for more than a skill: its approval counts only
 * with this device's signature under it. `signed` checks that; where nobody
 * can — no keychain, no key — a script is never active. An approval whose
 * signature does not hold is one this device never gave: the script is "new".
 */
export function instructionStatus(source: InstructionSource, approvals: InstructionApprovals, signed?: ScriptApprovalCheck): InstructionStatus {
  if (source.tooLarge) return "too-large";
  if (source.kind === "skill" && (!source.skill || blockingProblems(source.problems).length)) return "invalid";
  if (source.kind === "script" && (!source.script || source.code === null || source.code === undefined || (source.scriptProblems?.length ?? 0) > 0)) return "invalid";
  if (source.origin === "vault") {
    const approval = approvalOf(approvals, source.id);
    if (!approval) return "new";
    if (!sameFiles(approval.files, source.files)) return "changed";
    if (source.kind === "script" && !(approval.signature && signed?.(source, approval))) return "new";
  }
  return approvals.off.includes(source.id) ? "off" : "active";
}

/**
 * Approves a source exactly as it is now; an approval of the same id is
 * replaced. `signature`: this device's, for a script — without one a script
 * is not approved at all.
 */
export function approveInstruction(approvals: InstructionApprovals, source: InstructionSource, at: string, how: ApprovalHow, from?: InstructionApproval["from"], signature?: string): InstructionApprovals {
  if (source.tooLarge || !source.files.length) return approvals;
  if (source.kind === "script" && !signature) return approvals;
  const entry: InstructionApproval = {
    id: source.id,
    files: Object.fromEntries(source.files.map((f) => [f.path, f.sha256])),
    at,
    how,
    ...(source.text !== null ? { text: source.text.slice(0, APPROVED_TEXT_MAX) } : {}),
    ...(from ? { from } : {}),
    ...(source.kind === "script" && signature ? { signature } : {}),
  };
  return { ...approvals, approved: [...approvals.approved.filter((a) => a.id !== source.id), entry] };
}

/**
 * Puts the approved version of a source under observation (plan P6): its
 * next runs are counted, and `previous` — the main file as it was before —
 * is the way back while the watch lasts. Without an approval there is nothing
 * to watch, and without a text to go back to no watch is begun.
 */
export function observeInstruction(approvals: InstructionApprovals, id: string, since: string, previous: string): InstructionApprovals {
  if (!previous || previous.length > APPROVED_TEXT_MAX) return approvals;
  return { ...approvals, approved: approvals.approved.map((a) => (a.id === id ? { ...a, observe: { since, runs: 0, failed: 0, previous } } : a)) };
}

/** What a run says about the version it used. */
export type ObservedRun = "clean" | "failed";

/**
 * What the end of a run says about a watched version. An answer is a clean
 * run. A run that ran out of steps or tokens, went in circles, was cut off
 * or refused counts against the version. One the user stopped, or one the
 * provider did not answer, says nothing about the instructions: it is not
 * counted at all.
 */
export function observedRunOf(stop: string): ObservedRun | null {
  if (stop === "answered") return "clean";
  return stop === "limit" || stop === "loop" || stop === "circuit_breaker" || stop === "max_tokens" || stop === "refusal" ? "failed" : null;
}

/**
 * Counts one run of a watched version. After `OBSERVED_RUNS` runs without a
 * failure the watch ends by itself, and with it the copy of the version
 * before. With a failure it stays — and goes on counting — until the user
 * keeps the version or goes back.
 */
export function countObservedRun(approvals: InstructionApprovals, id: string, run: ObservedRun): InstructionApprovals {
  const approval = approvalOf(approvals, id);
  const watch = approval?.observe;
  if (!approval || !watch) return approvals;
  const cap = 999;
  const next: ApprovalObservation = { ...watch, runs: Math.min(cap, watch.runs + 1), failed: Math.min(cap, watch.failed + (run === "failed" ? 1 : 0)) };
  if (next.failed === 0 && next.runs >= OBSERVED_RUNS) return endObservation(approvals, id);
  return { ...approvals, approved: approvals.approved.map((a) => (a.id === id ? { ...a, observe: next } : a)) };
}

/** Ends the watch: the user keeps the version — or the runs said nothing against it. */
export function endObservation(approvals: InstructionApprovals, id: string): InstructionApprovals {
  if (!approvalOf(approvals, id)?.observe) return approvals;
  return {
    ...approvals,
    approved: approvals.approved.map((a) => {
      if (a.id !== id) return a;
      const rest: InstructionApproval = { ...a };
      delete rest.observe;
      return rest;
    }),
  };
}

/** Withdraws the approval: the source is "new" again on this device. */
export function revokeInstruction(approvals: InstructionApprovals, id: string): InstructionApprovals {
  return { ...approvals, approved: approvals.approved.filter((a) => a.id !== id) };
}

export function switchInstruction(approvals: InstructionApprovals, id: string, on: boolean): InstructionApprovals {
  const off = approvals.off.filter((x) => x !== id);
  return { ...approvals, off: on ? off : [...off, id] };
}

/** Forgets approvals and switches of sources that no longer exist (the folder was deleted or renamed). */
export function pruneInstructionApprovals(approvals: InstructionApprovals, existing: ReadonlySet<string>): InstructionApprovals {
  const keep = (id: string) => existing.has(id) || id.startsWith("plainva:");
  return { approved: approvals.approved.filter((a) => keep(a.id)), off: approvals.off.filter(keep) };
}
