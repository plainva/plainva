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

/** What a withheld link becomes: says that something was there, not what. */
export const WITHHELD_LINK = "⟦withheld note⟧";

const WIKI_LINK = /!?\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|[^[\]\n]*)?\]\]/g;
/**
 * A Markdown link: its destination in angle brackets — where it may hold
 * blanks — or as a run without blanks, with one level of round brackets; then
 * an optional title in any of its three forms.
 */
const INLINE_LINK = /!?\[([^[\]\n]*)\]\(\s*(?:<([^<>\n]*)>|((?:[^()\s<>]|\([^()\s<>]*\))+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
/** A link reference definition, on a line of its own: `[label]: destination "title"`. */
const REFERENCE_DEFINITION = /^ {0,3}\[([^[\]\n]+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/gm;
/** A use of a reference by its label: `[text][label]`, `[label][]`. */
const REFERENCE_USE = /!?\[([^[\]\n]*)\]\[([^[\]\n]*)\]/g;
/** The short form, `[label]` alone: no part of a wiki link, no link's text, no definition. */
const REFERENCE_SHORT = /(?<![[\]])!?\[([^[\]\n]+)\](?![[(:\]])/g;

/** A reference's label as it is compared: without regard to letter case, a run of blanks as one. */
const referenceLabel = (label: string) => label.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();

/** A Markdown destination as a target inside the vault; null where it leads out of it or names a place in the note itself. */
function vaultTarget(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) return null;
  const path = href.split("#")[0]!;
  let target: string;
  try {
    target = decodeURIComponent(path);
  } catch {
    target = path;
  }
  return target.trim() || null;
}

/**
 * Removes references to denied notes from text that IS allowed: wikilinks
 * (`[[Note]]`, `[[Note#Heading]]`, `[[Note|alias]]`, embeds `![[Note]]`),
 * Markdown links to vault paths — the destination bare or in angle brackets —
 * and reference links, the definition together with every use of its label.
 * A denied note's title would otherwise leak through a backlink anchor or a
 * relation value of an allowed neighbour. `isDenied` receives the link target
 * as written (without heading or alias); telling which notes it could mean
 * is the caller's job (`linkNamesDeniedNote` knows the vault).
 *
 * Not found: a link written as HTML (`<a href>`), and a note's name that
 * merely stands in the text. Neither is link syntax of a Markdown vault.
 */
export function redactDeniedLinks(text: string, isDenied: (target: string) => boolean): { text: string; redacted: number } {
  let redacted = 0;
  const withheld = () => {
    redacted++;
    return WITHHELD_LINK;
  };
  let out = text.replace(WIKI_LINK, (match, target: string) => (isDenied(target.trim()) ? withheld() : match));
  out = out.replace(INLINE_LINK, (match, _label: string, angled: string | undefined, bare: string | undefined) => {
    const target = vaultTarget(angled ?? bare ?? "");
    return target && isDenied(target) ? withheld() : match;
  });
  // A reference link names its note in the definition and carries its text where the label is used: both go.
  const deniedLabels = new Set<string>();
  out = out.replace(REFERENCE_DEFINITION, (match, label: string, angled: string | undefined, bare: string | undefined) => {
    const target = vaultTarget(angled ?? bare ?? "");
    const name = referenceLabel(label);
    // A label of blanks is none: `[ ]` is a box to tick, wherever it stands.
    if (!name || !target || !isDenied(target)) return match;
    deniedLabels.add(name);
    return withheld();
  });
  if (deniedLabels.size) {
    out = out.replace(REFERENCE_USE, (match, shown: string, label: string) => (deniedLabels.has(referenceLabel(label || shown)) ? withheld() : match));
    out = out.replace(REFERENCE_SHORT, (match, label: string) => (deniedLabels.has(referenceLabel(label)) ? withheld() : match));
  }
  return { text: out, redacted };
}
