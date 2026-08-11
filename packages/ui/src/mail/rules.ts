import { getPlatformServices } from "../platform/services";

/**
 * Mail rules: the model, the matching, and running them locally (S14).
 *
 * The model is deliberately the COMMON DENOMINATOR of what a mail server can
 * express, not what Plainva could implement. Everything here has to survive
 * translation into a Sieve script (S15) and into an Outlook rule (S16) — a
 * condition that only Plainva understands would produce a rule that works on
 * this machine and nowhere else, which is the opposite of what a rule is for.
 *
 * Local execution is the fallback, never the goal. It runs over what Plainva
 * has actually fetched, so it can only ever act on mail the app has seen. Where
 * that is all a mailbox can do, the interface says so in those words instead of
 * implying a filter that runs on the server.
 */

export type RuleField = "from" | "to" | "cc" | "subject" | "body" | "header";

/** Operators every target speaks: Sieve `:contains`/`:is`/`:matches`, Outlook's
 * string predicates, and a plain JavaScript comparison. */
export type RuleOp = "contains" | "notContains" | "is" | "startsWith" | "endsWith";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string;
  /** Header name — only for `field: "header"`. */
  header?: string;
}

/** Whether every condition must hold, or any one of them. */
export type RuleMatch = "all" | "any";

export type RuleAction =
  | { kind: "moveTo"; mailbox: string }
  | { kind: "markRead" }
  | { kind: "flag" }
  | { kind: "junk" }
  | { kind: "trash" }
  /**
   * File the message as a note in the vault (S17) — the action no mail program
   * has, and the one a MAIL SERVER cannot have either: it writes into the
   * vault, not into a mailbox. A rule that carries it therefore stays local as
   * a WHOLE, rather than being uploaded without it: a server that moved the
   * message first would leave nothing for the capture to find.
   */
  | { kind: "capture" }
  /** Stops further rules for this message — the escape hatch every rule engine
   * needs and the one Sieve calls `stop`. */
  | { kind: "stop" };

export interface MailRule {
  id: string;
  name: string;
  enabled: boolean;
  match: RuleMatch;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

/** What matching needs from a message. Deliberately small: everything here is
 * in an envelope, so a rule can run without fetching bodies. `body` is optional
 * for exactly that reason — a body condition matches nothing until the message
 * is open, and `runRules` says so rather than guessing. */
export interface RuleMessage {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  headers?: Readonly<Record<string, string>>;
}

function fieldValue(message: RuleMessage, condition: RuleCondition): string | undefined {
  switch (condition.field) {
    case "from":
      return message.from;
    case "to":
      return message.to;
    case "cc":
      return message.cc;
    case "subject":
      return message.subject;
    case "body":
      return message.body;
    case "header":
      return condition.header ? message.headers?.[condition.header.toLowerCase()] : undefined;
  }
}

/**
 * One condition against one message. Case-insensitive throughout, because mail
 * addresses and subjects are, and a rule that misses "Newsletter" after being
 * written as "newsletter" reads as broken.
 *
 * A field the message does not carry does NOT match — not even `notContains`.
 * "The subject does not contain X" on a message whose subject was never loaded
 * is not true, it is unknown, and acting on unknown is how a rule files mail
 * nobody asked it to.
 */
export function matchesCondition(condition: RuleCondition, message: RuleMessage): boolean {
  const raw = fieldValue(message, condition);
  if (raw === undefined) return false;
  const haystack = raw.toLowerCase();
  const needle = condition.value.toLowerCase();
  if (!needle) return false;
  switch (condition.op) {
    case "contains":
      return haystack.includes(needle);
    case "notContains":
      return !haystack.includes(needle);
    case "is":
      return haystack.trim() === needle.trim();
    case "startsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
  }
}

/** Whether a rule applies. A rule without conditions never fires: an empty
 * condition list would otherwise mean "every message", which nobody means. */
export function matchesRule(rule: MailRule, message: RuleMessage): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  return rule.match === "all"
    ? rule.conditions.every((c) => matchesCondition(c, message))
    : rule.conditions.some((c) => matchesCondition(c, message));
}

/**
 * The actions to run for one message, in rule order, stopping at `stop`.
 *
 * Order is the rule order the user set — a rule engine whose order depends on
 * anything else cannot be reasoned about, and the same order is what Sieve and
 * Outlook will execute after S15/S16.
 */
export function actionsFor(rules: readonly MailRule[], message: RuleMessage): RuleAction[] {
  const out: RuleAction[] = [];
  for (const rule of rules) {
    if (!matchesRule(rule, message)) continue;
    for (const action of rule.actions) {
      if (action.kind === "stop") return out;
      out.push(action);
    }
  }
  return out;
}

/** Whether any rule needs the message BODY. A body is not in an envelope, so a
 * rule that asks for one can only run on messages Plainva has opened — the
 * interface says that rather than letting it silently never fire. */
export function needsBody(rules: readonly MailRule[]): boolean {
  return rules.some((r) => r.enabled && r.conditions.some((c) => c.field === "body"));
}

export interface RuleOps {
  moveTo(id: string, mailbox: string): Promise<void>;
  /** Files the message as a note. Optional: a caller that cannot reach the
   * vault leaves it out, and the action then fails as any other would. */
  capture?(id: string): Promise<void>;
  markRead(id: string): Promise<void>;
  flag(id: string): Promise<void>;
  junk(id: string): Promise<void>;
  trash(id: string): Promise<void>;
}

export interface RuleRunResult {
  /** Message ids that at least one rule acted on. */
  acted: string[];
  /** Ids that were moved out of the folder, so the caller drops their rows. */
  removed: string[];
}

/**
 * Runs the rules over messages Plainva has fetched.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **A moved message is not acted on twice.** `moveTo`, `junk` and `trash`
 *    all take it out of this folder; a `markRead` afterwards would address a
 *    uid that no longer exists there — which on IMAP is not an error, it is a
 *    DIFFERENT message. So a removing action ends the message's turn.
 * 2. **A failing action stops that message, not the run.** Twenty messages
 *    where the third has a problem must still leave seventeen filed.
 */
export async function runRules(
  rules: readonly MailRule[],
  messages: readonly (RuleMessage & { id: string })[],
  ops: RuleOps
): Promise<RuleRunResult> {
  const acted: string[] = [];
  const removed: string[] = [];
  const active = rules.filter((r) => r.enabled);
  if (active.length === 0) return { acted, removed };

  for (const message of messages) {
    const actions = actionsFor(active, message);
    if (actions.length === 0) continue;
    let touched = false;
    try {
      for (const action of actions) {
        switch (action.kind) {
          case "markRead":
            await ops.markRead(message.id);
            break;
          case "flag":
            await ops.flag(message.id);
            break;
          case "capture":
            // Filing a copy does NOT take the message out of the folder, so the
            // rest of the rule still applies to it afterwards.
            if (!ops.capture) throw new Error("capture is not available here");
            await ops.capture(message.id);
            break;
          case "moveTo":
            await ops.moveTo(message.id, action.mailbox);
            removed.push(message.id);
            break;
          case "junk":
            await ops.junk(message.id);
            removed.push(message.id);
            break;
          case "trash":
            await ops.trash(message.id);
            removed.push(message.id);
            break;
          case "stop":
            break;
        }
        touched = true;
        // Everything that takes the message out of this folder ends its turn:
        // the uid here no longer means what it meant a moment ago.
        if (action.kind === "moveTo" || action.kind === "junk" || action.kind === "trash") break;
      }
    } catch {
      // One message's problem is not the run's problem.
    }
    if (touched) acted.push(message.id);
  }
  return { acted, removed };
}

// --- Storage (per vault, shared by both shells) ----------------------------

export const mailRulesKey = (vaultPath: string) => `mailRules_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/** Drops anything that is not a rule rather than throwing: a settings file
 * written by a newer version must not stop mail from loading. */
export function sanitizeRules(raw: unknown): MailRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is MailRule =>
      !!r &&
      typeof (r as MailRule).id === "string" &&
      typeof (r as MailRule).name === "string" &&
      Array.isArray((r as MailRule).conditions) &&
      Array.isArray((r as MailRule).actions)
  );
}

export async function listMailRules(vaultPath: string): Promise<MailRule[]> {
  const store = await getPlatformServices().loadSettings();
  return sanitizeRules(await store.get<unknown>(mailRulesKey(vaultPath)));
}

export async function saveMailRules(vaultPath: string, rules: readonly MailRule[]): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  await store.set(mailRulesKey(vaultPath), rules);
  await store.save();
}
