import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { parsePolicyFile, serializePolicyFile, type FolderPolicyRule } from "@plainva/core";
import {
  AI_POLICY_FILE,
  Banner,
  Button,
  ICON,
  memorySummary,
  skillView,
  waitingCount,
  workshopSections,
  IconButton,
  ruleOf,
  Select,
  SettingCard,
  SettingCardNote,
  SettingRow,
  Switch,
  TextInput,
  toast,
  unruledFolders,
  withoutRule,
  withRuleValue,
  type PolicyChoice,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { currentAiPolicy, getDesktopAiSession, requestMemoryView, requestSkillsView } from "../../services/ai/desktopAi";
import { AreaHead } from "./AppPages";
import { ExternalToolsCard } from "./ExternalToolsCard";

/**
 * Settings → AI & automation, VAULT world (plan KI-Harness §13.2): the privacy
 * rules that travel with this vault. A rule written here is a plain YAML file
 * in `.agent/policy.yml`, readable by people and other tools alike; a note
 * can still carry its own `plainva.ai` in its frontmatter.
 */
const NOOP = () => () => {};
const NONE = () => null;

/**
 * The skills of this vault in its settings (plan KI-Harness P3-5, mockup
 * chapter 7): a summary, what waits for an approval on this device, and the
 * way into the workshop in the AI tab — reviewing one entry right away.
 */
function SkillsCard({ onOpenSkills, onOpenMemory }: { onOpenSkills: (review?: string) => void; onOpenMemory: () => void }) {
  const { t } = useTranslation();
  const session = getDesktopAiSession();
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  useEffect(() => {
    void session?.refreshSkills();
    void session?.refreshMemory();
  }, [session]);
  if (!session || !state) return null;
  const entries = state.skills.entries;
  const sections = workshopSections(entries);
  const app = sections.app.filter((e) => e.status === "active").length;
  return (
    <SettingCard label={t("ai.workshop.settingsTitle")}>
      <SettingCardNote>{t("ai.workshop.settingsDesc")}</SettingCardNote>
      <SettingRow label={t("ai.workshop.title")} desc={t("ai.workshop.summary", { app, own: sections.own.length, waiting: waitingCount(entries) })}>
        <Button size="sm" variant="secondary" onClick={() => onOpenSkills()} data-testid="settings-ai-skills-open">
          {t("ai.workshop.open")}
        </Button>
      </SettingRow>
      {sections.waiting
        .filter((e) => e.status === "new" || e.status === "changed")
        .map((entry) => (
          <SettingRow key={entry.source.id} label={entry.source.kind === "agents" ? "AGENTS.md" : skillView(t, entry).title} desc={t(`ai.workshop.status.${entry.status}`)}>
            <Button size="sm" variant="tonal" onClick={() => onOpenSkills(entry.source.id)} data-testid="settings-ai-skill-review">
              {t("ai.workshop.review")}
            </Button>
          </SettingRow>
        ))}
      {/* The vault's memory (plan P6): how much it holds, and the way to it in the AI tab. */}
      <SettingRow label={t("ai.memory.segment")} desc={memorySummary(t, state.memory)}>
        <Button size="sm" variant="secondary" disabled={!state.memory.available} onClick={onOpenMemory} data-testid="settings-ai-memory-open">
          {t("ai.memory.open")}
        </Button>
      </SettingRow>
    </SettingCard>
  );
}

/**
 * The internet for this vault (plan KI-Harness P4): off until the user decides
 * — a setting of this device, kept in the app's data and never in the vault,
 * whose writers could otherwise switch it on —, and the sites whose pages
 * need no asking.
 */
function InternetCard() {
  const { t } = useTranslation();
  const session = getDesktopAiSession();
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  const [site, setSite] = useState("");
  if (!session || !state) return null;
  const web = state.web;
  const add = () => {
    void session.allowWebHost(site).then((added) => {
      if (added) setSite("");
      else toast.error(t("ai.web.settings.siteInvalid"));
    });
  };
  return (
    <SettingCard label={t("ai.web.settings.title")}>
      <SettingCardNote>{t("ai.web.settings.desc")}</SettingCardNote>
      <SettingRow label={t("ai.web.settings.switch")} desc={t("ai.web.settings.switchDesc")}>
        <Switch checked={web.enabled} onChange={(enabled) => void session.setWebEnabled(enabled)} label={t("ai.web.settings.switch")} />
      </SettingRow>
      {web.enabled && (
        <SettingRow label={t("ai.web.settings.sites")} desc={t("ai.web.settings.sitesDesc")}>
          <div className="pv-ai-rowactions">
            <TextInput
              value={site}
              placeholder={t("ai.web.settings.sitePlaceholder")}
              aria-label={t("ai.web.settings.addSite")}
              onChange={(event) => setSite(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && site.trim()) add();
              }}
              data-testid="settings-ai-web-site"
            />
            <Button size="sm" variant="secondary" disabled={!site.trim()} onClick={add} data-testid="settings-ai-web-add">
              {t("ai.web.settings.addSite")}
            </Button>
          </div>
        </SettingRow>
      )}
      {web.enabled && web.allow.length === 0 && <SettingCardNote>{t("ai.web.settings.sitesNone")}</SettingCardNote>}
      {web.enabled &&
        web.allow.map((host) => (
          <SettingRow key={host} label={host}>
            <IconButton label={t("ai.web.settings.removeSite", { host })} size="sm" onClick={() => void session.disallowWebHost(host)}>
              <Trash2 size={ICON.ui} />
            </IconButton>
          </SettingRow>
        ))}
    </SettingCard>
  );
}

export function AiVaultSettingsPage({ isActiveVault, onClose }: { isActiveVault: boolean; onClose?: () => void }) {
  const { t } = useTranslation();
  const openSkills = (review?: string) => {
    requestSkillsView(review ?? null);
    onClose?.();
  };
  const openMemory = () => {
    requestMemoryView();
    onClose?.();
  };
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
      <InternetCard />
      <ExternalToolsCard />
      <SkillsCard onOpenSkills={openSkills} onOpenMemory={openMemory} />
    </div>
  );
}
