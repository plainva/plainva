import { parse as parseYaml } from "yaml";
import {
  deriveOkfTrustLevel,
  isOkfStale,
  parseOkfTrustSignals,
  type OkfTrustLevel,
  type OkfTrustSignals,
} from "@plainva/core";

/**
 * OKF 0.2 trust signals, read for the two shells (OKF v0.2 plan, P3a).
 *
 * The parse itself lives in core (`parseOkfTrustSignals`: form check per
 * § 6, normalisation); this module adds what a VIEW needs on top — the
 * frontmatter-block entry the editors already hold, the badge/banner
 * derivations and the actor/date formatting — so desktop and mobile derive
 * identical answers from identical input. Nothing here writes.
 */

/** Trust signals of a frontmatter block (the text between the `---` fences). */
export function trustSignalsFromBlock(fmText: string | null | undefined): OkfTrustSignals {
  if (!fmText || !fmText.trim()) return parseOkfTrustSignals(null);
  try {
    const parsed: unknown = parseYaml(fmText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parseOkfTrustSignals(null);
    return parseOkfTrustSignals(parsed as Record<string, unknown>);
  } catch {
    // A half-typed frontmatter is not an error for the header — no signals.
    return parseOkfTrustSignals(null);
  }
}

/**
 * The lifecycle badge a note shows: `draft` and `deprecated` only. `stable`
 * is the default state and stays silent, and a foreign-shaped `status` (a
 * task database's `Offen`) is not a lifecycle at all.
 */
export type TrustBadge = "draft" | "deprecated";

export function trustBadgeOf(signals: Pick<OkfTrustSignals, "status" | "statusForeign">): TrustBadge | null {
  if (signals.statusForeign) return null;
  return signals.status === "draft" || signals.status === "deprecated" ? signals.status : null;
}

/** The `stale_after` date once today lies past it (local calendar date), else null. */
export function staleSinceOf(signals: Pick<OkfTrustSignals, "staleAfter">, now: Date = new Date()): string | null {
  return isOkfStale(signals.staleAfter, now) ? signals.staleAfter : null;
}

/** Derived trust level — re-exported so views need one import. */
export function trustLevelOf(signals: Pick<OkfTrustSignals, "verified">): OkfTrustLevel {
  return deriveOkfTrustLevel(signals);
}

/** i18n key per trust level (the texts live in the locales, ×10). */
export const TRUST_LEVEL_I18N: Record<OkfTrustLevel, string> = {
  unverified: "trust.levelUnverified",
  "machine-confirmed": "trust.levelMachine",
  "human-reviewed": "trust.levelHuman",
};

/** When a note was generated: `generated.at`, with the v0.1 `timestamp` as read fallback. */
export function generatedAtOf(signals: Pick<OkfTrustSignals, "generated" | "timestamp">): string | null {
  return signals.generated?.at ?? signals.timestamp;
}

export type ActorKind = "human" | "producer" | "process" | "raw";

export interface ActorLabel {
  kind: ActorKind;
  /** The identifier without its convention prefix (`marco`, `plainva-import`). */
  name: string;
  /** Producer version (`0.6.7`) — only for `<producer>/<version>`. */
  version?: string;
}

/**
 * Splits an actor string by the spec's conventions: `human:<id>`,
 * `process:<id>`, `<producer>/<version>`; anything else is shown verbatim.
 */
export function describeActor(actor: string): ActorLabel {
  const a = actor.trim();
  if (a.startsWith("human:")) return { kind: "human", name: a.slice("human:".length).trim() || a };
  if (a.startsWith("process:")) return { kind: "process", name: a.slice("process:".length).trim() || a };
  const slash = a.lastIndexOf("/");
  if (slash > 0 && slash < a.length - 1) return { kind: "producer", name: a.slice(0, slash), version: a.slice(slash + 1) };
  return { kind: "raw", name: a };
}

/**
 * Human-readable actor: `marco (Person)`, `plainva-import 0.6.7`, `Process x`,
 * raw otherwise. The two words come from the caller's locale.
 */
export function formatActor(actor: string, words: { person: string; process: string }): string {
  const label = describeActor(actor);
  switch (label.kind) {
    case "human":
      return `${label.name} (${words.person})`;
    case "producer":
      return `${label.name} ${label.version}`;
    case "process":
      return `${words.process} ${label.name}`;
    default:
      return label.name;
  }
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A stamp date for display. A plain date (`2026-06-30`) stays on its calendar
 * day — parsed as a local date, not as UTC midnight — an instant gets the
 * short time; anything unparseable is shown as written.
 */
export function formatStampDate(at: string, locale: string): string {
  const raw = at.trim();
  const dateOnly = DATE_ONLY_RE.exec(raw);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(locale || undefined, dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return raw;
  }
}
