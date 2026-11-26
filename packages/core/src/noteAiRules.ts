/**
 * What a note, a folder or the vault can say about the AI (ADR 0017): two dimensions — the cloud and the web —, each
 * allowed or denied. Part of the note format (`plainva.ai.cloud: deny` in a note's properties), so the vault reads
 * and writes it without the AI harness (performance plan L5); the harness's policy (`ai/policy.ts`) resolves it.
 */
export type AiPermission = "allow" | "deny";

export interface AiPolicy {
  cloud: AiPermission;
  web: AiPermission;
}

export type AiPolicyDimension = keyof AiPolicy;
export const AI_POLICY_DIMENSIONS: readonly AiPolicyDimension[] = ["cloud", "web"];
