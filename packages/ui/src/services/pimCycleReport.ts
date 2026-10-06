import type { PimCycleInfo } from "@plainva/core";

/**
 * One diagnostics line per calendar/task cycle (finding 2026-09-20: two pulls
 * 14 s apart, and nothing on record said what had asked for the second one).
 * Why the cycle ran, how long it took, how many manual requests it answered
 * without a second run — and per account what came of it (plan Befunde
 * 2026-10-06, K1): the line used to end in "with errors", and when a calendar
 * stood empty there was nothing to read the reason from.
 *
 * Still no data. An account is named by its provider and its position, never
 * by its label (often an e-mail address); the events are a count; and an
 * error keeps the provider's words but loses the path of every address in it,
 * because a calendar id sits there and a Google calendar id is an e-mail
 * address. Secrets are taken out by `logDiagnostic` itself.
 */
export function formatPimCycle(info: PimCycleInfo): string {
  const parts = [`cycle ${info.cause}`, `${Math.round(info.ms)} ms`, info.wroteData ? "wrote data" : "no change"];
  if (info.hadError) parts.push("with errors");
  if (info.coalesced > 0) parts.push(`answered ${info.coalesced} more request${info.coalesced === 1 ? "" : "s"}`);
  const head = parts.join(", ");
  const accounts = (info.accounts ?? []).map((account, index) => {
    const bits = [account.skipped ? `not asked (${account.skipped})` : `${account.events} event${account.events === 1 ? "" : "s"} read`];
    if (account.calendarErrors) bits.push(`${account.calendarErrors} calendar${account.calendarErrors === 1 ? "" : "s"} failed`);
    if (account.error) bits.push(`error: ${withoutUrlPaths(account.error)}`);
    return `${account.provider}#${index + 1}: ${bits.join(", ")}`;
  });
  return accounts.length > 0 ? `${head}; ${accounts.join("; ")}` : head;
}

/** `https://host/any/path?query` -> `https://host/…`. Linear, no regex over the tail. */
export function withoutUrlPaths(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const at = text.indexOf("://", from);
    if (at < 0) return out + text.slice(from);
    let hostEnd = at + 3;
    while (hostEnd < text.length && !isUrlStop(text[hostEnd]!) && text[hostEnd] !== "/" && text[hostEnd] !== "?" && text[hostEnd] !== "#") hostEnd++;
    let end = hostEnd;
    while (end < text.length && !isUrlStop(text[end]!)) end++;
    out += text.slice(from, hostEnd) + (end > hostEnd ? "/…" : "");
    from = end;
  }
}

function isUrlStop(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "(" || ch === ")" || ch === "<" || ch === ">" || ch === '"' || ch === "'";
}
