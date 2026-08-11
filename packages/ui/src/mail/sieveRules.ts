import { sieveQuote } from "./sieveScript";
import type { MailRule, RuleAction, RuleCondition } from "./rules";

/**
 * Translating the rule model into Sieve (S15, decision E4).
 *
 * The model from S14 was cut to be the common denominator of what a server can
 * express, so this file is a translation and not an interpretation. Where a
 * rule cannot be expressed — because the server lacks the extension it would
 * need — it is reported as skipped and stays local. That is the honest failure:
 * a script Plainva uploads with a `require` the server does not have is
 * rejected as a WHOLE, which would take the out-of-office notice down with it.
 *
 * Everything here is pure.
 */

/** Mailbox names the abstract actions resolve to. The caller knows them from
 * the folder list; guessing "Junk" would file mail into a folder that may not
 * exist and, on a strict server, fail the upload. */
export interface RuleMailboxes {
  junk?: string;
  trash?: string;
}

export interface RulesSection {
  /** The Sieve body without the `require` line — the caller merges requires
   * across everything it writes, because Sieve allows them only at the top. */
  body: string;
  extensions: string[];
  /** Rules that could not be translated, with the reason, so the interface can
   * say which ones keep running locally instead of quietly dropping them. */
  skipped: { id: string; reason: SkipReason }[];
}

export type SkipReason =
  /** The server does not advertise an extension the rule needs. */
  | "unsupported"
  /** The rule has no conditions, or none that carry a value. */
  | "empty"
  /** An action needs a mailbox the account does not have (junk/trash). */
  | "noMailbox"
  /**
   * The rule does something only Plainva can do — filing the message as a note.
   * The whole rule stays local: uploading it WITHOUT that action would let the
   * server move the message first and leave nothing to file. Not a limitation
   * of the server, so it does not share "unsupported".
   */
  | "localAction";

/** Escapes the glob metacharacters of a Sieve `:matches` pattern.
 *
 * Order matters and is easy to get wrong: the backslash goes first, then the
 * wildcards, and only afterwards does `sieveQuote` escape the backslashes again
 * for the string literal. A `*` in a search value must reach the server as the
 * two characters `\*` — written `\\*` inside the quoted string. */
function globEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[*?]/g, "\\$&");
}

/** The header a field maps to. */
function headerOf(condition: RuleCondition): string | null {
  switch (condition.field) {
    case "from":
      return "from";
    case "to":
      return "to";
    case "cc":
      return "cc";
    case "subject":
      return "subject";
    case "header":
      return condition.header?.trim() || null;
    case "body":
      return null; // not a header — handled separately
  }
}

/** Whether a field names an address rather than free text. */
const isAddressField = (condition: RuleCondition) =>
  condition.field === "from" || condition.field === "to" || condition.field === "cc";

/**
 * One condition as a Sieve test.
 *
 * Address fields are matched on the ADDRESS, not the raw header. The user
 * picked "sender", and on a raw header `:is "chef@firma.de"` could never match
 * `"Chef" <chef@firma.de>` — a comparison that can never be true is worse than
 * one that is occasionally too narrow.
 */
function testFor(condition: RuleCondition, extensions: Set<string>): string | null {
  const value = condition.value.trim();
  if (!value) return null;

  // Sieve has no :startswith — those become globs, which is why the value has
  // to be glob-escaped before it is quoted.
  const [matchOp, key] =
    condition.op === "is"
      ? [":is", value]
      : condition.op === "startsWith"
        ? [":matches", `${globEscape(value)}*`]
        : condition.op === "endsWith"
          ? [":matches", `*${globEscape(value)}`]
          : [":contains", value];

  let test: string;
  if (condition.field === "body") {
    extensions.add("body");
    test = `body :text ${matchOp} ${sieveQuote(key)}`;
  } else {
    const header = headerOf(condition);
    if (!header) return null;
    test = isAddressField(condition)
      ? `address :all ${matchOp} ${sieveQuote(header)} ${sieveQuote(key)}`
      : `header ${matchOp} ${sieveQuote(header)} ${sieveQuote(key)}`;
  }
  return condition.op === "notContains" ? `not ${test}` : test;
}

function actionFor(action: RuleAction, mailboxes: RuleMailboxes, extensions: Set<string>): string | null {
  switch (action.kind) {
    case "moveTo":
      extensions.add("fileinto");
      return `fileinto ${sieveQuote(action.mailbox)};`;
    case "junk": {
      if (!mailboxes.junk) return null;
      extensions.add("fileinto");
      extensions.add("imap4flags");
      // The keyword before the move, same order as the interactive path: after
      // fileinto the message is no longer addressable here.
      return `addflag "$Junk";\nfileinto ${sieveQuote(mailboxes.junk)};`;
    }
    case "trash":
      if (!mailboxes.trash) return null;
      extensions.add("fileinto");
      return `fileinto ${sieveQuote(mailboxes.trash)};`;
    case "markRead":
      extensions.add("imap4flags");
      return `addflag "\\\\Seen";`;
    case "flag":
      extensions.add("imap4flags");
      return `addflag "\\\\Flagged";`;
    case "stop":
      return "stop;";
    case "capture":
      // Handled by the caller: the whole rule stays local.
      return null;
  }
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

/**
 * Builds the rules half of Plainva's section.
 *
 * `capabilities` is what the server announced. When it is undefined the
 * translation runs unfiltered — an older transport that cannot report them
 * should not silently disable every rule; the upload then fails loudly instead,
 * which is recoverable, whereas a rule that quietly never existed is not.
 */
export function buildRulesSection(
  rules: readonly MailRule[],
  mailboxes: RuleMailboxes = {},
  capabilities?: readonly string[]
): RulesSection {
  const known = capabilities ? new Set(capabilities.map((c) => c.toLowerCase())) : null;
  const extensions = new Set<string>();
  const skipped: { id: string; reason: SkipReason }[] = [];
  const blocks: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const ruleExtensions = new Set<string>();
    const tests = rule.conditions.map((c) => testFor(c, ruleExtensions)).filter((t): t is string => !!t);
    if (tests.length === 0) {
      skipped.push({ id: rule.id, reason: "empty" });
      continue;
    }

    if (rule.actions.some((a) => a.kind === "capture")) {
      skipped.push({ id: rule.id, reason: "localAction" });
      continue;
    }

    const actions = rule.actions.map((a) => actionFor(a, mailboxes, ruleExtensions));
    if (actions.some((a) => a === null)) {
      skipped.push({ id: rule.id, reason: "noMailbox" });
      continue;
    }
    const body = actions.filter((a): a is string => !!a);
    if (body.length === 0) {
      skipped.push({ id: rule.id, reason: "empty" });
      continue;
    }

    if (known && [...ruleExtensions].some((e) => !known.has(e))) {
      skipped.push({ id: rule.id, reason: "unsupported" });
      continue;
    }

    for (const e of ruleExtensions) extensions.add(e);
    const condition = tests.length === 1 ? tests[0] : `${rule.match === "any" ? "anyof" : "allof"}(${tests.join(", ")})`;
    blocks.push(`# ${rule.name.replace(/[\r\n]+/g, " ")}\nif ${condition}\n{\n${indent(body.join("\n"))}\n}`);
  }

  return { body: blocks.join("\n\n"), extensions: [...extensions], skipped };
}
