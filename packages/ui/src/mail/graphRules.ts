import type { MailRule, RuleCondition } from "./rules";
import type { SkipReason } from "./sieveRules";

/**
 * Translating the rule model into a Microsoft `messageRule` (S16).
 *
 * The same shape as the Sieve translation, and the same discipline: what the
 * server cannot express is reported and stays local, never approximated. Graph
 * is the narrower of the two targets, and the places where it is narrower are
 * exactly the places where guessing would be dangerous:
 *
 *   - it only compares with CONTAINS, so "is exactly" and "begins with" have no
 *     equivalent — a rule silently widened from "is" to "contains" would file
 *     mail the user never pointed at;
 *   - it has no cc-only condition (`recipientContains` also matches To), so a
 *     cc rule cannot be honoured as written;
 *   - it cannot set the flagged state at all.
 *
 * Ownership works like the Sieve section (E4): Plainva owns the rules it NAMED
 * and leaves every other rule in the mailbox alone.
 */

/** Rules Plainva wrote carry this prefix in their display name. It is the Graph
 * counterpart of the marked Sieve section: everything else in the mailbox is
 * somebody else's and is never touched. */
export const GRAPH_RULE_PREFIX = "[Plainva] ";

export const isPlainvaRule = (displayName: string) => displayName.startsWith(GRAPH_RULE_PREFIX);

export interface GraphMessageRule {
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  conditions: Record<string, unknown>;
  exceptions?: Record<string, unknown>;
  actions: Record<string, unknown>;
}

/** Graph condition property per field, or null when the field has none. */
function conditionKey(condition: RuleCondition): string | null {
  switch (condition.field) {
    case "from":
      return "senderContains";
    case "to":
      return "recipientContains";
    case "subject":
      return "subjectContains";
    case "body":
      return "bodyContains";
    case "header":
      return "headerContains";
    case "cc":
      // `recipientContains` also matches To. Honouring a cc rule with it would
      // widen what the user asked for, so this stays local instead.
      return null;
  }
}

export interface GraphTranslation {
  rules: GraphMessageRule[];
  skipped: { id: string; reason: SkipReason }[];
}

/**
 * Builds the Graph rules.
 *
 * `folderIds` maps a mailbox display name to its Graph id — moving is the one
 * action that needs a resolved id, and a rule that names a folder the account
 * does not have is reported rather than uploaded.
 */
export function buildGraphRules(
  rules: readonly MailRule[],
  folderIds: ReadonlyMap<string, string>,
  mailboxes: { junk?: string; trash?: string } = {},
  startSequence = 1
): GraphTranslation {
  const out: GraphMessageRule[] = [];
  const skipped: { id: string; reason: SkipReason }[] = [];
  let sequence = startSequence;

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const conditions: Record<string, string[]> = {};
    const exceptions: Record<string, string[]> = {};
    let unsupported = false;

    for (const condition of rule.conditions) {
      const value = condition.value.trim();
      if (!value) continue;
      // Graph compares with "contains" and nothing else.
      if (condition.op !== "contains" && condition.op !== "notContains") {
        unsupported = true;
        break;
      }
      const key = conditionKey(condition);
      if (!key) {
        unsupported = true;
        break;
      }
      // A negated condition is not a condition — it is an EXCEPTION, which is
      // exactly what Graph models. Folding it into `conditions` would invert
      // the rule.
      const target = condition.op === "notContains" ? exceptions : conditions;
      (target[key] ??= []).push(value);
    }

    if (unsupported) {
      skipped.push({ id: rule.id, reason: "unsupported" });
      continue;
    }

    const positives = Object.keys(conditions).length;
    if (positives === 0) {
      // Graph has no rule that is only exceptions, and a rule with nothing to
      // match would apply to every message.
      skipped.push({ id: rule.id, reason: "empty" });
      continue;
    }

    // Graph ANDs across properties and ORs within one property's array. So
    // "any" is expressible only while every condition names the SAME property.
    if (rule.match === "any" && positives > 1) {
      skipped.push({ id: rule.id, reason: "unsupported" });
      continue;
    }

    if (rule.actions.some((a) => a.kind === "capture")) {
      // Only Plainva can file a note; uploading the rest would let the server
      // move the message before anything could be filed.
      skipped.push({ id: rule.id, reason: "localAction" });
      continue;
    }

    const actions: Record<string, unknown> = {};
    let missingMailbox = false;
    for (const action of rule.actions) {
      switch (action.kind) {
        case "moveTo": {
          const id = folderIds.get(action.mailbox);
          if (!id) missingMailbox = true;
          else actions.moveToFolder = id;
          break;
        }
        case "junk": {
          const id = mailboxes.junk ? folderIds.get(mailboxes.junk) : undefined;
          if (!id) missingMailbox = true;
          else actions.moveToFolder = id;
          break;
        }
        case "trash":
          // Graph's `delete` moves to Deleted Items — it is not a permanent
          // delete, which is `permanentDelete` and deliberately not offered.
          actions.delete = true;
          break;
        case "markRead":
          actions.markAsRead = true;
          break;
        case "flag":
          // Graph message rules cannot set the flagged state at all.
          unsupported = true;
          break;
        case "stop":
          actions.stopProcessingRules = true;
          break;
        case "capture":
          break; // unreachable: handled above

      }
    }

    if (unsupported) {
      skipped.push({ id: rule.id, reason: "unsupported" });
      continue;
    }
    if (missingMailbox) {
      skipped.push({ id: rule.id, reason: "noMailbox" });
      continue;
    }
    if (Object.keys(actions).length === 0) {
      skipped.push({ id: rule.id, reason: "empty" });
      continue;
    }

    out.push({
      displayName: `${GRAPH_RULE_PREFIX}${rule.name}`.slice(0, 255),
      sequence: sequence++,
      isEnabled: true,
      conditions,
      ...(Object.keys(exceptions).length ? { exceptions } : {}),
      actions,
    });
  }

  return { rules: out, skipped };
}
