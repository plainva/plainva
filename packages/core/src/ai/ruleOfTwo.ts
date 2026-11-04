import type { ToolManifest } from "./tools.js";

/**
 * The Rule of Two as a run-time check (ADR 0019, after Meta's "Agents Rule of
 * Two", 2025-10-31). A run is classified by three properties:
 *
 * - A: it processes untrusted input (vault text, mail, calendar fields, web
 *   pages, tool results — tier 3);
 * - B: it sees private data (notes, tasks, calendar, mail);
 * - C: it can change state or communicate outward (write proposals, critical
 *   and external tools, scripts — and every tool whose call is itself a
 *   request to a third party: fetching a page, searching the web).
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

/**
 * A tool whose use is an outside effect: it changes something, or its call
 * leaves the device for a third party. A script (plan P5.5) is what the tools
 * it may call are: one that only reads and shows is no more of an effect
 * than those tools called one by one — a script has no way out of its own.
 */
export function isEffectTool(tool: ToolManifest): boolean {
  if (tool.script) return tool.script.effect;
  return EFFECT_RISKS.has(tool.risk) || tool.outward === true;
}

export function runTraits(tools: readonly ToolManifest[], context: RunContextTraits): RunTraits {
  return {
    untrustedInput: context.untrustedContext || tools.some((tool) => tool.untrustedResult),
    privateData: context.privateContext || tools.some((tool) => tool.dataClasses.some((c) => PRIVATE_CLASSES.has(c))),
    stateOrOutward: tools.some(isEffectTool),
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
