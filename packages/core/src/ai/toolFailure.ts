import { isDamagedFullText } from "../db/fullTextDamage.js";

/**
 * What a model or an outside program reads when a tool fails on a damaged
 * full-text index: what still works, and that Plainva says how it is rebuilt
 * — never the driver's words (`fts5: corruption found reading blob …`).
 */
export const FULL_TEXT_DAMAGED_TOOL_TEXT =
  "The vault's full-text search index is damaged, so full-text search finds nothing for now, and links, tags, databases and task lists may be out of date until it is rebuilt; Plainva's own search tells the person how. Notes can still be read by path.";

/** The text of a tool that failed, for the model (the orchestrator, scripts). */
export function toolFailureText(error: unknown): string {
  if (isDamagedFullText(error)) return FULL_TEXT_DAMAGED_TOOL_TEXT;
  return `The tool failed: ${error instanceof Error ? error.message : String(error)}`;
}
