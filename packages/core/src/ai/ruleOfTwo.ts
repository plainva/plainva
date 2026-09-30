import type { ToolManifest } from "./tools.js";

/**
 * The Rule of Two as a run-time check (ADR 0019, after Meta's "Agents Rule of
 * Two", 2025-10-31). A run is classified by three properties:
 *
 * - A: it processes untrusted input (vault text, mail, calendar fields, web
 *   pages, tool results — tier 3);
 * - B: it sees private data (notes, tasks, calendar, mail);
 * - C: it can change state or communicate outward (write proposals, critical
 *   and external tools, scripts).
 *
 * A run with all three needs an approval for EACH outside effect and can
 * never be an unattended routine. Navigation (`ui`) is not state in this
 * sense: it changes what the user sees, not what exists.
 */

export interface RunTraits {
  untrustedInput: boolean;
  privateData: boolean;
  stateOrOutward: boolean;
}

export interface RunContextTraits {
  /** Vault, mail or calendar content is in the context package. */
  privateContext: boolean;
  /** Anything tier 3 is in the context package (in practice: any vault text). */
  untrustedContext: boolean;
}

const EFFECT_RISKS = new Set(["write", "critical", "external", "script"]);
const PRIVATE_CLASSES = new Set(["notes", "tasks", "calendar", "mail"]);

export function runTraits(tools: readonly ToolManifest[], context: RunContextTraits): RunTraits {
  return {
    untrustedInput: context.untrustedContext || tools.some((tool) => tool.untrustedResult),
    privateData: context.privateContext || tools.some((tool) => tool.dataClasses.some((c) => PRIVATE_CLASSES.has(c))),
    stateOrOutward: tools.some((tool) => EFFECT_RISKS.has(tool.risk)),
  };
}

export interface RuleOfTwoVerdict {
  /** All three properties hold. */
  allThree: boolean;
  /** Every outside effect needs its own approval (never "approve all"). */
  approvalPerEffect: boolean;
  /** May run unattended (a routine): never with all three. */
  unattendedAllowed: boolean;
}

export function ruleOfTwo(traits: RunTraits): RuleOfTwoVerdict {
  const allThree = traits.untrustedInput && traits.privateData && traits.stateOrOutward;
  return { allThree, approvalPerEffect: allThree, unattendedAllowed: !allThree };
}
