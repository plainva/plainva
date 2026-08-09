/**
 * Plainva's own section inside a Sieve script (S13, decision E4).
 *
 * A mail account's Sieve script is the user's, not Plainva's. People write
 * rules there by hand, other clients write theirs, and a server-side filter is
 * exactly the kind of thing where silently losing a line costs real mail. So
 * Plainva never owns the file: it owns one clearly marked SECTION of it, reads
 * everything else as opaque, and writes it back byte for byte.
 *
 * Everything in here is pure. The protocol lives elsewhere (`net/sieve.ts` for
 * mobile, `mail_sieve.rs` for the desktop) — this decides what gets written.
 */

export const SIEVE_BEGIN = "# --- BEGIN PLAINVA (do not edit this section) ---";
export const SIEVE_END = "# --- END PLAINVA ---";

/** A script split into what Plainva may touch and what it must not. */
export interface SieveSplit {
  before: string;
  /** Plainva's section WITHOUT the markers, or null when there is none yet. */
  section: string | null;
  after: string;
}

/**
 * Splits a script around Plainva's markers.
 *
 * A script with a BEGIN but no END is NOT half-parsed: an unterminated marker
 * means the file is in a state Plainva did not produce, and guessing where the
 * section ends would eat whatever follows. It reports "no section" and the
 * caller refuses to write — the one case where doing nothing is right.
 */
export function splitSieve(script: string): SieveSplit | null {
  const begin = script.indexOf(SIEVE_BEGIN);
  if (begin < 0) return { before: script, section: null, after: "" };
  const endMark = script.indexOf(SIEVE_END, begin);
  if (endMark < 0) return null; // unterminated — refuse rather than guess
  const bodyStart = begin + SIEVE_BEGIN.length;
  return {
    before: script.slice(0, begin),
    section: script.slice(bodyStart, endMark).replace(/^\r?\n/, "").replace(/\r?\n$/, ""),
    after: script.slice(endMark + SIEVE_END.length).replace(/^\r?\n/, ""),
  };
}

/** Joins a split back together, dropping the section entirely when it is empty. */
function joinSieve(split: SieveSplit, section: string | null): string {
  const parts: string[] = [];
  const before = split.before.replace(/\s+$/, "");
  const after = split.after.replace(/^\s+/, "");
  if (before) parts.push(before);
  if (section && section.trim()) parts.push(`${SIEVE_BEGIN}\n${section.trim()}\n${SIEVE_END}`);
  if (after) parts.push(after);
  return parts.join("\n\n").replace(/\s*$/, "") + "\n";
}

/**
 * Replaces (or removes) Plainva's section and returns the whole script.
 *
 * Returns null when the script cannot be handled safely — an unterminated
 * marker. The caller reports that instead of overwriting.
 */
export function writeSieveSection(script: string, section: string | null): string | null {
  const split = splitSieve(script);
  if (!split) return null;
  return joinSieve(split, section);
}

/** Which `require` extensions a section needs, deduplicated and ordered. */
function requireLine(extensions: readonly string[]): string {
  const unique = [...new Set(extensions)].sort();
  return unique.length ? `require [${unique.map((e) => `"${e}"`).join(", ")}];` : "";
}

export interface VacationSettings {
  enabled: boolean;
  subject?: string;
  message: string;
  /** ISO dates (YYYY-MM-DD), both inclusive. Optional: without them the reply
   * runs until switched off. */
  from?: string;
  to?: string;
  /** Days before the same sender is answered again. RFC 5230 default is 7. */
  days?: number;
  /** Addresses this mailbox answers for, so a reply is not sent for mail that
   * merely passed through. */
  addresses?: readonly string[];
}

/** Escapes a Sieve quoted string (RFC 5228 §2.4.2: only \ and " are special). */
export function sieveQuote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A multi-line body as a Sieve multiline literal, with dot-stuffing. */
function sieveText(body: string): string {
  const stuffed = body.replace(/\r\n/g, "\n").replace(/^\./gm, "..");
  return `text:\n${stuffed}\n.\n`;
}

/**
 * Builds the vacation rule.
 *
 * The date window is a `currentdate` test, not a promise the client keeps:
 * putting it in the script means the reply starts and stops even if Plainva is
 * never opened again — which is the whole point of a server-side auto-reply.
 * Returns null when the notice is off, so the caller removes the section.
 */
export function buildVacationSection(settings: VacationSettings): { section: string; extensions: string[] } | null {
  if (!settings.enabled || !settings.message.trim()) return null;

  const extensions = ["vacation"];
  const parts: string[] = [];
  if (settings.days !== undefined) parts.push(`:days ${Math.max(1, Math.round(settings.days))}`);
  if (settings.subject?.trim()) parts.push(`:subject ${sieveQuote(settings.subject.trim())}`);
  const addresses = (settings.addresses ?? []).filter((a) => a.trim());
  if (addresses.length) parts.push(`:addresses [${addresses.map((a) => sieveQuote(a.trim())).join(", ")}]`);

  const vacation = `vacation ${parts.join(" ")}${parts.length ? " " : ""}${sieveText(settings.message)}`;

  const tests: string[] = [];
  if (settings.from) {
    extensions.push("date", "relational");
    tests.push(`currentdate :value "ge" "date" ${sieveQuote(settings.from)}`);
  }
  if (settings.to) {
    extensions.push("date", "relational");
    tests.push(`currentdate :value "le" "date" ${sieveQuote(settings.to)}`);
  }

  const body = tests.length ? `if allof(${tests.join(", ")})\n{\n${indent(vacation)}}\n` : vacation;
  return { section: `${requireLine(extensions)}\n${body}`.trim(), extensions: [...new Set(extensions)] };
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
}

/**
 * The whole job in one call: read a script, put the notice in (or take it out),
 * hand back what to upload. Null means the script must not be touched.
 */
export function applyVacation(script: string, settings: VacationSettings): string | null {
  const built = buildVacationSection(settings);
  return writeSieveSection(script, built?.section ?? null);
}
