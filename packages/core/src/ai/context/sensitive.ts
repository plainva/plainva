/**
 * Sensitive data classes (plan §7): the mood of a day and the place stamp of
 * a journal line never go into a context package on their own. The place
 * stamp is a line of its own (`📍 52.5200, 13.4050`, the journal's capture
 * writes it that way); it is withheld from every text before egress, and the
 * send overview says how many were. The mood lives in a property; properties
 * of that name are left out of a note's core properties.
 */

/** A place line as the journal writes it: the pin, latitude and longitude. */
const PLACE_LINE = /^([ \t>*+-]*)📍[ \t]*-?\d{1,3}(?:\.\d+)?[ \t]*,[ \t]*-?\d[^\n]*$/gmu;

/** What a withheld place stamp becomes: says that something was there, not where. */
export const WITHHELD_PLACE = "📍 ⟦place withheld⟧";

export function withholdPlaces(text: string): { text: string; withheld: number } {
  let withheld = 0;
  const out = text.replace(PLACE_LINE, (_line, lead: string) => {
    withheld += 1;
    return `${lead}${WITHHELD_PLACE}`;
  });
  return { text: out, withheld };
}

/** Property names that carry a mood (the journal's default and the usual spellings). */
export const MOOD_PROPERTY_NAMES: readonly string[] = ["mood", "stimmung", "humor", "humeur", "umore", "stemming", "nastrój", "気分", "心情"];

/**
 * Core properties of the open note without the sensitive ones. `moodKey` is
 * the vault's configured mood property, when it has one.
 */
export function withoutSensitiveProperties(
  properties: Readonly<Record<string, unknown>>,
  moodKey?: string | null,
): { properties: Record<string, unknown>; withheld: number } {
  const mood = new Set(MOOD_PROPERTY_NAMES.map((name) => name.toLowerCase()));
  if (moodKey) mood.add(moodKey.toLowerCase());
  const out: Record<string, unknown> = {};
  let withheld = 0;
  for (const [key, value] of Object.entries(properties)) {
    // The plainva namespace carries policy and app state, never context.
    if (key === "plainva") continue;
    if (mood.has(key.toLowerCase())) {
      withheld += 1;
      continue;
    }
    out[key] = value;
  }
  return { properties: out, withheld };
}
