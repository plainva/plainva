import { AGENTS_MAX_BYTES } from "../skills/sources.js";
import { cleanMemoryText, memoryTextProblem } from "./memoryFile.js";

/**
 * A rule for assistants (plan KI-Harness P6, ADR 0027): what an assistant
 * should always do in this vault. That is an instruction, not a memory, so it
 * is no entry of the memory files: it becomes one more line of the vault's
 * standing instructions, `AGENTS.md` — the file every device approves for
 * itself before a model is told to follow it.
 *
 * A rule is written as a list item at the end of the file. Nothing else in
 * the file changes; where the file ends in a list, the rule joins it, and
 * otherwise it stands apart from what was there.
 */

export type RuleChange = { ok: true; text: string } | { ok: false; problem: "empty" | "too-long" | "lines" | "duplicate" | "too-large" };

const HEADER = "# Instructions for assistants";
const BULLET = /^[-*+][ \t]+/;

/** `AGENTS.md` with one more rule; a file that is not there begins with a heading. */
export function addRuleLine(file: string | null, text: string): RuleChange {
  const problem = memoryTextProblem(text);
  if (problem) return { ok: false, problem };
  const rule = cleanMemoryText(text).text;
  const eol = file !== null && /\r\n/.test(file) ? "\r\n" : "\n";
  const line = `- ${rule}`;
  let next: string;
  if (file === null || file.trim() === "") next = `${HEADER}${eol}${eol}${line}${eol}`;
  else {
    const lines = file.split(/\r?\n/);
    // The same words as a line of their own are there already: said once is enough.
    if (lines.some((existing) => BULLET.test(existing) && cleanMemoryText(existing.replace(BULLET, "")).text === rule)) return { ok: false, problem: "duplicate" };
    while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
    const joins = BULLET.test(lines[lines.length - 1] ?? "");
    next = `${lines.join(eol)}${eol}${joins ? "" : eol}${line}${eol}`;
  }
  // The file is read only up to this size: a rule that would push it past that would switch all of them off.
  if (new TextEncoder().encode(next).byteLength > AGENTS_MAX_BYTES) return { ok: false, problem: "too-large" };
  return { ok: true, text: next };
}
