import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Plus, Trash2 } from "lucide-react";
import { acpCommandText } from "@plainva/core";
import { agentArgsFromText, agentSeenText, Banner, Button, ICON, IconButton, Modal, SettingCard, SettingCardNote, SettingRow, TextArea, TextInput, toast, type AiSession } from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { getDesktopAiSession } from "../../services/ai/desktopAi";

const NOOP = () => () => {};
const NONE = () => null;

/**
 * Settings → AI & automation → "External agents" (plan KI-Harness P4.6): the
 * agents this computer knows. An agent is a program of another maker that the
 * user installed and signed in to themselves; adding one here only tells
 * Plainva which file to start, and the native side shows that file and every
 * argument in a dialog of the system before it remembers them. Plainva
 * installs no agent and holds no credential of one.
 *
 * Desktop only (parity catalog `ai-external-agents`).
 */
export function ExternalAgentsCard() {
  const { t, i18n } = useTranslation();
  const session = getDesktopAiSession();
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void session?.agents.refresh();
  }, [session]);
  if (!session || !state || !state.agents.available || !state.agents.loaded) return null;
  const { agents, found } = state.agents;

  const confirmText = () => ({ title: t("ai.agent.add.confirmTitle"), message: t("ai.agent.add.confirmMessage"), confirm: t("ai.agent.add.confirmAction"), cancel: t("common.cancel") });
  const addFound = (entry: (typeof found)[number]) => {
    setBusy(entry.key);
    void session.agents
      .add(entry.name, { program: entry.program, args: entry.args }, confirmText(), entry.key)
      .then((result) => {
        if (result.ok) toast.success(t("ai.agent.add.added", { agent: entry.name }));
        else if (result.problem === "failed") toast.error(t("ai.agent.add.failed"));
      })
      .finally(() => setBusy(null));
  };
  const remove = (id: string, label: string) => {
    void appConfirm({ title: t("ai.agent.settings.removeConfirm", { agent: label }), message: t("ai.agent.settings.removeBody"), confirmLabel: t("ai.agent.settings.removeAction") }).then((yes) => {
      if (yes) void session.agents.remove(id);
    });
  };

  return (
    <>
      <SettingCard label={t("ai.agent.title")}>
        <SettingCardNote>{t("ai.agent.settings.desc")}</SettingCardNote>
        {agents.length === 0 && <SettingCardNote>{t("ai.agent.settings.none")}</SettingCardNote>}
        {agents.map((agent) => (
          <SettingRow key={agent.id} label={agent.label} desc={`${acpCommandText(agent.program, agent.args)} · ${agentSeenText(t, agent, i18n.language)}`}>
            <IconButton label={t("ai.agent.settings.remove", { agent: agent.label })} onClick={() => remove(agent.id, agent.label)} data-testid="settings-ai-agent-remove">
              <Trash2 size={ICON.ui} />
            </IconButton>
          </SettingRow>
        ))}
        {/* Agents Plainva knows by name that are installed here: found by looking, started by nobody until they are added. */}
        {found.map((entry) => (
          <SettingRow key={entry.key} label={entry.name} desc={`${t("ai.agent.settings.found")} · ${acpCommandText(entry.program, entry.args)}`}>
            <Button size="sm" variant="secondary" icon={<Plus size={ICON.ui} />} disabled={busy !== null} onClick={() => addFound(entry)} data-testid="settings-ai-agent-add-found">
              {t("ai.agent.settings.add")}
            </Button>
          </SettingRow>
        ))}
        <SettingRow label={t("ai.agent.settings.addOwn")} desc={t("ai.agent.settings.addOwnDesc")}>
          <Button size="sm" variant="secondary" icon={<Plus size={ICON.ui} />} onClick={() => setAdding(true)} data-testid="settings-ai-agent-add">
            {t("ai.agent.settings.addAction")}
          </Button>
        </SettingRow>
      </SettingCard>
      {adding && <AgentAddDialog session={session} confirmText={confirmText} onClose={() => setAdding(false)} />}
    </>
  );
}

/** Add an agent by its command. The native side shows what was typed once more — resolved to the file it means — and asks. */
function AgentAddDialog({ session, confirmText, onClose }: { session: AiSession; confirmText: () => { title: string; message: string; confirm: string; cancel: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [program, setProgram] = useState("");
  const [args, setArgs] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const ready = name.trim().length > 0 && program.trim().length > 0;
  const submit = () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(false);
    void session.agents
      .add(name.trim(), { program: program.trim(), args: agentArgsFromText(args) }, confirmText())
      .then((result) => {
        if (result.ok) {
          toast.success(t("ai.agent.add.added", { agent: name.trim() }));
          onClose();
        } else if (result.problem === "failed") setProblem(true);
      })
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title={t("ai.agent.add.title")}
      icon={<Bot size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-agent-add"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={submit} data-testid="ai-agent-add-submit">
            {t("ai.agent.add.confirmAction")}
          </Button>
        </>
      }
    >
      <label className="pv-modal-label" htmlFor="pv-agent-name">
        {t("ai.agent.add.name")}
      </label>
      <TextInput id="pv-agent-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} data-testid="ai-agent-add-name" />
      <p className="pv-modal-hint">{t("ai.agent.add.nameHint")}</p>
      <label className="pv-modal-label" htmlFor="pv-agent-program">
        {t("ai.agent.add.program")}
      </label>
      <TextInput id="pv-agent-program" value={program} purpose="code" autoComplete="off" onChange={(event) => setProgram(event.target.value)} data-testid="ai-agent-add-program" />
      <p className="pv-modal-hint">{t("ai.agent.add.programHint")}</p>
      <label className="pv-modal-label" htmlFor="pv-agent-args">
        {t("ai.agent.add.args")}
      </label>
      <TextArea id="pv-agent-args" rows={3} value={args} purpose="code" onChange={(event) => setArgs(event.target.value)} data-testid="ai-agent-add-args" />
      <p className="pv-modal-hint">{t("ai.agent.add.argsHint")}</p>
      {problem && (
        <Banner kind="error" rounded>
          {t("ai.agent.add.failed")}
        </Banner>
      )}
      <p className="pv-modal-hint">{t("ai.agent.add.confirmNote")}</p>
    </Modal>
  );
}
