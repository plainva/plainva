import type { AiPolicyDimension, EffectivePolicy, PolicySource } from "./policy.js";

/**
 * The privacy hard gate (ADR 0018): it runs BEFORE candidate scoring,
 * compaction and display, so a note the policy keeps away from a recipient
 * contributes nothing — no title, gist, file name, link anchor or embedding.
 * The native egress checks the recipient again; this gate decides what may
 * be assembled at all.
 */

export type EgressRecipient =
  /** A provider API with the user's key, or a gateway the user chose. */
  | { kind: "cloud"; provider: string; model: string }
  /** Apple Private Cloud Compute: a server, with Apple's assurances. */
  | { kind: "platform-cloud"; provider: string; model: string }
  /** Apple Foundation Models on the device, Gemini Nano. */
  | { kind: "platform-device"; provider: string; model: string }
  /** Ollama, LM Studio, llama-server, a bundled model pack. */
  | { kind: "local"; provider: string; model: string };

export function isCloudRecipient(recipient: EgressRecipient): boolean {
  return recipient.kind === "cloud" || recipient.kind === "platform-cloud";
}

export interface GateRun {
  recipient: EgressRecipient;
  /** True when web tools (fetch, search) take part in the run. */
  webTools: boolean;
}

export type GateReason = "cloud-denied" | "web-denied";

export interface GateDecision {
  allowed: boolean;
  reason?: GateReason;
  /** Which rule decided — the "why" the context view shows. */
  source?: PolicySource;
}

export function gateDecision(effective: EffectivePolicy, run: GateRun): GateDecision {
  const check = (dimension: AiPolicyDimension, reason: GateReason): GateDecision | null =>
    effective.policy[dimension] === "deny" ? { allowed: false, reason, source: effective.sources[dimension] } : null;
  if (isCloudRecipient(run.recipient)) {
    const denied = check("cloud", "cloud-denied");
    if (denied) return denied;
  }
  if (run.webTools) {
    const denied = check("web", "web-denied");
    if (denied) return denied;
  }
  return { allowed: true };
}

export interface GateExclusion {
  path: string;
  reason: GateReason;
  source?: PolicySource;
}

export interface GateResult<T> {
  allowed: T[];
  excluded: GateExclusion[];
}

/**
 * Splits candidates into what may be assembled for this run and what may not.
 * `policyOf` is asked once per distinct path; the exclusions are what the
 * send overview lists as "excluded local sources" — by path only, never by
 * content, and never sent anywhere.
 */
export function hardGate<T>(
  candidates: readonly T[],
  pathOf: (candidate: T) => string,
  policyOf: (path: string) => EffectivePolicy,
  run: GateRun,
): GateResult<T> {
  const decisions = new Map<string, GateDecision>();
  const allowed: T[] = [];
  const excluded: GateExclusion[] = [];
  for (const candidate of candidates) {
    const path = pathOf(candidate);
    let decision = decisions.get(path);
    if (!decision) {
      decision = gateDecision(policyOf(path), run);
      decisions.set(path, decision);
      if (!decision.allowed) excluded.push({ path, reason: decision.reason!, source: decision.source });
    }
    if (decision.allowed) allowed.push(candidate);
  }
  return { allowed, excluded };
}

// The withholding of links lives with the vault's own reading, which the start uses without the AI (performance plan L5).
export { WITHHELD_LINK, redactDeniedLinks, mayHoldAWithheldLink, linkTargetsOfPlainBlock, redactDeniedLinksIn } from "../withholding/links.js";
