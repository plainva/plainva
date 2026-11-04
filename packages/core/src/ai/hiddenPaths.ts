import { isHiddenPath, visiblePathSql } from "../vault/internalPath.js";

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
 * the folder travels with the vault.
 *
 * The roots are named here; the rule is wider. Since 2026-11-02 every dot file
 * and everything in a dot folder is hidden on every surface of the app, kept in
 * the index and in sync (`isHiddenPath`, decision E8 of the bug-fix plan), and
 * the assistant is one more surface: what the user does not find in the search,
 * the tree or a list does not reach a model either. So the rule here is that
 * one rule, and the roots above are part of what it hides. The native side
 * applies the same rule (`safe_rel_path` in the MCP server's path checks).
 */
export const AI_HIDDEN_ROOTS = [".plainva", ".agent", ".git", ".obsidian", ".trash"] as const;

/** True for a vault-relative path that is hidden: a dot file, or anything below a dot folder, at any depth. */
export function isAiHiddenPath(path: string): boolean {
  return isHiddenPath(path);
}

/** The same rule as an SQL condition on a path column: TRUE for a path the assistant may use. */
export function aiVisibleSql(column: string): string {
  return visiblePathSql(column);
}
