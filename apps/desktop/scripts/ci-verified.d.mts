/** Types for `ci-verified.mjs` (the E3 question of the CI workflow). */
import type { CheckRun, ChecksVerdict } from "./release-gate.mjs";

export declare function alreadyVerified(runs: CheckRun[], required?: string[]): { verified: boolean; verdict: ChecksVerdict };
export declare function mayAsk(context: { event?: string; ref?: string }): boolean;
