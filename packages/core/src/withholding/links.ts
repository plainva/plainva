import { foldedLines, frontmatterSpan } from "../frontmatter-block.js";
import { wikiLinkParts } from "../wikiLink.js";
import { ReaderView } from "./readerView.js";

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

/**
 * The link targets `redactDeniedLinksIn` asks about in a properties block (with its fences) in which no link runs over
 * a line, no escape or doubled quote stands and no reference is defined (`plainBlock`, `propertiesInView.ts`): there
 * it reads wiki links — as written and as YAML reads them — and Markdown links only, and asks about the same targets
 * in the same order, read here without forming a view of the text.
 */
export function linkTargetsOfPlainBlock(block: string): string[] {
  const targets: string[] = [];
  if (!LINK_SHAPE.test(block)) return targets;
  for (const match of block.matchAll(WIKI_LINK)) {
    const inner = match[1]!;
    const written = wikiLinkParts(inner).target;
    if (written) targets.push(written);
    // YAML reads the text between the brackets otherwise only where it holds a comment, a tab, a line break, a comma
    // or blanks at its ends or side by side (`asYamlReadsIt`).
    if (!/[#\t\r,]| {2}|^ | $/.test(inner)) continue;
    const read = wikiLinkParts(asYamlReadsIt(inner)).target;
    if (read && read !== written) targets.push(read);
  }
  if (!block.includes("](")) return targets;
  for (const match of block.matchAll(INLINE_LINK)) {
    const target = vaultTarget(match[2] ?? match[3] ?? "");
    if (target) targets.push(target);
  }
  return targets;
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
