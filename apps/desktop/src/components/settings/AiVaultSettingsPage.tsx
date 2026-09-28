import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { parsePolicyFile, serializePolicyFile, type FolderPolicyRule } from "@plainva/core";
import {
  AI_POLICY_FILE,
  Banner,
  Button,
  ICON,
  IconButton,
  ruleOf,
  Select,
  SettingCard,
  SettingCardNote,
  SettingRow,
  toast,
  unruledFolders,
  withoutRule,
  withRuleValue,
  type PolicyChoice,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { currentAiPolicy } from "../../services/ai/desktopAi";
import { AreaHead } from "./AppPages";

/**
 * Settings → AI & automation, VAULT world (plan KI-Harness §13.2): the privacy
 * rules that travel with this vault. A rule written here is a plain YAML file
 * in `.agent/policy.yml`, readable by people and other tools alike; a note
 * can still carry its own `plainva.ai` in its frontmatter.
 */
export function AiVaultSettingsPage({ isActiveVault }: { isActiveVault: boolean }) {
  const { t } = useTranslation();
  const { vaultAdapter, queryService, workspaceSecurityStatus } = useVault();
  const [rules, setRules] = useState<FolderPolicyRule[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [adding, setAdding] = useState("");

  const load = useCallback(async () => {
    if (!vaultAdapter) return;
    let text: string | null;
    try {
      text = (await vaultAdapter.exists(AI_POLICY_FILE)) ? await vaultAdapter.readTextFile(AI_POLICY_FILE) : null;
    } catch {
      text = null;
    }
    const parsed = text === null ? { rules: [], problems: [] } : parsePolicyFile(text);
    setRules(parsed.rules);
    setProblems(parsed.problems);
    setFolders(queryService ? await queryService.getAllFolders().catch(() => []) : []);
  }, [vaultAdapter, queryService]);

  useEffect(() => {
    void load();
  }, [load]);

  // The rules live in the vault's own files: another vault's settings cannot
  // show or change them until it is the open one (as calendars and mail).
  if (!isActiveVault) {
    return (
      <div className="pv-setpage" data-testid="settings-ai-vault">
        <AreaHead areaId="aiVault" />
        <SettingCard>
          <SettingCardNote>{t("pim.openVaultFirst")}</SettingCardNote>
        </SettingCard>
      </div>
    );
  }
  if (!vaultAdapter || rules === null) return null;

  const save = async (next: FolderPolicyRule[]) => {
    setRules(next);
    try {
      await vaultAdapter.writeTextFile(AI_POLICY_FILE, serializePolicyFile(next));
      currentAiPolicy()?.invalidate();
      toast.success(t("ai.policy.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      void load();
    }
  };
  const options = (withInherit: boolean) => [
    ...(withInherit ? [{ value: "inherit" as const, label: t("ai.policy.inherit") }] : []),
    { value: "allow" as const, label: t("ai.policy.allow") },
    { value: "deny" as const, label: t("ai.policy.deny") },
  ];
  const vaultRule = ruleOf(rules, "");
  const folderRules = rules.filter((r) => r.folder !== "");
  const free = unruledFolders(rules, folders);

  const controls = (folder: string, rule: FolderPolicyRule | undefined, withInherit: boolean) => (
    <div className="pv-ai-rowactions">
      <Select<PolicyChoice>
        ariaLabel={`${t("ai.policy.cloud")} · ${folder || t("ai.policy.vaultDefault")}`}
        value={rule?.cloud ?? (withInherit ? "inherit" : "allow")}
        options={options(withInherit).map((o) => ({ ...o, label: `${t("ai.policy.cloud")}: ${o.label}` }))}
        onChange={(choice) => void save(withRuleValue(rules, folder, "cloud", choice))}
      />
      <Select<PolicyChoice>
        ariaLabel={`${t("ai.policy.web")} · ${folder || t("ai.policy.vaultDefault")}`}
        value={rule?.web ?? (withInherit ? "inherit" : "allow")}
        options={options(withInherit).map((o) => ({ ...o, label: `${t("ai.policy.web")}: ${o.label}` }))}
        onChange={(choice) => void save(withRuleValue(rules, folder, "web", choice))}
      />
    </div>
  );

  return (
    <div className="pv-setpage" data-testid="settings-ai-vault">
      <AreaHead areaId="aiVault" />
      <SettingCard label={t("ai.policy.title")}>
        <SettingCardNote>{t("ai.policy.desc")}</SettingCardNote>
        {problems.length > 0 && (
          <SettingCardNote>
            <Banner kind="warning" rounded>{t("ai.policy.problems", { lines: problems.join("; ") })}</Banner>
          </SettingCardNote>
        )}
        <SettingRow label={t("ai.policy.vaultDefault")}>{controls("", vaultRule, false)}</SettingRow>
        {folderRules.map((rule) => (
          <SettingRow key={rule.folder} label={rule.folder}>
            <div className="pv-ai-rowactions">
              {controls(rule.folder, rule, true)}
              <IconButton label={t("ai.policy.removeRule")} size="sm" onClick={() => void save(withoutRule(rules, rule.folder))}>
                <Trash2 size={ICON.ui} />
              </IconButton>
            </div>
          </SettingRow>
        ))}
        {free.length > 0 && (
          <SettingRow label={t("ai.policy.addFolder")}>
            <div className="pv-ai-rowactions">
              <Select
                ariaLabel={t("ai.policy.folder")}
                value={adding}
                placeholder={t("ai.policy.folder")}
                options={free.map((f) => ({ value: f, label: f }))}
                onChange={setAdding}
              />
              <Button size="sm" variant="secondary" disabled={!adding} onClick={() => { void save(withRuleValue(rules, adding, "cloud", "deny")); setAdding(""); }}>
                {t("ai.policy.addRule")}
              </Button>
            </div>
          </SettingRow>
        )}
        <SettingCardNote>{t("ai.policy.localAllowed")}</SettingCardNote>
        {workspaceSecurityStatus !== null && <SettingCardNote>{t("ai.policy.encrypted")}</SettingCardNote>}
      </SettingCard>
    </div>
  );
}
