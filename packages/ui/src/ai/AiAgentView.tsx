import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Bot, Check, Circle, CircleAlert, Copy, FileText, Info, LoaderCircle, Plus, Send, Square, SquareTerminal } from "lucide-react";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { TextArea } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { Select } from "../components/ui/Select";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { toast } from "../services/toastStore";
import type { AcpThreadItem, AiAcpSession, AiAcpState } from "./acpSession";
import { agentAuthProblemText, agentEventText, agentEventTone, agentKindText, agentNoteName, agentOptionsInOrder, agentOptionText, agentProblemText, agentSessionLine } from "./agentView";
import { AiAnswer } from "./AiAnswer";
import { AiDraftCard, useDraftActions } from "./AiWriteCards";
import { useAiSession, useAiState } from "./useAiSession";

/**
 * An external agent's place in the AI tab (plan KI-Harness P4.6): where one
 * is started, and its session.
 *
 * Two things on this surface are not decoration. Before a start it says what
 * Plainva does NOT control — an agent reads files itself and sends what it
 * chooses, and the vault's privacy rules do not reach it — and the same
 * stands at the head of the session for as long as it runs. And everything
 * the agent says is shown as the agent's: its text is drawn like any
 * untrusted answer (no markup of its own, an address opens only after the
 * app asked), its titles and the names of its options are its own words under
 * a heading of Plainva's.
 */

export interface AiAgentViewProps {
  /** The note open in the shell, offered as something to name to the agent. */
  activeNote: { path: string; title: string } | null;
  /** Opens the note a link in the agent's text points to. */
  onOpenNote(target: string): void;
  /** Opens a file of the vault by its path: a note the user just created from what the agent wrote. */
  onOpenPath(path: string): void;
  /** Opens a web address from the agent's text — through the shell's question, as one a model composed. */
  onOpenUrl(url: string, composed?: boolean): void;
  onOpenSettings(): void;
}

type Line = Extract<AcpThreadItem, { kind: "tool" | "event" }>;

function lineIcon(look: "running" | "done" | "notice" | "failed" | "waiting"): ReactNode {
  if (look === "running") return <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />;
  if (look === "failed") return <CircleAlert size={ICON.meta} aria-hidden="true" />;
  if (look === "notice") return <Info size={ICON.meta} aria-hidden="true" />;
  if (look === "waiting") return <Circle size={ICON.meta} aria-hidden="true" />;
  return <Check size={ICON.meta} aria-hidden="true" />;
}

function AgentStart({ agents, onOpenSettings, toolsOn }: { agents: AiAcpState; onOpenSettings(): void; toolsOn: boolean }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const [chosen, setChosen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const agent = agents.agents.find((entry) => entry.id === chosen) ?? agents.agents[0] ?? null;

  if (!agents.vault) return <EmptyState icon={<Bot size={ICON.empty} />}>{t("ai.agent.noVault")}</EmptyState>;
  if (agents.encrypted) return <EmptyState icon={<Bot size={ICON.empty} />}>{t("ai.agent.sealed")}</EmptyState>;
  if (!agent) {
    return (
      <EmptyState
        icon={<Bot size={ICON.empty} />}
        action={
          <Button variant="secondary" onClick={onOpenSettings} data-testid="ai-agent-setup">
            {t("ai.agent.noneAction")}
          </Button>
        }
      >
        {t("ai.agent.none")}
      </EmptyState>
    );
  }
  const start = () => {
    if (!session || starting) return;
    setStarting(true);
    void session.agents.start(agent.id).finally(() => setStarting(false));
  };
  return (
    <div className="pv-agent-start" data-testid="ai-agent-start">
      {agents.agents.length > 1 && (
        <Select ariaLabel={t("ai.agent.choose")} value={agent.id} onChange={setChosen} options={agents.agents.map((entry) => ({ value: entry.id, label: entry.label }))} minWidth={220} />
      )}
      <h3 className="pv-agent-heading">{t("ai.agent.start.title", { agent: agent.label })}</h3>
      {/* What Plainva does not control, said before anything starts (the plan's gate) — and what it does. */}
      <ul className="pv-agent-facts" data-testid="ai-agent-facts">
        <li>{t("ai.agent.start.fact.program", { agent: agent.label })}</li>
        <li>{t("ai.agent.start.fact.reads")}</li>
        <li>{t("ai.agent.start.fact.direct")}</li>
        <li>{t("ai.agent.start.fact.tools")}</li>
        <li>{t("ai.agent.start.fact.signIn")}</li>
      </ul>
      <p className="pv-ext-note" data-testid="ai-agent-tools">
        {toolsOn ? t("ai.agent.start.toolsOn") : t("ai.agent.start.toolsOff")}
      </p>
      <div className="pv-ai-rowactions">
        <Button variant="primary" disabled={starting} onClick={start} data-testid="ai-agent-start-action">
          {t("ai.agent.start.action")}
        </Button>
      </div>
      {agents.sessions.length > 0 && (
        <>
          <h3 className="pv-agent-heading">{t("ai.agent.sessions")}</h3>
          <ul className="pv-mcp-audit" data-testid="ai-agent-sessions">
            {agents.sessions.slice(0, 5).map((entry, index) => (
              <li key={`${entry.at}-${index}`}>{agentSessionLine(t, entry, i18n.language)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AgentSignIn({ current }: { current: AiAcpSession }) {
  const { t } = useTranslation();
  const session = useAiSession();
  if (!session) return null;
  const waiting = current.phase === "signing-in";
  const problem = current.authProblem ? agentAuthProblemText(t, current.authProblem) : null;
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("ai.mcp.copied")),
      () => undefined,
    );
  };
  return (
    <section className="pv-ai-overview pv-ai-overview--asking" aria-label={t("ai.agent.auth.title", { agent: current.label })} data-testid="ai-agent-auth">
      <h4 className="pv-ai-overview-head">
        <SquareTerminal size={ICON.ui} aria-hidden="true" />
        <span>{t("ai.agent.auth.title", { agent: current.label })}</span>
      </h4>
      <span className="pv-ai-overview-hint">{t("ai.agent.auth.body")}</span>
      {waiting ? (
        <p className="pv-ai-working" data-testid="ai-agent-auth-waiting">
          <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
          {t("ai.agent.auth.waiting")}
        </p>
      ) : (
        <>
          {problem && (
            <span className="pv-ai-overview-hint" role="alert" data-testid="ai-agent-auth-problem">
              {problem}
            </span>
          )}
          {current.manualSignIn && (
            <>
              <span className="pv-ai-overview-hint">{t("ai.agent.auth.manual")}</span>
              <pre className="pv-ai-code" data-testid="ai-agent-auth-command">
                <code>{current.manualSignIn}</code>
              </pre>
            </>
          )}
        </>
      )}
      <div className="pv-ai-overview-actions">
        {waiting ? (
          <Button variant="ghost" onClick={() => session.agents.cancelSignIn()} data-testid="ai-agent-auth-cancel">
            {t("common.cancel")}
          </Button>
        ) : (
          <>
            {current.manualSignIn && (
              <Button variant="ghost" icon={<Copy size={ICON.ui} />} onClick={() => copy(current.manualSignIn!)}>
                {t("ai.mcp.copy")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void session.agents.retry()} data-testid="ai-agent-auth-retry">
              {t("ai.agent.auth.retry")}
            </Button>
            {/* The names are the agent's own for its ways to sign in; where one opens a terminal, Plainva's icon says so. */}
            {current.authMethods.map((method) => (
              <Button
                key={method.id}
                variant="secondary"
                icon={method.kind === "terminal" ? <SquareTerminal size={ICON.ui} /> : undefined}
                onClick={() => void session.agents.signIn(method.id)}
                data-testid="ai-agent-auth-method"
              >
                {method.name}
              </Button>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function AgentQuestion({ current }: { current: AiAcpSession }) {
  const { t } = useTranslation();
  const session = useAiSession();
  const question = current.question;
  if (!session || !question) return null;
  const title = t("ai.agent.question.title", { agent: current.label });
  return (
    <section className="pv-ai-overview pv-ai-overview--asking" aria-label={title} data-testid="ai-agent-question">
      <h4 className="pv-ai-overview-head">
        <Bot size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <dl className="pv-ai-overview-list">
        <dt>{agentKindText(t, question.toolKind)}</dt>
        <dd data-testid="ai-agent-question-title">{question.title || "—"}</dd>
        {question.files.length > 0 && (
          <>
            <dt>{t("ai.agent.question.files")}</dt>
            <dd>{question.files.join(", ")}</dd>
          </>
        )}
      </dl>
      <span className="pv-ai-overview-hint">{t("ai.agent.question.hint")}</span>
      <div className="pv-ai-overview-actions">
        {agentOptionsInOrder(question.options).map((option) => (
          <Button key={option.id} variant={option.kind.startsWith("reject") ? "ghost" : option.kind === "allow_once" ? "primary" : "secondary"} onClick={() => session.agents.answer(option.id)} data-testid={`ai-agent-option-${option.kind}`}>
            {agentOptionText(t, option)}
          </Button>
        ))}
      </div>
    </section>
  );
}

/**
 * The notes the agent wrote in this session that do not exist yet (plan
 * P5-6): each is a draft like every other — the same card, the same two
 * buttons, the same list of everything that waits —, so it is still there
 * when the session is not.
 */
function AgentDrafts({ current, onOpenPath }: { current: AiAcpSession; onOpenPath(path: string): void }) {
  const session = useAiSession();
  const state = useAiState();
  const actions = useDraftActions(session, onOpenPath);
  const drafts = state ? state.drafts.drafts.filter((draft) => current.waiting.includes(draft.id)) : [];
  // The cards stand in the thread like the agent's question does: no frame of their own around them.
  return (
    <>
      {drafts.map((draft) => (
        <AiDraftCard key={draft.id} draft={draft} canCreate={actions.canCreate} busy={actions.busy} onCreate={actions.create} onDiscard={actions.discard} />
      ))}
    </>
  );
}

function AgentThread({ current, onOpenNote, onOpenUrl }: { current: AiAcpSession; onOpenNote(target: string): void; onOpenUrl(url: string, composed?: boolean): void }) {
  const { t } = useTranslation();
  const lintNote = t("ai.lint.defused");
  const out: ReactNode[] = [];
  let lines: Line[] = [];
  const flush = () => {
    if (lines.length === 0) return;
    const group = lines;
    lines = [];
    out.push(
      <ul key={`lines-${group[0]!.id}`} className="pv-ai-steps">
        {group.map((line) => {
          if (line.kind === "event") {
            const tone = agentEventTone(line.event);
            return (
              <li key={line.id} className={cx("pv-ai-step", tone === "failed" && "pv-ai-step--failed", tone === "notice" && "pv-ai-step--open")} data-testid={`ai-agent-event-${line.event.type}`}>
                {lineIcon(tone)}
                <span>{agentEventText(t, line.event, lintNote)}</span>
              </li>
            );
          }
          const look = line.status === "failed" ? "failed" : line.status === "completed" ? "done" : "running";
          // An agent's own words for a step usually name its file already: a name is not said twice.
          const files = line.files
            .slice(0, 3)
            .map(agentNoteName)
            .filter((name) => !line.title.includes(name))
            .join(", ");
          return (
            <li key={line.id} className={cx("pv-ai-step", look === "failed" && "pv-ai-step--failed", look === "running" && "pv-ai-step--open")} data-testid="ai-agent-tool">
              {lineIcon(look)}
              <span>
                {line.title || agentKindText(t, line.toolKind)}
                {files ? ` · ${files}` : ""}
                {line.outside > 0 ? ` · ${t("ai.agent.toolOutside", { count: line.outside })}` : ""}
              </span>
            </li>
          );
        })}
      </ul>,
    );
  };
  for (const item of current.thread) {
    if (item.kind === "tool" || item.kind === "event") {
      lines.push(item);
      continue;
    }
    flush();
    if (item.kind === "user") {
      out.push(
        <div key={item.id} className="pv-ai-msg pv-ai-msg--user">
          {item.note && (
            <div className="pv-ai-ctxline">
              <FileText size={ICON.meta} aria-hidden="true" />
              <span>{agentNoteName(item.note)}</span>
            </div>
          )}
          <div className="pv-ai-usertext">{item.text}</div>
        </div>,
      );
    } else if (item.kind === "agent") {
      out.push(
        <div key={item.id} className="pv-ai-msg pv-ai-msg--ai" data-testid="ai-agent-text">
          {/* An agent's text is a stranger's: drawn like any untrusted answer, and an address in it is one a model composed. */}
          <AiAnswer text={item.text} onOpenNote={onOpenNote} onOpenUrl={(url) => onOpenUrl(url, true)} />
        </div>,
      );
    } else {
      out.push(
        <ul key={item.id} className="pv-ai-steps" aria-label={t("ai.agent.plan")} data-testid="ai-agent-plan">
          {item.entries.map((entry, index) => (
            <li key={index} className={cx("pv-ai-step", entry.status !== "completed" && "pv-ai-step--open")}>
              {lineIcon(entry.status === "completed" ? "done" : entry.status === "in_progress" ? "running" : "waiting")}
              <span>{entry.content}</span>
            </li>
          ))}
        </ul>,
      );
    }
  }
  flush();
  return <Fragment>{out}</Fragment>;
}

function AgentSession({ current, activeNote, onOpenNote, onOpenPath, onOpenUrl }: { current: AiAcpSession } & Pick<AiAgentViewProps, "activeNote" | "onOpenNote" | "onOpenPath" | "onOpenUrl">) {
  const { t } = useTranslation();
  const session = useAiSession();
  const [draft, setDraft] = useState("");
  const [withNote, setWithNote] = useState(true);
  const [log, setLog] = useState<string | null>(null);
  const threadEl = useRef<HTMLDivElement | null>(null);
  const shown = current.thread.length;
  const lastText = current.thread[shown - 1];
  const lastLength = lastText && lastText.kind === "agent" ? lastText.text.length : 0;
  // The thread follows what arrives, as a conversation does.
  useEffect(() => {
    const el = threadEl.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [shown, lastLength, current.phase, current.question, current.waiting.length]);
  if (!session) return null;
  const agents = session.agents;
  const running = current.phase === "running";
  const ended = current.phase === "ended";
  const canSend = current.phase === "ready" && draft.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    void agents.send(text, { note: withNote && activeNote !== null });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className="pv-ai" data-testid="ai-agent-session" data-phase={current.phase}>
      {/* For as long as the session is there: who this is, and that the vault's rules do not reach it. */}
      <p className="pv-ai-marking" data-testid="ai-agent-marking">
        {t("ai.agent.marking", { agent: current.label })}
        <span className="pv-ai-marking-web">{current.tools === "offered" ? t("ai.agent.markingTools.offered") : t("ai.agent.markingTools.off")}</span>
      </p>
      <div className="pv-ai-thread" ref={threadEl}>
        {current.thread.length === 0 && current.phase === "ready" && <EmptyState icon={<Bot size={ICON.empty} />}>{t("ai.agent.empty", { agent: current.label })}</EmptyState>}
        <AgentThread current={current} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
        {current.phase === "starting" && (
          <p className="pv-ai-working" data-testid="ai-agent-starting">
            <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
            {t("ai.agent.starting", { agent: current.label })}
          </p>
        )}
        {running && !current.question && (
          <p className="pv-ai-working" aria-live="polite">
            <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
            {t("ai.agent.working", { agent: current.label })}
          </p>
        )}
        {(current.phase === "auth" || current.phase === "signing-in") && <AgentSignIn current={current} />}
        <AgentQuestion current={current} />
        <AgentDrafts current={current} onOpenPath={onOpenPath} />
        {ended && (
          <Banner
            kind={current.problem ? "warning" : "info"}
            rounded
            actions={
              <>
                {current.problem && log === null && (
                  <Button size="sm" variant="ghost" onClick={() => void agents.log().then(setLog)} data-testid="ai-agent-log-show">
                    {t("ai.agent.logShow")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => agents.dismiss()} data-testid="ai-agent-dismiss">
                  {t("common.close")}
                </Button>
              </>
            }
          >
            <span data-testid="ai-agent-ended">{current.problem ? agentProblemText(t, current.problem) : t("ai.agent.ended.closed")}</span>
          </Banner>
        )}
        {ended && log !== null && (
          <pre className="pv-ai-code" aria-label={t("ai.agent.log")} data-testid="ai-agent-log">
            <code>{log || t("ai.agent.logEmpty")}</code>
          </pre>
        )}
      </div>
      {!ended && (
        <div className="pv-ai-composer">
          <div className="pv-ai-chips" aria-label={t("ai.context")}>
            {activeNote && withNote && (
              <Chip size="sm" icon={<FileText size={ICON.meta} />} onRemove={() => setWithNote(false)} removeLabel={t("ai.removeContext")}>
                {activeNote.title}
              </Chip>
            )}
            {activeNote && !withNote && (
              <Chip size="sm" tone="muted" icon={<Plus size={ICON.meta} />} onClick={() => setWithNote(true)}>
                {activeNote.title}
              </Chip>
            )}
          </div>
          <div className="pv-ai-inputrow">
            <TextArea
              className="pv-ai-input"
              rows={1}
              value={draft}
              placeholder={t("ai.agent.placeholder", { agent: current.label })}
              aria-label={t("ai.agent.placeholder", { agent: current.label })}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={current.phase !== "ready" && !running}
              data-testid="ai-agent-input"
            />
            {running ? (
              <IconButton label={t("ai.stop")} onClick={() => agents.stop()} data-testid="ai-agent-stop">
                <Square size={ICON.ui} />
              </IconButton>
            ) : (
              <IconButton label={t("ai.send")} active={canSend} disabled={!canSend} onClick={send} data-testid="ai-agent-send">
                <Send size={ICON.ui} />
              </IconButton>
            )}
          </div>
          <div className="pv-ai-foot">
            <Button size="sm" variant="ghost" icon={<Ban size={ICON.meta} />} onClick={() => void agents.end()} data-testid="ai-agent-end">
              {t("ai.agent.end")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AiAgentView({ activeNote, onOpenNote, onOpenPath, onOpenUrl, onOpenSettings }: AiAgentViewProps) {
  const session = useAiSession();
  const state = useAiState();
  useEffect(() => {
    // What is installed and what was added may have changed since the app looked last.
    void session?.agents.refresh();
  }, [session]);
  if (!session || !state || !state.agents.available) return null;
  const current = state.agents.session;
  if (current) return <AgentSession current={current} activeNote={activeNote} onOpenNote={onOpenNote} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />;
  return <AgentStart agents={state.agents} onOpenSettings={onOpenSettings} toolsOn={state.settings.mcpEnabled === true} />;
}
