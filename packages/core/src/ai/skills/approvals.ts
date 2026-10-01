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

/** How an approval came about — the workshop names it. */
export type ApprovalHow = "review" | "created" | "copied" | "imported";

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
    const how = (["review", "created", "copied", "imported"] as const).find((h) => h === a.how) ?? "review";
    const from = a.from && typeof a.from === "object" && isText((a.from as Record<string, unknown>).label) ? (a.from as { label: string; sha256?: unknown }) : null;
    approved.push({
      id: a.id,
      files: Object.fromEntries(files) as Record<string, string>,
      at: a.at,
      how,
      ...(isText(a.text) ? { text: a.text.slice(0, APPROVED_TEXT_MAX) } : {}),
      ...(from ? { from: { label: from.label.slice(0, 200), ...(isText(from.sha256) && HEX64.test(from.sha256) ? { sha256: from.sha256 } : {}) } } : {}),
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
 * A source's state on this device. The app's own skills need no approval —
 * they are part of the app, like its code — and can only be switched off.
 */
export function instructionStatus(source: InstructionSource, approvals: InstructionApprovals): InstructionStatus {
  if (source.tooLarge) return "too-large";
  if (source.kind === "skill" && (!source.skill || blockingProblems(source.problems).length)) return "invalid";
  if (source.origin === "vault") {
    const approval = approvalOf(approvals, source.id);
    if (!approval) return "new";
    if (!sameFiles(approval.files, source.files)) return "changed";
  }
  return approvals.off.includes(source.id) ? "off" : "active";
}

/** Approves a source exactly as it is now; an approval of the same id is replaced. */
export function approveInstruction(approvals: InstructionApprovals, source: InstructionSource, at: string, how: ApprovalHow, from?: InstructionApproval["from"]): InstructionApprovals {
  if (source.tooLarge || !source.files.length) return approvals;
  const entry: InstructionApproval = {
    id: source.id,
    files: Object.fromEntries(source.files.map((f) => [f.path, f.sha256])),
    at,
    how,
    ...(source.text !== null ? { text: source.text.slice(0, APPROVED_TEXT_MAX) } : {}),
    ...(from ? { from } : {}),
  };
  return { ...approvals, approved: [...approvals.approved.filter((a) => a.id !== source.id), entry] };
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
