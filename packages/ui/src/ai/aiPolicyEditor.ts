import {
  normalizeFolder,
  parsePolicyFile,
  serializePolicyFile,
  updateVaultText,
  type AiPermission,
  type AiPolicyDimension,
  type FolderPolicyRule,
  type IVaultAdapter,
  type TextUpdateFiles,
} from "@plainva/core";
import { AI_POLICY_FILE } from "./aiVaultHost";

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

/**
 * One step the user took in the settings — a rule set, changed or taken away — applied to the folder rules as
 * they lie in `.agent/policy.yml` at that moment (Sammelplan 3.87): through the chain's one entry for a change,
 * so a rule another device saved since the page read the file stays. A file that is not there is made. Answers
 * the rules as written, for the page to show.
 */
export async function changeFolderRules(
  files: TextUpdateFiles & Pick<IVaultAdapter, "exists">,
  step: (rules: FolderPolicyRule[]) => FolderPolicyRule[],
): Promise<FolderPolicyRule[]> {
  if (!(await files.exists(AI_POLICY_FILE))) {
    const made = step([]);
    await files.writeTextFile(AI_POLICY_FILE, serializePolicyFile(made));
    return made;
  }
  const written = { rules: [] as FolderPolicyRule[] };
  await updateVaultText(files, AI_POLICY_FILE, (current) => {
    written.rules = step(parsePolicyFile(current).rules);
    return serializePolicyFile(written.rules);
  });
  return written.rules;
}
