import { AI_PROFILE_IDS, type AiProfileId } from "@plainva/core/ai";

/**
 * The order the settings list the chat profiles in (mockup KI-Oberflächen M2, F71 of release 0.9.0): the profile new
 * conversations start with first — it is the one that answers — then the others in their fixed order. Display only:
 * `AI_PROFILE_IDS` keeps its order, because the fallbacks that look for a filled profile go through it.
 */
export function profilesInOrder(defaultProfile: AiProfileId): AiProfileId[] {
  return [defaultProfile, ...AI_PROFILE_IDS.filter((id) => id !== defaultProfile)];
}
