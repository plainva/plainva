import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Plug, Plus } from "lucide-react";
import { directFolderOf, mcpServerStanding, parsePolicyFile, type AiPolicyDimension, type AiWriteRule, type FolderPolicyRule } from "@plainva/core/ai";
import {
  AreaBoundary,
  Banner,
  Button,
  GroupCard,
  ICON,
  Row,
  RowList,
  SectionLabel,
  Switch,
  toast,
} from "@plainva/ui";
import {
  AI_POLICY_FILE,
  changeFolderRules,
  externalStatusText,
  memorySummary,
  ruleOf,
  skillView,
  waitingCount,
  workshopSections,
  unruledFolders,
  withoutRule,
  withRuleValue,
  withWriteRule,
  type PolicyChoice,
} from "@plainva/ui/ai";
import { AppBar } from "../components/AppBar";
import { ExternalAddSheet, ExternalReviewSheet } from "../components/ExternalToolsSheets";
import { MobileRoutinesSection } from "../components/MobileRoutinesSection";
import { currentMobileAiPolicy, getMobileAiSession } from "../services/ai/mobileAi";
import { mActions, mPrompt, mSelect, mTargets } from "../services/mobileDialogs";
import type { MobileVault } from "../services/vaultService";

/**
 * Settings → AI & automation on the phone, VAULT world (plan KI-Harness §13.2):
 * the privacy rules that travel with this vault, written as `.agent/policy.yml`
 * — the same file the desktop edits.
 */
export function AiPolicyScreen({
  vault,
  onBack,
  onOpenSkills,
  onOpenMemory,
  onOpenNote,
  onOpenAiSettings,
}: {
  vault: MobileVault;
  onBack: () => void;
  onOpenSkills: (review?: string) => void;
  onOpenMemory: () => void;
  onOpenNote: (path: string) => void;
  /** The page "AI" of this phone, where the AI is switched on (mockup M5: the notice that it is off has the way there). */
  onOpenAiSettings: () => void;
}) {
  const { t } = useTranslation();
  // Skills and memory (plan KI-Harness P3-5): the summary, what waits, and the way into the workshop.
  const session = getMobileAiSession();
  const aiState = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => {
    void session.refreshSkills();
    void session.refreshMemory();
    void session.mcp.refresh();
  }, [session]);
  const sections = workshopSections(aiState.skills.entries);
  // External tools (plan KI-Harness P4.5): the sheet that is open — adding a server, or the review of one.
  const [external, setExternal] = useState<"add" | { review: string } | null>(null);
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

  // The user's step, applied to the rules as they lie in the file at that moment (`changeFolderRules`).
  const save = async (step: (current: FolderPolicyRule[]) => FolderPolicyRule[]) => {
    try {
      setRules(await changeFolderRules(vault.files, step));
      currentMobileAiPolicy()?.invalidate();
      // The rules decide which titles the system's assistant may know (AI harness P4.7): that list is written again.
      window.dispatchEvent(new CustomEvent("m-ai-policy-changed"));
      toast.success(t("ai.policy.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      void load();
    }
  };
  const word = (choice: PolicyChoice | undefined) => (choice === "deny" ? t("ai.policy.deny") : choice === "allow" ? t("ai.policy.allow") : t("ai.policy.inherit"));
  // "Change without asking" (plan "KI direkt schreiben", W3): allowed or not, in the words of the other two questions.
  const writeWord = (choice: AiWriteRule | "inherit" | undefined) => (choice === "direct" ? t("ai.policy.allow") : choice === "ask" ? t("ai.policy.deny") : t("ai.policy.inherit"));
  // The rules as named columns (mockup M5): the two answers that keep data in or let it out, under the head above the
  // card. A rule that forbids the internet needs no remark that it is off here; one that allows it is not in effect
  // while the internet is off on this phone, which the head says once.
  const columns = (rule: FolderPolicyRule | undefined, inherit: boolean) => (
    <span className="m-rulecols-values" data-testid="ai-policy-values">
      <span>{word(rule?.cloud ?? (inherit ? "inherit" : "allow"))}</span>
      <span>{word(rule?.web ?? (inherit ? "inherit" : "allow"))}</span>
    </span>
  );
  // "Change without asking", the answer that lets something happen (plan "KI direkt schreiben"): a line of its own
  // under the folder only where it holds there — its own rule or one above it — in the on-state pair, in the words the
  // columns use, so a folder with a rule of its own and one that takes it from above stay apart.
  const directLine = (folder: string, rule: FolderPolicyRule | undefined, inherit: boolean) => {
    const probe = `${folder}${folder && !folder.endsWith("/") ? "/" : ""}.probe.md`;
    if (directFolderOf(probe, rules) === null) return undefined;
    return (
      <span className="m-rule-on" data-testid="ai-policy-direct">
        {`${t("ai.policy.write")}: ${writeWord(rule?.write ?? (inherit ? "inherit" : "ask"))}`}
      </span>
    );
  };
  // A rule that allows the internet does not take effect while the internet is off on this phone: said once, above.
  const webOffHere = !aiState.web.enabled && (ruleOf(rules, "")?.web !== "deny" || rules.some((rule) => rule.web === "allow"));

  const edit = async (folder: string, inherit: boolean) => {
    const rule = ruleOf(rules, folder);
    const pick = await mActions({
      title: folder || t("ai.policy.vaultDefault"),
      options: [
        { value: "cloud", label: t("ai.policy.cloud"), desc: word(rule?.cloud ?? (inherit ? "inherit" : "allow")) },
        { value: "web", label: t("ai.policy.web"), desc: word(rule?.web ?? (inherit ? "inherit" : "allow")) },
        { value: "write", label: t("ai.policy.write"), desc: writeWord(rule?.write ?? (inherit ? "inherit" : "ask")) },
        ...(folder ? [{ value: "remove", label: t("ai.policy.removeRule"), danger: true }] : []),
      ],
    });
    if (!pick) return;
    if (pick === "remove") {
      void save((current) => withoutRule(current, folder));
      return;
    }
    if (pick === "write") {
      const value = await mSelect({
        title: `${folder || t("ai.policy.vaultDefault")} · ${t("ai.policy.write")}`,
        options: [...(inherit ? [{ value: "inherit", label: t("ai.policy.inherit") }] : []), { value: "direct", label: t("ai.policy.allow") }, { value: "ask", label: t("ai.policy.deny") }],
        value: rule?.write ?? (inherit ? "inherit" : "ask"),
      });
      if (value) void save((current) => withWriteRule(current, folder, value as AiWriteRule | "inherit"));
      return;
    }
    const dimension = pick as AiPolicyDimension;
    const value = await mSelect({
      title: `${folder || t("ai.policy.vaultDefault")} · ${t(`ai.policy.${dimension}`)}`,
      options: [...(inherit ? [{ value: "inherit", label: t("ai.policy.inherit") }] : []), { value: "allow", label: t("ai.policy.allow") }, { value: "deny", label: t("ai.policy.deny") }],
      value: rule?.[dimension] ?? (inherit ? "inherit" : "allow"),
    });
    if (value) void save((current) => withRuleValue(current, folder, dimension, value as PolicyChoice));
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
      {/* The area's own name, as the settings list has it (plan KI-Oberflächen K2): what the AI may do in this vault. */}
      <AppBar onBack={onBack} title={t("ai.settings.vaultTitle")} testId="appbar-area-aiVault" />
      <div className="m-settings">
        <p className="m-hint">{t("ai.settings.sectionVault")}</p>
        {/* The rules here hold once the AI is on (plan KI-Oberflächen K6): said where it is off on this device. */}
        {!aiState.settings.enabled && (
          <Banner
            kind="info"
            rounded
            testId="settings-ai-vault-off"
            actions={
              <Button size="sm" variant="secondary" onClick={onOpenAiSettings} data-testid="settings-ai-vault-open-ai">
                {t("ai.error.openSetup")}
              </Button>
            }
          >
            {t("ai.settings.vaultOff")}
          </Banner>
        )}
        {/* The internet for this vault (plan KI-Harness P4): off until the user decides, on this device — as on the desktop. */}
        <SectionLabel info={web.enabled ? t("ai.web.settings.sitesDesc") : t("ai.web.settings.desc")}>{t("ai.web.settings.title")}</SectionLabel>
        {/* Fully local (plan KI-Harness P7): no conversation reads a page or searches, whatever this vault allows. */}
        {aiState.settings.localOnly && <p className="m-hint" data-testid="ai-rests-web">{t("ai.mode.restsHere")}</p>}
        <GroupCard>
          <RowList>
            <Row
              wrap
              title={t("ai.web.settings.switch")}
              subtitle={t("ai.web.settings.switchLine")}
              info={t("ai.web.settings.switchDesc")}
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
        <SectionLabel info={t("ai.policy.desc")}>{t("ai.policy.title")}</SectionLabel>
        {problems.length > 0 && <Banner kind="warning" rounded>{t("ai.policy.problems", { lines: problems.join("; ") })}</Banner>}
        {webOffHere && <p className="m-hint" data-testid="ai-policy-weboff">{`${t("ai.policy.web")}: ${t("ai.policy.webOff")}`}</p>}
        <GroupCard>
          <RowList>
            {/* The head of the two columns: a row of the card itself, so its names stand exactly over the answers (mockup M5). */}
            <Row
              title={<span aria-hidden="true" />}
              end={
                <span className="m-rulecols-values m-rulecols" aria-hidden="true">
                  <RuleColumn label={t("ai.policy.cloud")} />
                  <RuleColumn label={t("ai.policy.web")} />
                </span>
              }
              data-testid="ai-policy-head"
            />
            <Row wrap title={t("ai.policy.vaultDefault")} subtitle={directLine("", ruleOf(rules, ""), false)} end={columns(ruleOf(rules, ""), false)} onClick={() => void edit("", false)} data-testid="ai-policy-row" />
            {rules
              .filter((r) => r.folder !== "")
              .map((rule) => (
                <Row key={rule.folder} wrap title={rule.folder} subtitle={directLine(rule.folder, rule, true)} end={columns(rule, true)} onClick={() => void edit(rule.folder, true)} data-testid="ai-policy-row" />
              ))}
            {free.length > 0 && (
              <Row
                icon={<Plus size={ICON.ui} />}
                title={t("ai.policy.addFolder")}
                onClick={() => {
                  void mTargets({ title: t("ai.policy.folder"), options: free.map((f) => ({ value: f, label: f })), search: t("ai.policy.folder") }).then((folder) => {
                    if (folder) void save((current) => withRuleValue(current, folder, "cloud", "deny"));
                  });
                }}
              />
            )}
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.policy.localAllowed")}</p>
        <p className="m-hint">{t("ai.policy.writeNote")}</p>
        {vault.workspaceRuntime !== null && <p className="m-hint">{t("ai.policy.encrypted")}</p>}
        {/* External tools (plan KI-Harness P4.5): the servers this phone knows, and whether this vault uses each — as on the desktop. */}
        {aiState.mcp.available && aiState.mcp.loaded && (
          <>
            <SectionLabel info={t("ai.ext.desc")}>{t("ai.ext.title")}</SectionLabel>
            {/* Fully local (plan KI-Harness P7): no server is asked or called. */}
            {aiState.settings.localOnly && <p className="m-hint" data-testid="ai-rests-ext">{t("ai.mode.restsHere")}</p>}
            <GroupCard>
              <RowList>
                {aiState.mcp.servers.map((server) => {
                  const standing = mcpServerStanding(server);
                  const usable = standing === "ready" || standing === "off";
                  return (
                    <Row
                      key={server.id}
                      wrap
                      controls={usable}
                      icon={<Plug size={ICON.ui} />}
                      title={server.label}
                      subtitle={usable ? externalStatusText(t, server) : `${externalStatusText(t, server)} · ${t("ai.ext.reviewAction")}`}
                      end={usable ? <Switch checked={server.enabled} label={t("ai.ext.use", { server: server.label })} onChange={(enabled) => void session.mcp.setVault(server.id, { enabled })} /> : undefined}
                      onClick={() => setExternal({ review: server.id })}
                      data-testid="settings-ai-ext-server"
                    />
                  );
                })}
                <Row icon={<Plus size={ICON.ui} />} title={t("ai.ext.addAction")} onClick={() => setExternal("add")} data-testid="settings-ai-ext-add" />
              </RowList>
            </GroupCard>
            {aiState.mcp.servers.length === 0 && <p className="m-hint">{t("ai.ext.none")}</p>}
          </>
        )}
        {/* Routines (plan KI-Harness P8): a skill at a time its user set, as on the desktop; or a folder's log (P8-2). */}
        <MobileRoutinesSection onOpenNote={onOpenNote} folders={folders} />
        <SectionLabel info={t("ai.workshop.settingsDesc")}>{t("ai.workshop.settingsTitle")}</SectionLabel>
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
            {/* The vault's memory (plan P6): how much it holds, and the way to it in the AI screen. */}
            <Row wrap title={t("ai.memory.open")} subtitle={memorySummary(t, aiState.memory)} disabled={!aiState.memory.available} onClick={onOpenMemory} data-testid="settings-ai-memory-open" />
          </RowList>
        </GroupCard>
      </div>
      {external === "add" && <AreaBoundary area="sheet:externalAdd" size="dialog" exit={{ label: t("common.close"), onExit: () => setExternal(null) }}><ExternalAddSheet onClose={() => setExternal(null)} onAdded={(id) => setExternal({ review: id })} /></AreaBoundary>}
      {external !== null && external !== "add" && <AreaBoundary area="sheet:externalReview" size="dialog" exit={{ label: t("common.close"), onExit: () => setExternal(null) }}><ExternalReviewSheet vault={vault} serverId={external.review} onClose={() => setExternal(null)} /></AreaBoundary>}
    </div>
  );
}

/** The head of one column of the rule table: the question it asks (Design_Language "Rules as named columns"). */
function RuleColumn({ label }: { label: string }) {
  return <span>{label}</span>;
}
