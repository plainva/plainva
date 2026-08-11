/**
 * Column summaries — the footer line under a table column.
 *
 * This is Obsidian's OWN feature, not a Plainva extension: a view carries
 * `summaries: { <property>: <SummaryName> }` and the top level may define custom
 * formulas under `summaries:`. Both therefore live as NATIVE keys, outside the
 * `plainva` namespace — a summary configured here shows up in Obsidian too, and
 * one configured there shows up here.
 *
 * The default names below are quoted from Obsidian's Bases syntax documentation
 * (verified 2026-08-11) rather than invented, so the two apps agree on what
 * "Average" means. CUSTOM formulas (`values.mean().round(3)`) are a small
 * expression language Plainva does not implement: they are preserved verbatim
 * and simply show no value here.
 */

export type SummaryName =
  | "Average"
  | "Min"
  | "Max"
  | "Sum"
  | "Range"
  | "Median"
  | "Stddev"
  | "Earliest"
  | "Latest"
  | "Checked"
  | "Unchecked"
  | "Empty"
  | "Filled"
  | "Unique";

export const SUMMARY_NAMES: readonly SummaryName[] = [
  "Average", "Min", "Max", "Sum", "Range", "Median", "Stddev",
  "Earliest", "Latest", "Checked", "Unchecked", "Empty", "Filled", "Unique",
] as const;

export function isSummaryName(v: unknown): v is SummaryName {
  return typeof v === "string" && (SUMMARY_NAMES as readonly string[]).includes(v);
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === "";
}

function numbersOf(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

function datesOf(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    const s = String(v ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) out.push(s);
  }
  return out;
}

function isChecked(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute one summary over a column's values (one entry per row).
 *
 * Returns null when the summary has nothing to work on — the footer then shows
 * nothing rather than a zero that would read as a measurement.
 */
export function computeSummary(name: SummaryName, values: unknown[]): number | string | null {
  switch (name) {
    case "Empty":
      return values.filter((v) => isEmptyValue(v)).length;
    case "Filled":
      return values.filter((v) => !isEmptyValue(v)).length;
    case "Checked":
      return values.filter((v) => isChecked(v)).length;
    case "Unchecked":
      return values.filter((v) => !isChecked(v)).length;
    case "Unique": {
      const seen = new Set<string>();
      for (const v of values) {
        if (isEmptyValue(v)) continue;
        for (const one of Array.isArray(v) ? v : [v]) seen.add(String(one));
      }
      return seen.size;
    }
    case "Earliest":
    case "Latest": {
      const dates = datesOf(values);
      if (dates.length === 0) return null;
      dates.sort();
      return name === "Earliest" ? dates[0] : dates[dates.length - 1];
    }
    default: {
      const nums = numbersOf(values);
      if (nums.length === 0) {
        // A date column can still answer Range — as a span in days.
        if (name === "Range") {
          const dates = datesOf(values);
          if (dates.length === 0) return null;
          dates.sort();
          const ms = Date.parse(dates[dates.length - 1]) - Date.parse(dates[0]);
          return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
        }
        return null;
      }
      if (name === "Sum") return round2(nums.reduce((a, b) => a + b, 0));
      if (name === "Average") return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
      if (name === "Min") return Math.min(...nums);
      if (name === "Max") return Math.max(...nums);
      if (name === "Range") return round2(Math.max(...nums) - Math.min(...nums));
      if (name === "Median") {
        const s = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return round2(s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]);
      }
      // Stddev: population standard deviation, matching what a spreadsheet's
      // STDEVP would say over the same column.
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
      return round2(Math.sqrt(variance));
    }
  }
}
