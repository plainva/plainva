import { WorkspaceProtocolError } from "./errors.js";

/**
 * The stable cause of a quarantine entry (finding 2026-09-03).
 *
 * The worker stores the raw diagnostic sentence of the failed check - an
 * English protocol message nobody should have to read in a settings screen.
 * Every such sentence maps onto one FAMILY here; the stored code is
 * `<artifact kind>.<family>`, so a screen can say what happened in the
 * person's language, group entries that share a cause, and still tell a
 * broken policy from a broken operation. The sentence stays in `reason` for
 * the diagnosis export.
 *
 * The families are the texts a person can act on, not the assertion sites:
 * three "path hash mismatch" checks are one story ("the file was renamed or
 * replaced on the way"), so they share one family.
 */
export type QuarantineReasonFamily =
  | "binding"
  | "pathHash"
  | "signature"
  | "policyChain"
  | "policyUnaccepted"
  | "authorNotActive"
  | "postRevocation"
  | "capability"
  | "missingParents"
  | "chainGap"
  | "chainBlocked"
  | "payloadMissing"
  | "envelope"
  | "rollback"
  | "checkpointMissing"
  | "unreadable"
  | "unknown";

export const QUARANTINE_REASON_FAMILIES: readonly QuarantineReasonFamily[] = [
  "binding", "pathHash", "signature", "policyChain", "policyUnaccepted", "authorNotActive", "postRevocation", "capability", "missingParents",
  "chainGap", "chainBlocked", "payloadMissing", "envelope", "rollback", "checkpointMissing", "unreadable", "unknown",
];

/** Families whose entry offers advice beyond the explanation. */
export const QUARANTINE_HINTED_FAMILIES: readonly QuarantineReasonFamily[] = [
  "chainGap", "policyUnaccepted", "authorNotActive", "postRevocation", "capability", "payloadMissing", "missingParents", "unreadable", "unknown",
];

const MESSAGE_FAMILIES: ReadonlyArray<readonly [RegExp, QuarantineReasonFamily]> = [
  [/chain has a gap/i, "chainGap"],
  [/chain is blocked/i, "chainBlocked"],
  [/PVO1 .*binding mismatch|missing payload references/i, "envelope"],
  [/binding mismatch/i, "binding"],
  [/path hash mismatch/i, "pathHash"],
  [/signature (?:verification failed|is invalid)/i, "signature"],
  [/not on the accepted successor chain/i, "policyChain"],
  [/unaccepted policy/i, "policyUnaccepted"],
  [/not an active policy device/i, "authorNotActive"],
  [/after the device was revoked/i, "postRevocation"],
  [/capability is not granted/i, "capability"],
  [/missing revision parents/i, "missingParents"],
  [/checkpoint is missing or changed/i, "checkpointMissing"],
  [/payload object is missing or changed/i, "payloadMissing"],
  [/rolled back/i, "rollback"],
];

export function quarantineReasonFamily(error: unknown): QuarantineReasonFamily {
  if (error instanceof WorkspaceProtocolError) {
    for (const [pattern, family] of MESSAGE_FAMILIES) if (pattern.test(error.message)) return family;
    // A protocol error the table does not know is still a validation
    // failure of a readable artifact - except when the parser refused it.
    return error.code === "format" || error.code === "bounds" || error.code === "canonical" || error.code === "unsupported" ? "unreadable" : "unknown";
  }
  // Anything that is not a protocol error came out of a parser or a cipher:
  // the bytes could not be read as what their key says they are.
  return error instanceof Error ? "unreadable" : "unknown";
}

export function quarantineReasonCode(artifactKind: string, error: unknown): string {
  return `${artifactKind}.${quarantineReasonFamily(error)}`;
}

/** The family behind a stored code; an unknown or legacy code reads as `unknown`. */
export function quarantineReasonFamilyOf(reasonCode: string | null | undefined): QuarantineReasonFamily {
  const family = reasonCode?.split(".")[1] as QuarantineReasonFamily | undefined;
  return family && QUARANTINE_REASON_FAMILIES.includes(family) ? family : "unknown";
}
