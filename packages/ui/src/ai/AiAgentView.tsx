import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Bot, Check, Circle, CircleAlert, Copy, FileText, Info, LoaderCircle, Plus, Send, SlidersHorizontal, Square, SquareTerminal } from "lucide-react";
import type { AcpCommand, AcpConfigOption, AcpConfigValue } from "@plainva/core";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { TextArea } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { MenuItem, MenuLabel, MenuSeparator, MenuSurface } from "../components/ui/Menu";
import { Select } from "../components/ui/Select";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { toast } from "../services/toastStore";
import type { AcpThreadItem, AiAcpSession, AiAcpState } from "./acpSession";
import {
  agentAuthProblemText,
  agentCommandsKey,
  agentEventParts,
  agentEventTone,
  agentKindText,
  agentMenuKey,
  agentNoteName,
  agentOptionsInOrder,
  agentOptionsKey,
  agentOptionText,
  agentProblemParts,
  agentSessionLine,
  agentSpelledMessage,
  agentToolParts,
  saidSentence,
  sentence,
  sentenceString,
  sentenceText,
  type SentencePart,
} from "./agentView";
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
      <h3 className="pv-agent-heading">{sentenceString(t, "ai.agent.start.title", { agent: agent.label })}</h3>
      {/* What Plainva does not control, said before anything starts (the plan's gate) — and what it does. */}
      <ul className="pv-agent-facts" data-testid="ai-agent-facts">
        <li>{sentenceString(t, "ai.agent.start.fact.program", { agent: agent.label })}</li>
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
    <section className="pv-ai-overview pv-ai-overview--asking" aria-label={sentenceString(t, "ai.agent.auth.title", { agent: current.label })} data-testid="ai-agent-auth">
      <h4 className="pv-ai-overview-head">
        <SquareTerminal size={ICON.ui} aria-hidden="true" />
        <span>{sentenceString(t, "ai.agent.auth.title", { agent: current.label })}</span>
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
                <code>
                  {current.manualSignIn.map((part, index) => (
                    <Fragment key={index}>
                      {index > 0 ? " " : ""}
                      <bdi>{part}</bdi>
                    </Fragment>
                  ))}
                </code>
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
              <Button variant="ghost" icon={<Copy size={ICON.ui} />} onClick={() => copy(current.manualSignIn!.join(" "))}>
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
  const title = sentenceString(t, "ai.agent.question.title", { agent: current.label });
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
            <dd data-testid="ai-agent-question-files">
              {question.files.map((file, index) => (
                <Fragment key={file}>
                  {index > 0 ? ", " : ""}
                  <bdi>{file}</bdi>
                </Fragment>
              ))}
            </dd>
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
                <span>
                  <Said parts={agentEventParts(t, line.event, lintNote)} />
                </span>
              </li>
            );
          }
          const look = line.status === "failed" ? "failed" : line.status === "completed" ? "done" : "running";
          return (
            <li key={line.id} className={cx("pv-ai-step", look === "failed" && "pv-ai-step--failed", look === "running" && "pv-ai-step--open")} data-testid="ai-agent-tool">
              {lineIcon(look)}
              <span>
                <Said parts={agentToolParts(t, line)} />
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

/**
 * A sentence of Plainva's with a stranger's words in it (plan P9-7): the words drawn apart, in quiet italics and
 * isolated in their direction, so that none of them ends a sentence of Plainva's or turns it around.
 */
function Said({ parts }: { parts: readonly SentencePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : "said" in part ? (
          <bdi key={index} className="pv-said">
            {part.said}
          </bdi>
        ) : (
          // A name of the vault's or the user's: in its own direction, in Plainva's type.
          <bdi key={index}>{part.name}</bdi>
        ),
      )}
    </>
  );
}

/**
 * One of the agent's choices for its session (plan KI-Harness P9-7): a
 * button with the setting's name and what it stands at, and a menu of the
 * agent's values — its own words, in its order, under its own groups, below
 * Plainva's own heading that says whose they are. Picking one asks the agent;
 * what it answers is what the button shows. While a change waits for the
 * agent's answer the button takes no press but keeps the keyboard, and the
 * values take no pick.
 */
function AgentPicker({
  name,
  current,
  values,
  disabled,
  waiting,
  tip,
  description,
  agent,
  menuLabel,
  onPick,
  testId,
}: {
  /** The setting's name: the agent's (`{ said }`), or Plainva's own word for a mode in the older form. */
  name: SentencePart;
  current: string;
  values: readonly AcpConfigValue[];
  disabled: boolean;
  waiting: boolean;
  tip: string;
  description: string;
  agent: string;
  menuLabel: readonly SentencePart[];
  onPick(value: string): void;
  testId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const shown = values.find((value) => value.value === current)?.name ?? current;
  const words = sentence(t, "ai.agent.config.value", { setting: name, value: { said: shown } });
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        variant="ghost"
        onClick={() => {
          if (!waiting) setOpen((was) => !was);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={waiting || undefined}
        // Its name begins with what it shows and says whose setting it is; what a setting does not change is its description.
        aria-label={sentenceText(sentence(t, "ai.agent.config.owned", { label: sentenceText(words), agent }))}
        aria-description={description}
        disabled={disabled}
        data-tip={tip}
        data-testid={testId}
      >
        <span className="pv-agent-setting-text">
          <Said parts={words} />
        </span>
      </Button>
      <MenuSurface
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        ariaLabel={sentenceText(menuLabel)}
        className="pv-menu--described"
        // Placed again when the agent's values or the setting's name change while the menu is open.
        remeasure={agentMenuKey(menuLabel, values)}
      >
        <MenuLabel>
          <Said parts={menuLabel} />
        </MenuLabel>
        {values.map((value, index) => {
          // A group's name stands once, above its first value.
          const heading = value.group && value.group !== values[index - 1]?.group ? value.group : undefined;
          return (
            <Fragment key={value.value}>
              {heading ? <MenuLabel kind="said">{heading}</MenuLabel> : null}
              <MenuItem
                role="menuitemradio"
                checked={value.value === current}
                aria-disabled={waiting || undefined}
                textDir="auto"
                hint={value.description || undefined}
                data-tip={value.description || undefined}
                onSelect={() => onPick(value.value)}
              >
                {value.name}
              </MenuItem>
            </Fragment>
          );
        })}
      </MenuSurface>
    </>
  );
}

/**
 * The rest of the agent's settings (plan P9-7), behind one button: a choice
 * as a group of its values under its name, a switch as an entry that is ticked
 * or not — below Plainva's own heading. While a change waits for the agent's
 * answer, nothing in it takes a pick.
 */
function AgentMoreSettings({ options, disabled, waiting, label, description, onPick }: { options: readonly AcpConfigOption[]; disabled: boolean; waiting: boolean; label: string; description: string; onPick(id: string, value: string | boolean): void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <IconButton
        ref={anchor}
        size="sm"
        label={label}
        onClick={() => {
          if (!waiting) setOpen((was) => !was);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={waiting || undefined}
        aria-description={description}
        disabled={disabled}
        data-testid="ai-agent-settings-more"
      >
        <SlidersHorizontal size={ICON.meta} />
      </IconButton>
      <MenuSurface
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        ariaLabel={label}
        className="pv-menu--described"
        // Placed again when the agent's settings change while the menu is open — a switch keeps it open.
        remeasure={agentOptionsKey(options)}
      >
        <MenuLabel>{label}</MenuLabel>
        {options.map((option) => (
          <Fragment key={option.id}>
            <MenuSeparator />
            {option.type === "boolean" ? (
              <MenuItem
                role="menuitemcheckbox"
                checked={option.current}
                aria-disabled={waiting || undefined}
                textDir="auto"
                hint={option.description || undefined}
                data-tip={option.description || undefined}
                keepOpen
                onSelect={() => onPick(option.id, !option.current)}
              >
                {option.name}
              </MenuItem>
            ) : (
              <div role="group" aria-label={option.name}>
                <MenuLabel kind="said">{option.name}</MenuLabel>
                {option.values.map((value, index) => {
                  const heading = value.group && value.group !== option.values[index - 1]?.group ? value.group : undefined;
                  return (
                    <Fragment key={value.value}>
                      {heading ? <MenuLabel kind="said">{heading}</MenuLabel> : null}
                      <MenuItem
                        role="menuitemradio"
                        checked={value.value === option.current}
                        aria-disabled={waiting || undefined}
                        textDir="auto"
                        hint={value.description || undefined}
                        data-tip={value.description || undefined}
                        onSelect={() => onPick(option.id, value.value)}
                      >
                        {value.name}
                      </MenuItem>
                    </Fragment>
                  );
                })}
              </div>
            )}
          </Fragment>
        ))}
      </MenuSurface>
    </>
  );
}

/**
 * What the user may set for the agent's session (plan P9-7): its mode and its
 * model where it offers them, the rest behind "More settings". They change
 * how the agent works — what Plainva lets through at its side it decides at
 * every request, and the buttons say whose settings these are.
 */
function AgentSettings({ current }: { current: AiAcpSession }) {
  const { t } = useTranslation();
  const session = useAiSession();
  if (!session) return null;
  const agents = session.agents;
  const disabled = current.phase !== "ready" && current.phase !== "running";
  const waiting = current.changing !== null;
  const tip = sentenceString(t, "ai.agent.config.tip", { agent: current.label });
  // Read after the button's name, which says already whose setting it is.
  const description = sentenceString(t, "ai.agent.config.described", { agent: current.label });
  const menuLabel = (setting: SentencePart) => sentence(t, "ai.agent.config.menu", { setting, agent: current.label });
  const mode = current.config.find((option): option is Extract<AcpConfigOption, { type: "select" }> => option.category === "mode" && option.type === "select");
  const model = current.config.find((option): option is Extract<AcpConfigOption, { type: "select" }> => option.category === "model" && option.type === "select");
  const rest = current.config.filter((option) => option !== mode && option !== model);
  const modes = current.config.length === 0 ? current.modes : null;
  if (!mode && !model && rest.length === 0 && !modes) return null;
  const shared = { disabled, waiting, tip, description, agent: current.label };
  return (
    <div className="pv-agent-settings" data-testid="ai-agent-settings">
      {mode && <AgentPicker {...shared} name={{ said: mode.name }} current={mode.current} values={mode.values} menuLabel={menuLabel({ said: mode.name })} onPick={(value) => void agents.setConfig(mode.id, value)} testId="ai-agent-setting-mode" />}
      {modes && (
        <AgentPicker
          {...shared}
          name={t("ai.agent.config.mode")}
          current={modes.current}
          values={modes.available.map((entry) => ({ value: entry.id, name: entry.name, description: entry.description }))}
          menuLabel={menuLabel(t("ai.agent.config.mode"))}
          onPick={(value) => void agents.setMode(value)}
          testId="ai-agent-setting-mode"
        />
      )}
      {model && <AgentPicker {...shared} name={{ said: model.name }} current={model.current} values={model.values} menuLabel={menuLabel({ said: model.name })} onPick={(value) => void agents.setConfig(model.id, value)} testId="ai-agent-setting-model" />}
      {rest.length > 0 && (
        <AgentMoreSettings
          options={rest}
          disabled={disabled}
          waiting={waiting}
          description={sentenceString(t, "ai.agent.config.describedMore", { agent: current.label })}
          label={sentenceString(t, "ai.agent.config.more", { agent: current.label })}
          onPick={(id, value) => void agents.setConfig(id, value)}
        />
      )}
      {/* While a change waits for the agent, a spinner turns at the row's end, and a reader hears it in words — the
          row keeps its length and does not wrap for a change that is answered at once. */}
      <span role="status" className="pv-agent-settings-status">
        {waiting && (
          <>
            <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
            <span className="pv-sr-only">{sentenceString(t, "ai.agent.config.changing", { agent: current.label })}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** The commands of the agent a message that begins with "/" can be (plan P9-7): while the name is being typed. */
function commandsFor(draft: string, commands: readonly AcpCommand[]): AcpCommand[] {
  const typed = /^\/([^\s]*)$/.exec(draft);
  if (!typed) return [];
  const prefix = typed[1]!.normalize("NFC").toLowerCase();
  return commands.filter((command) => command.name.normalize("NFC").toLowerCase().startsWith(prefix));
}

/** How many of the commands that fit stand in the list; the rest is counted below it. */
const COMMANDS_SHOWN = 12;

/** The command a draft has just taken — "/name " and nothing after it yet. */
function commandTaken(draft: string, commands: readonly AcpCommand[]): AcpCommand | null {
  const taken = /^\/([^\s]+) $/.exec(draft);
  return taken ? (commands.find((command) => command.name.normalize("NFC") === taken[1]!.normalize("NFC")) ?? null) : null;
}

function AgentSession({ current, activeNote, onOpenNote, onOpenPath, onOpenUrl }: { current: AiAcpSession } & Pick<AiAgentViewProps, "activeNote" | "onOpenNote" | "onOpenPath" | "onOpenUrl">) {
  const { t } = useTranslation();
  const session = useAiSession();
  const [draft, setDraft] = useState("");
  const [withNote, setWithNote] = useState(true);
  const [log, setLog] = useState<string | null>(null);
  const threadEl = useRef<HTMLDivElement | null>(null);
  const inputEl = useRef<HTMLTextAreaElement | null>(null);
  // The agent's commands while "/name" is typed (plan P9-7): which row the arrow keys are on, and a list the user closed.
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const hintId = useId();
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
    // A command typed in another spelling of its name goes as the agent spells it.
    const text = agentSpelledMessage(draft, current.commands);
    setDraft("");
    void agents.send(text, { note: withNote && activeNote !== null });
  };
  const found = commandsFor(draft, current.commands);
  const matches = found.slice(0, COMMANDS_SHOWN);
  const more = found.length - matches.length;
  const listing = matches.length > 0 && dismissed !== draft;
  // What the agent says goes after a command it offers — its words, said as its own — until the user types on.
  const taken = commandTaken(draft, current.commands);
  const takenHint = taken?.hint ? saidSentence(t, "ai.agent.commands.hint", { command: taken.name, hint: taken.hint }, { agent: current.label }) : null;
  // A command is a message that begins with its name: picking one writes "/name " and leaves the rest to the user.
  const pick = (command: AcpCommand) => {
    setDraft(`/${command.name} `);
    setPicked(0);
    setDismissed(null);
    inputEl.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter held down acts once: its repeats would send what a pick has just written.
    if (event.key === "Enter" && !event.shiftKey && event.repeat) {
      event.preventDefault();
      return;
    }
    // While an input method composes, its keys are its own (WebKit marks them with key code 229).
    if (listing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : matches.length - 1;
        setPicked((index) => (Math.min(index, matches.length - 1) + step) % matches.length);
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey || event.altKey)) {
        // With the list open, an Enter with a modifier neither takes a command nor sends what is half typed.
        event.preventDefault();
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // With a command on screen, Enter takes it: the message is not sent half typed.
        event.preventDefault();
        pick(matches[Math.min(picked, matches.length - 1)]!);
        return;
      }
      if (event.key === "Escape") {
        // The list closes; the session around it stays.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(draft);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className="pv-ai" data-testid="ai-agent-session" data-phase={current.phase}>
      {/* For as long as the session is there: who this is, and that the vault's rules do not reach it. */}
      <p className="pv-ai-marking" data-testid="ai-agent-marking">
        {sentenceString(t, "ai.agent.marking", { agent: current.label })}
        <span className="pv-ai-marking-web">{current.tools === "offered" ? t("ai.agent.markingTools.offered") : t("ai.agent.markingTools.off")}</span>
      </p>
      <div className="pv-ai-thread" ref={threadEl}>
        {current.thread.length === 0 && current.phase === "ready" && <EmptyState icon={<Bot size={ICON.empty} />}>{sentenceString(t, "ai.agent.empty", { agent: current.label })}</EmptyState>}
        <AgentThread current={current} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
        {current.phase === "starting" && (
          <p className="pv-ai-working" data-testid="ai-agent-starting">
            <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
            {sentenceString(t, "ai.agent.starting", { agent: current.label })}
          </p>
        )}
        {running && !current.question && (
          <p className="pv-ai-working" aria-live="polite">
            <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
            {sentenceString(t, "ai.agent.working", { agent: current.label })}
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
            <span data-testid="ai-agent-ended">{current.problem ? <Said parts={agentProblemParts(t, current.problem)} /> : t("ai.agent.ended.closed")}</span>
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
              ref={inputEl}
              className="pv-ai-input"
              rows={1}
              value={draft}
              placeholder={current.commands.length ? sentenceString(t, "ai.agent.placeholderCommands", { agent: current.label }) : sentenceString(t, "ai.agent.placeholder", { agent: current.label })}
              aria-label={sentenceString(t, "ai.agent.placeholder", { agent: current.label })}
              onChange={(event) => {
                setDraft(event.target.value);
                setPicked(0);
                // Typing again brings a dismissed list back.
                setDismissed(null);
              }}
              onKeyDown={onKeyDown}
              // The list belongs to the field: it goes when the field loses the focus (a pick keeps it there).
              onBlur={() => setDismissed(draft)}
              aria-describedby={takenHint ? hintId : undefined}
              disabled={current.phase !== "ready" && !running}
              data-testid="ai-agent-input"
            />
            {/* The agent's commands are its own words: the name it runs under, what it says it does. */}
            <MenuSurface
              // Placed again as the list narrows, grows or names other commands, so that it stays on the field.
              remeasure={agentCommandsKey(matches, more)}
              open={listing}
              onClose={() => setDismissed(draft)}
              anchorRef={inputEl}
              autoFocus={false}
              ariaLabel={sentenceString(t, "ai.agent.commands.label", { agent: current.label })}
              className="pv-menu--described"
            >
              <MenuLabel>{sentenceString(t, "ai.agent.commands.label", { agent: current.label })}</MenuLabel>
              {matches.map((command, index) => {
                const said = [command.description, command.hint].filter(Boolean).join(" · ") || undefined;
                return (
                  <MenuItem
                    key={command.name}
                    active={index === Math.min(picked, matches.length - 1)}
                    hint={said}
                    data-tip={said}
                    textDir="auto"
                    onSelect={() => pick(command)}
                    data-testid="ai-agent-command"
                  >
                    /{command.name}
                  </MenuItem>
                );
              })}
              {more > 0 && <MenuLabel kind="note">{t("ai.agent.commands.more", { count: more })}</MenuLabel>}
            </MenuSurface>
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
          {takenHint && (
            <p className="pv-agent-command-hint" id={hintId} data-testid="ai-agent-command-hint">
              <Said parts={takenHint} />
            </p>
          )}
          <div className="pv-ai-foot">
            <AgentSettings current={current} />
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
  const { t } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  useEffect(() => {
    // What is installed and what was added may have changed since the app looked last.
    void session?.agents.refresh();
  }, [session]);
  if (!session || !state || !state.agents.available) return null;
  const current = state.agents.session;
  if (current) return <AgentSession current={current} activeNote={activeNote} onOpenNote={onOpenNote} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />;
  // Fully local (plan KI-Harness P7, ADR 0030): no agent is started — it is another maker's program with a way out
  // of its own. The agents of this device stay registered; a session that ran ended with the switch.
  if (state.settings.localOnly) {
    return (
      <EmptyState
        icon={<Bot size={ICON.empty} />}
        title={t("ai.agent.title")}
        action={
          <Button variant="secondary" onClick={onOpenSettings} data-testid="ai-agent-rests-setup">
            {t("ai.error.openSetup")}
          </Button>
        }
      >
        <span data-testid="ai-agent-rests">{`${t("ai.mode.restsHere")} ${t("ai.mode.rests.agents")}`}</span>
      </EmptyState>
    );
  }
  return <AgentStart agents={state.agents} onOpenSettings={onOpenSettings} toolsOn={state.settings.mcpEnabled === true} />;
}
