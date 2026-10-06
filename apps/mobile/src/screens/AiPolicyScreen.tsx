import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Plus } from "lucide-react";
import { parsePolicyFile, serializePolicyFile, type AiPolicyDimension, type FolderPolicyRule } from "@plainva/core";
import {
  AI_POLICY_FILE,
  Banner,
  GroupCard,
  ICON,
  Row,
  RowList,
  ruleOf,
  SectionLabel,
  skillView,
  Switch,
  toast,
  waitingCount,
  workshopSections,
  unruledFolders,
  withoutRule,
  withRuleValue,
  type PolicyChoice,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { currentMobileAiPolicy, getMobileAiSession } from "../services/ai/mobileAi";
import { mActions, mPrompt, mSelect, mTargets } from "../services/mobileDialogs";
import type { MobileVault } from "../services/vaultService";

/**
 * Settings → AI & automation on the phone, VAULT world (plan KI-Harness §13.2):
 * the privacy rules that travel with this vault, written as `.agent/policy.yml`
 * — the same file the desktop edits.
 */
export function AiPolicyScreen({ vault, onBack, onOpenSkills }: { vault: MobileVault; onBack: () => void; onOpenSkills: (review?: string) => void }) {
  const { t } = useTranslation();
  // Skills and memory (plan KI-Harness P3-5): the summary, what waits, and the way into the workshop.
  const session = getMobileAiSession();
  const aiState = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => {
    void session.refreshSkills();
  }, [session]);
  const sections = workshopSections(aiState.skills.entries);
  const [rules, setRules] = useState<FolderPolicyRule[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);

  const load = useCallback(async () => {
    let text: string | null;
    try {
      text = (await vault.files.exists(AI_POLICY_FILE)) ? await vault.files.readTextFile(AI_POLICY_FILE) : null;
    } catch {
      text = null;
    }
    const parsed = text === null ? { rules: [], problems: [] } : parsePolicyFile(text);
    setRules(parsed.rules);
    setProblems(parsed.problems);
    setFolders(vault.queryService ? await vault.queryService.getAllFolders().catch(() => []) : []);
  }, [vault]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rules === null) return null;

  const save = async (next: FolderPolicyRule[]) => {
    setRules(next);
    try {
      await vault.files.writeTextFile(AI_POLICY_FILE, serializePolicyFile(next));
      currentMobileAiPolicy()?.invalidate();
      toast.success(t("ai.policy.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      void load();
    }
  };
  const word = (choice: PolicyChoice | undefined) => (choice === "deny" ? t("ai.policy.deny") : choice === "allow" ? t("ai.policy.allow") : t("ai.policy.inherit"));
  const line = (rule: FolderPolicyRule | undefined, inherit: boolean) =>
    `${t("ai.policy.cloud")}: ${word(rule?.cloud ?? (inherit ? "inherit" : "allow"))} · ${t("ai.policy.web")}: ${word(rule?.web ?? (inherit ? "inherit" : "allow"))}`;

  const edit = async (folder: string, inherit: boolean) => {
    const rule = ruleOf(rules, folder);
    const pick = await mActions({
      title: folder || t("ai.policy.vaultDefault"),
      options: [
        { value: "cloud", label: t("ai.policy.cloud"), desc: word(rule?.cloud ?? (inherit ? "inherit" : "allow")) },
        { value: "web", label: t("ai.policy.web"), desc: word(rule?.web ?? (inherit ? "inherit" : "allow")) },
        ...(folder ? [{ value: "remove", label: t("ai.policy.removeRule"), danger: true }] : []),
      ],
    });
    if (!pick) return;
    if (pick === "remove") {
      void save(withoutRule(rules, folder));
      return;
    }
    const dimension = pick as AiPolicyDimension;
    const value = await mSelect({
      title: `${folder || t("ai.policy.vaultDefault")} · ${t(`ai.policy.${dimension}`)}`,
      options: [...(inherit ? [{ value: "inherit", label: t("ai.policy.inherit") }] : []), { value: "allow", label: t("ai.policy.allow") }, { value: "deny", label: t("ai.policy.deny") }],
      value: rule?.[dimension] ?? (inherit ? "inherit" : "allow"),
    });
    if (value) void save(withRuleValue(rules, folder, dimension, value as PolicyChoice));
  };

  const web = aiState.web;
  /** A site whose pages need no asking: typed as a name or an address, kept as the name. */
  const addSite = async () => {
    const typed = await mPrompt({ title: t("ai.web.settings.addSite"), message: t("ai.web.settings.sitesDesc"), placeholder: t("ai.web.settings.sitePlaceholder") });
    if (typed.cancelled || !typed.value.trim()) return;
    if (!(await session.allowWebHost(typed.value))) toast.error(t("ai.web.settings.siteInvalid"));
  };
  const removeSite = async (host: string) => {
    const pick = await mActions({ title: host, options: [{ value: "remove", label: t("ai.web.settings.removeSite", { host }), danger: true }] });
    if (pick === "remove") void session.disallowWebHost(host);
  };

  const free = unruledFolders(rules, folders);
  return (
    <div className="m-page" data-testid="settings-ai-vault">
      <AppBar onBack={onBack} title={t("ai.policy.title")} testId="appbar-area-aiVault" />
      <div className="m-settings">
        <p className="m-hint">{t("ai.policy.desc")}</p>
        {problems.length > 0 && <Banner kind="warning" rounded>{t("ai.policy.problems", { lines: problems.join("; ") })}</Banner>}
        <SectionLabel>{t("ai.policy.scope")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row wrap title={t("ai.policy.vaultDefault")} subtitle={line(ruleOf(rules, ""), false)} onClick={() => void edit("", false)} />
            {rules
              .filter((r) => r.folder !== "")
              .map((rule) => (
                <Row key={rule.folder} wrap title={rule.folder} subtitle={line(rule, true)} onClick={() => void edit(rule.folder, true)} />
              ))}
            {free.length > 0 && (
              <Row
                icon={<Plus size={ICON.ui} />}
                title={t("ai.policy.addFolder")}
                onClick={() => {
                  void mTargets({ title: t("ai.policy.folder"), options: free.map((f) => ({ value: f, label: f })), search: t("ai.policy.folder") }).then((folder) => {
                    if (folder) void save(withRuleValue(rules, folder, "cloud", "deny"));
                  });
                }}
              />
            )}
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.policy.localAllowed")}</p>
        {vault.workspaceRuntime !== null && <p className="m-hint">{t("ai.policy.encrypted")}</p>}
        {/* The internet for this vault (plan KI-Harness P4): off until the user decides, on this device — as on the desktop. */}
        <SectionLabel>{t("ai.web.settings.title")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              wrap
              title={t("ai.web.settings.switch")}
              subtitle={t("ai.web.settings.switchDesc")}
              end={<Switch checked={web.enabled} label={t("ai.web.settings.switch")} onChange={(enabled) => void session.setWebEnabled(enabled)} />}
              data-testid="settings-ai-web"
            />
            {web.enabled &&
              web.allow.map((host) => (
                <Row key={host} icon={<Globe size={ICON.ui} />} title={host} onClick={() => void removeSite(host)} data-testid="settings-ai-web-site" />
              ))}
            {web.enabled && <Row icon={<Plus size={ICON.ui} />} title={t("ai.web.settings.addSite")} onClick={() => void addSite()} data-testid="settings-ai-web-add" />}
          </RowList>
        </GroupCard>
        <p className="m-hint">{web.enabled ? t("ai.web.settings.sitesDesc") : t("ai.web.settings.desc")}</p>
        <SectionLabel>{t("ai.workshop.settingsTitle")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              wrap
              title={t("ai.workshop.open")}
              subtitle={t("ai.workshop.summary", { app: sections.app.filter((e) => e.status === "active").length, own: sections.own.length, waiting: waitingCount(aiState.skills.entries) })}
              onClick={() => onOpenSkills()}
              data-testid="settings-ai-skills-open"
            />
            {sections.waiting
              .filter((e) => e.status === "new" || e.status === "changed")
              .map((entry) => (
                <Row
                  key={entry.source.id}
                  title={entry.source.kind === "agents" ? "AGENTS.md" : skillView(t, entry).title}
                  subtitle={`${t(`ai.workshop.status.${entry.status}`)} · ${t("ai.workshop.review")}`}
                  onClick={() => onOpenSkills(entry.source.id)}
                  data-testid="settings-ai-skill-review"
                />
              ))}
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.workshop.settingsDesc")}</p>
      </div>
    </div>
  );
}
