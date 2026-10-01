/**
 * Folders at the vault's root that hold Plainva's own state and that of other
 * tools (ADR 0020, ADR 0022): `.agent/` with the privacy rules, skills and
 * memory, `.plainva/`, `.git/`, `.obsidian/`, `.trash/`. Nothing below them
 * reaches a model as data — not as a candidate or a pin of the context
 * package, not in a tool result, not as a vector or a gist — and no tool
 * takes a path into them. What the user approved from `.agent/` reaches the
 * model as an instruction (plan KI-Harness P3), never as data.
 *
 * `.agent/` itself stays in the index: sync counts a vault's files there, and
 * the folder travels with the vault. The native side keeps the same list
 * (`HIDDEN_ROOTS` in the MCP server's path checks).
 */
export const AI_HIDDEN_ROOTS = [".plainva", ".agent", ".git", ".obsidian", ".trash"] as const;

/** True for a vault-relative path inside one of the hidden roots, in any letter case. */
export function isAiHiddenPath(path: string): boolean {
  const first = path.replace(/\\/g, "/").replace(/^(\.\/)+/, "").split("/")[0] ?? "";
  return (AI_HIDDEN_ROOTS as readonly string[]).includes(first.toLowerCase());
}

/**
 * The same rule as an SQL condition on a path column. SQLite's LIKE ignores
 * the case of ASCII letters, which is what the rule needs; none of the roots
 * contains a LIKE wildcard.
 */
export function aiVisibleSql(column: string): string {
  return AI_HIDDEN_ROOTS.map((root) => `${column} NOT LIKE '${root}/%'`).join(" AND ");
}
