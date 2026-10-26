import { cacheShare, type ConversationUsage } from "@plainva/core";

type T = (key: string, vars?: Record<string, unknown>) => string;

/** The formats of the lines about usage: numbers and US dollars in the app's language. */
export interface UsageFormats {
  number: Intl.NumberFormat;
  money: Intl.NumberFormat;
}

/** A share as a whole percent that says "all" only where it is all: 99.6 % is 99 %, never 100 %. */
export function percentOf(share: number): number {
  return share >= 1 ? 100 : Math.min(99, Math.round(share * 100));
}

/** How much of a request's input came from the provider's cache, where it reports one (plan KI-Harness P9-6). */
export function cacheShareText(t: T, usage: ConversationUsage, number: Intl.NumberFormat): string | null {
  const share = cacheShare(usage);
  return share === null ? null : t("ai.cacheShare", { percent: number.format(percentOf(share)) });
}

/**
 * What one provider's model went with in a month — sent and received, how much came from its cache where it says
 * so, the cost where it is known (plan KI-Harness P9-6): one line, the same in both shells.
 */
export function usageRowLine(t: T, row: { usage: ConversationUsage; costUsd?: number }, formats: UsageFormats): string {
  const { usage } = row;
  const parts = [t("ai.settings.usageRow", { input: formats.number.format(usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens), output: formats.number.format(usage.outputTokens) })];
  const cached = cacheShareText(t, usage, formats.number);
  if (cached) parts.push(cached);
  if (row.costUsd !== undefined) parts.push(`≈ ${formats.money.format(row.costUsd)}`);
  return parts.join(" · ");
}

/**
 * What choosing and shortening the notes saved in the month (plan KI-Harness P9-6); null when it saved nothing. The
 * dollars stand where every saving run had a price and they come to something: a month on this device's models
 * saved tokens, not money.
 */
export function savingsLine(t: T, saved: { savedTokens: number; savedUsd?: number }, formats: UsageFormats): string | null {
  if (!(saved.savedTokens > 0)) return null;
  const line = t("ai.settings.usageSaved", { tokens: formats.number.format(saved.savedTokens) });
  // Less than half a cent reads as "$0.00": a saving that says nothing in money is said in tokens alone.
  return saved.savedUsd !== undefined && saved.savedUsd >= 0.005 ? `${line} · ≈ ${formats.money.format(saved.savedUsd)}` : line;
}
