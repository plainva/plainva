export type SecurityEvidenceKind = "automated" | "independent-review" | "physical-device" | "store-build";
export interface SecurityEvidence { id: string; kind: SecurityEvidenceKind; passed: boolean; completedAt?: string; reference?: string; criticalFindings?: number; }
export interface SecurityReleaseGate { ready: boolean; automatedReady: boolean; missing: string[]; criticalFindings: number; }

const REQUIRED = ["workspace-unit", "workspace-fuzz", "provider-faults", "desktop-e2e", "mobile-background", "independent-crypto-review", "android-two-device", "ios-two-device", "android-internal-build", "ios-testflight-build"] as const;

/** Hard release gate: external evidence cannot be substituted by a local test. */
export function evaluateSecurityReleaseGate(evidence: SecurityEvidence[]): SecurityReleaseGate {
  const byId = new Map(evidence.map((entry) => [entry.id, entry]));
  const missing = REQUIRED.filter((id) => !byId.get(id)?.passed);
  const criticalFindings = evidence.reduce((sum, entry) => sum + Math.max(0, entry.criticalFindings ?? 0), 0);
  const automatedReady = ["workspace-unit", "workspace-fuzz", "provider-faults", "desktop-e2e", "mobile-background"].every((id) => byId.get(id)?.passed);
  return { ready: missing.length === 0 && criticalFindings === 0, automatedReady, missing: [...missing], criticalFindings };
}
