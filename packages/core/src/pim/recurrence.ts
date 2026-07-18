import type { PimRecurrence } from "./types.js";

/**
 * Structured recurrence <-> RRULE. CalDAV and Google carry a raw RRULE, so they
 * serialize/parse through here; Graph uses a structured object (mapped in its
 * adapter) but reuses the same PimRecurrence shape. Pure + unit-tested.
 */

const FREQ_FROM_RRULE: Record<string, PimRecurrence["freq"]> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

/** PimRecurrence -> RRULE value (WITHOUT the "RRULE:" prefix). */
export function recurrenceToRRule(r: PimRecurrence): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${Math.floor(r.interval)}`);
  if (r.freq === "weekly" && r.byWeekday && r.byWeekday.length > 0) {
    parts.push(`BYDAY=${r.byWeekday.join(",")}`);
  }
  if (r.count && r.count > 0) {
    parts.push(`COUNT=${Math.floor(r.count)}`);
  } else if (r.until) {
    // UNTIL is a UTC datetime; end-of-day so the last civil day is included.
    parts.push(`UNTIL=${r.until.replace(/-/g, "")}T235959Z`);
  }
  return parts.join(";");
}

/** RRULE text (with or without the "RRULE:" prefix) -> PimRecurrence, or null
 * when the text has no usable FREQ. */
export function parseRRule(text: string | undefined | null): PimRecurrence | null {
  if (!text) return null;
  const body = text.replace(/^RRULE:/i, "").trim();
  const map = new Map<string, string>();
  for (const kv of body.split(";")) {
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    map.set(kv.slice(0, eq).trim().toUpperCase(), kv.slice(eq + 1).trim());
  }
  const freq = FREQ_FROM_RRULE[(map.get("FREQ") ?? "").toUpperCase()];
  if (!freq) return null;
  const r: PimRecurrence = { freq };
  const iv = Number(map.get("INTERVAL"));
  if (Number.isFinite(iv) && iv > 1) r.interval = iv;
  const byday = map.get("BYDAY");
  if (byday) {
    const days = byday.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (days.length > 0) r.byWeekday = days;
  }
  const count = Number(map.get("COUNT"));
  if (Number.isFinite(count) && count > 0) {
    r.count = count;
  } else {
    const until = map.get("UNTIL");
    const m = until?.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) r.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return r;
}
