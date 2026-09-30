/**
 * How search ranks (plan KI-Harness P2a-4): by words as it always did, by
 * meaning, or by both fused. A device setting beside the model it computes
 * with (`AiAppSettings.searchMode`); without an active model it is words.
 */
export type SearchMode = "words" | "meaning" | "both";

export const SEARCH_MODES: readonly SearchMode[] = ["words", "meaning", "both"];

/** Both, as the mockup says: in the spike 88 % of the questions found their note among the first five, against 62 % by words alone. */
export const DEFAULT_SEARCH_MODE: SearchMode = "both";

export function isSearchMode(value: unknown): value is SearchMode {
  return typeof value === "string" && (SEARCH_MODES as readonly string[]).includes(value);
}
