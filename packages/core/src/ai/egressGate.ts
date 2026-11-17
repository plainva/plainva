import { foldedLines, frontmatterSpan } from "../frontmatter-block.js";
import { wikiLinkParts } from "../wikiLink.js";
import { ReaderView } from "./readerView.js";
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

/**
 * A wiki link: what stands between `[[` and `]]` on one line. Its target is read by the index's own reading
 * (`wikiLinkParts`), never by a pattern of its own — a bar kept in a table cell (`[[Note\|alias]]`) ends the name in
 * front of its backslash there as here (review of R19, wave 2: the pattern read `Note\` and found no note).
 */
const WIKI_LINK = /!?\[\[([^[\]\n]+)\]\]/g;
/**
 * A wiki link spread over lines, in the properties block only: `up: [[Meier,\n  Kowalski]]` is one link to YAML and
 * to whoever reads the value — its line breaks folded into blanks, as YAML folds them (review of R19, wave 2). In the
 * text of a note no reader takes such a thing for a link, and neither does this one.
 */
const SPREAD_WIKI_LINK = /\[\[((?:[^[\]\n]*\n)+[^[\]\n]*)\]\]/g;
/**
 * How YAML reads the text between a link's brackets where the link stands in the properties block without quotes: a
 * comment (` # …`) to the end of its line is no part of it, and blanks, tabs and line breaks are one blank, a comma
 * followed by one. `[[Meier,\tKowalski]]` and `[[Meier,  # c\n  Kowalski]]` are the names `Meier` and `Kowalski` to
 * YAML — the note `Meier, Kowalski` to whoever reads the value (review of R19, wave 2).
 */
function asYamlReadsIt(inner: string): string {
  return inner
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/(?:^|[ \t])#.*$/, ""))
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?, ?/g, ", ")
    .trim();
}
/**
 * A quoted text in the properties block (review of R19, wave 2): YAML reads `"\x5b\x5bMeier\x5d\x5d"` and
 * `"[[Mei\x65r]]"` as `[[Meier]]`, `'[[O''Brien]]'` as `[[O'Brien]]`. One that holds an escape or a doubled quote is
 * read once more as YAML reads it, and withheld whole where that reading holds a link the reader may not follow.
 */
const QUOTED = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\n]|'')*'/g;
/** The escapes of a double-quoted YAML text, as YAML reads them (YAML 1.2, 5.7). */
const ESCAPES: Record<string, string> = { "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\x85", _: "\xa0", L: "\u2028", P: "\u2029" };
/** A quoted text of the properties block as YAML reads it; null where it reads as it is written. */
function asYamlDecodes(quoted: string): string | null {
  const inner = quoted.slice(1, -1);
  if (quoted.startsWith("'")) return inner.includes("''") ? inner.replace(/''/g, "'") : null;
  if (!inner.includes("\\")) return null;
  return inner.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (all, code: string) => {
    if (code.length > 1) {
      const point = Number.parseInt(code.slice(1), 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : all;
    }
    return ESCAPES[code] ?? all;
  });
}
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
  const { view, redacted } = redactDeniedLinksIn(ReaderView.of(text), isDenied);
  return { text: view.text, redacted };
}

/**
 * Whether a text can hold a link `redactDeniedLinksIn` withholds: every way it reads one is written with `[[`, with
 * `](` or with a reference's `]:` (a reference's uses count only beside its definition), and a quoted text of a
 * properties block builds one only from an escape (`\`). A text without any of them is withheld as it is.
 */
const LINK_SHAPE = /\[\[|\]\(|\]:|\\/;
export function mayHoldAWithheldLink(text: string): boolean {
  return LINK_SHAPE.test(text);
}

/** `redactDeniedLinks` on a reader's view: each withheld link becomes a withheld piece of it (`ReaderView`). */
export function redactDeniedLinksIn(view: ReaderView, isDenied: (target: string) => boolean): { view: ReaderView; redacted: number } {
  if (!LINK_SHAPE.test(view.text)) return { view, redacted: 0 };
  let redacted = 0;
  const withheld = () => {
    redacted++;
    return WITHHELD_LINK;
  };
  // A link in the properties block is read the way YAML reads it as well (`asYamlReadsIt`): denied where either
  // reading is.
  const blockOf = (text: string) => (text.startsWith("---") || text.startsWith("\uFEFF---") ? (frontmatterSpan(text)?.end ?? 0) : 0);
  const deniedIn = (inner: string, inBlock: boolean, spread = false): boolean => {
    const written = wikiLinkParts(spread ? foldedLines(inner) : inner).target;
    if (!inBlock) return Boolean(written) && isDenied(written);
    const read = wikiLinkParts(asYamlReadsIt(inner)).target;
    return Boolean(written && isDenied(written)) || Boolean(read && read !== written && isDenied(read));
  };
  // A link to a place in the note itself (`[[#Heading]]`) names no other note.
  const first = blockOf(view.text);
  let out = view.replace(WIKI_LINK, (match, inner: string, at: number) => (deniedIn(inner, at < first) ? withheld() : match));
  const block = blockOf(out.text);
  if (block > 0) {
    out = out.replace(SPREAD_WIKI_LINK, (match, inner: string, at: number) => (at < block && deniedIn(inner, true, true) ? withheld() : match));
    // A quoted text whose escapes YAML reads into a link: withheld whole, its quotes kept.
    out = out.replace(QUOTED, (match, at: number) => {
      if (at >= block) return match;
      const decoded = asYamlDecodes(match);
      if (decoded === null) return match;
      let denied = false;
      for (const link of decoded.matchAll(WIKI_LINK)) if (deniedIn(link[1]!, true)) denied = true;
      for (const link of decoded.matchAll(INLINE_LINK)) {
        const target = vaultTarget(link[2] ?? link[3] ?? "");
        if (target && isDenied(target)) denied = true;
      }
      if (!denied) return match;
      redacted++;
      return `${match[0]}${WITHHELD_LINK}${match[0]}`;
    });
  }
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
  return { view: out, redacted };
}
