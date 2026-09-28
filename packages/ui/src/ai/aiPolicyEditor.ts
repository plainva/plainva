import { normalizeFolder, type AiPermission, type AiPolicyDimension, type FolderPolicyRule } from "@plainva/core";

/**
 * Editing the folder rules of `.agent/policy.yml` (plan KI-Harness §13.2) —
 * the same steps in both shells' settings. The vault default is the rule of
 * the folder "" (written as "/").
 */

export type PolicyChoice = AiPermission | "inherit";

export function ruleOf(rules: readonly FolderPolicyRule[], folder: string): FolderPolicyRule | undefined {
  return rules.find((r) => r.folder === normalizeFolder(folder));
}

/** Sets one dimension of one folder; "inherit" removes it, and an empty rule disappears. */
export function withRuleValue(rules: readonly FolderPolicyRule[], folder: string, dimension: AiPolicyDimension, choice: PolicyChoice): FolderPolicyRule[] {
  const key = normalizeFolder(folder);
  const existing = rules.find((r) => r.folder === key) ?? { folder: key };
  const next: FolderPolicyRule = { ...existing };
  if (choice === "inherit") delete next[dimension];
  else next[dimension] = choice;
  const others = rules.filter((r) => r.folder !== key);
  const empty = !next.cloud && !next.web;
  return (empty ? others : [...others, next]).sort((a, b) => a.folder.localeCompare(b.folder));
}

export function withoutRule(rules: readonly FolderPolicyRule[], folder: string): FolderPolicyRule[] {
  const key = normalizeFolder(folder);
  return rules.filter((r) => r.folder !== key);
}

/** Folders that carry no rule yet — the choices of "Add folder rule". */
export function unruledFolders(rules: readonly FolderPolicyRule[], folders: readonly string[]): string[] {
  const ruled = new Set(rules.map((r) => r.folder));
  return folders.map(normalizeFolder).filter((f) => f && !ruled.has(f) && !f.startsWith(".")).sort((a, b) => a.localeCompare(b));
}
