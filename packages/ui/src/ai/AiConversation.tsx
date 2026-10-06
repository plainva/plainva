import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Check, CircleAlert, Eye, FileText, Globe, Languages, ListTodo, LoaderCircle, MessageCircleQuestion, PenLine, Pin, Plus, Scissors, Send, Sparkles, Square } from "lucide-react";
import { addressOrigin, AI_PROFILE_IDS, answerCoverage, checkWebUrl, comparableAddress, hasWebTools, knownAddresses, providerById, type AnswerCoverage, type ModelFailure, type RunMeta, type RunStop } from "@plainva/core";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { TextArea } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { MenuItem, MenuSurface } from "../components/ui/Menu";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { toast } from "../services/toastStore";
import { AiAnswer } from "./AiAnswer";
import { AiContextLens } from "./AiContextLens";
import { AiEffectApproval } from "./AiEffectApproval";
import { AI_TRANSLATE_LANGUAGES, askMessage, runSuggestAction, type AiSuggestAction, type SelectionReader } from "./aiSelectionActions";
import { startableSkills } from "./aiSkills";
import { AiSendOverview } from "./AiSendOverview";
import { aiFailureText } from "./aiSettingsModel";
import type { AiDress } from "./aiSession";
import { transcriptOf, type TranscriptItem } from "./transcript";
import { useAiSession, useAiState } from "./useAiSession";

/** From this width the AI tab shows "View context" as a column of its own. */
const TAB_SIDE_MIN_WIDTH = 760;

/**
 * The conversation itself — the one view the companion window, the AI tab,
 * the phone's sheet and its screen all show (plan §19.1). What it says is
 * derived from the session; where it sits is the dress's business.
 *
 * Marking (ADR 0023, Art. 50): every conversation opens with the quiet line
 * naming the model and the provider — in every dress, never a banner to
 * dismiss. Each run ends with one line saying what was sent where.
 */
export interface AiConversationProps {
  dress: AiDress;
  /** The note open in the shell, for the context chip. */
  activeNote: { path: string; title: string } | null;
  onOpenNote: (target: string) => void;
  /**
   * Opens a web address after the shell asked. `composed`: the model put the
   * address together itself — it stood in none of the user's messages, notes
   * or results (plan KI-Harness P4), and the question says so.
   */
  onOpenUrl: (url: string, composed?: boolean) => void;
  onOpenSettings: () => void;
  /** The shell's note picker; the chosen note is pinned to the conversation. */
  onPickNote?: () => void;
  /** The editor's selection: while there is one, the selection actions are offered (plan P1.5). */
  selection?: SelectionReader;
}

const STOP_KEYS: Partial<Record<RunStop["kind"], string>> = {
  cancelled: "ai.stopped.cancelled",
  limit: "ai.stopped.limit",
  loop: "ai.stopped.loop",
  circuit_breaker: "ai.stopped.circuit",
  max_tokens: "ai.stopped.maxTokens",
  refusal: "ai.stopped.refusal",
};

/** Failures the settings can fix: the notice offers the way there. */
const SETUP_FAILURES = new Set<ModelFailure["kind"]>(["no_key", "invalid_key", "not_found", "unknown_endpoint", "platform_unavailable"]);

export function AiConversation({ dress, activeNote, onOpenNote, onOpenUrl, onOpenSettings, onPickNote, selection }: AiConversationProps) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  /** The run whose send overview is open under its line. */
  const [openRun, setOpenRun] = useState<string | null>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const touch = dress === "sheet" || dress === "screen";
  /** "View context" over the thread (every dress but a wide tab, which keeps it as a column). */
  const [lensOpen, setLensOpen] = useState(false);
  // A callback ref: the root appears only once the session has loaded.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!rootEl || dress !== "tab" || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) >= TAB_SIDE_MIN_WIDTH));
    observer.observe(rootEl);
    return () => observer.disconnect();
  }, [rootEl, dress]);
  const side = dress === "tab" && wide;
  // A selection in the editor offers the selection actions (plan P1.5). Polled, cheaply: the reader copies only the selected text.
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!selection) return;
    const tick = () => setHasSelection(selection.has());
    tick();
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
  }, [selection]);
  const [translateOpen, setTranslateOpen] = useState(false);
  const translateAnchor = useRef<HTMLSpanElement>(null);

  const active = state?.active ?? null;
  const items = useMemo(() => (active ? transcriptOf(active) : []), [active]);
  // The addresses that stood in front of the model: a link to any other one, the model composed itself (plan P4).
  const known = useMemo(() => (active ? knownAddresses(active.conversation) : null), [active]);
  // A page a run already asked for went out with the user's leave: a link to that very address tells nothing new.
  const requested = useMemo(() => new Set((active?.runs ?? []).flatMap((run) => (run.web?.pages ?? []).map((page) => comparableAddress(page.url) ?? page.url))), [active]);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 4 }), [i18n.language]);

  // Follow the answer while it streams, the way a reader would scroll.
  const liveText = state?.live?.text ?? "";
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, liveText, state?.live?.tools.length, state?.consent, state?.effect]);

  // The send overview is answered here: a door outside the conversation relies on the session knowing one is on screen.
  useEffect(() => session?.mountSurface(), [session]);

  if (!session || !state || !state.loaded) return null;

  if (!state.settings.enabled) {
    return (
      <div className={cx("pv-ai", touch && "pv-ai--touch")}>
        <EmptyState icon={<Sparkles size={ICON.empty} />} title={t("ai.empty.offTitle")} action={<Button variant="tonal" onClick={onOpenSettings}>{t("ai.empty.offAction")}</Button>}>
          {t("ai.empty.offBody")}
        </EmptyState>
      </div>
    );
  }

  const choice = session.choice();
  const provider = choice ? providerById(choice.providerId, state.settings.custom) : undefined;
  if (!choice || !provider) {
    return (
      <div className={cx("pv-ai", touch && "pv-ai--touch")}>
        <EmptyState icon={<Sparkles size={ICON.empty} />} title={t("ai.empty.setupTitle")} action={<Button variant="tonal" onClick={onOpenSettings}>{t("ai.empty.setupAction")}</Button>}>
          {t("ai.empty.setupBody")}
        </EmptyState>
      </div>
    );
  }

  const live = state.live;
  const running = Boolean(live);
  // The call that waits for the user's answer has not started: its question stands for it, not a step that claims to run.
  const liveTools = (live?.tools ?? []).filter((tool) => tool.id !== state.effect?.id);
  const pins = state.active?.pins ?? state.draftPins;
  const showActive = Boolean(activeNote) && !pins.includes(activeNote!.path);

  const consent = state.consent;
  const effect = state.effect;
  // The internet (plan P4): what a new conversation could do on it, and whether the open one carries it.
  const webOffer = session.webOffer();
  const withWeb = active ? hasWebTools(active.conversation.tools) && state.web.enabled : state.draftWeb && Boolean(webOffer);
  const toggleWeb = () => {
    // Decided when a conversation starts: an open one may already carry notes that must never meet the internet.
    if (active) toast.info(t("ai.web.fixed"));
    else session.setDraftWeb(!state.draftWeb);
  };
  /** An address the model put together itself: it stood nowhere before the model wrote it. */
  const composed = (url: string) => (known ? addressOrigin(url, known) === "model" && !requested.has(comparableAddress(url) ?? "") : false);
  const urlNote = (url: string) => (composed(url) ? t("ai.linkBuilt") : null);
  const openAnswerUrl = (url: string) => onOpenUrl(url, composed(url));
  const hostOf = (url: string) => {
    const checked = checkWebUrl(url);
    return checked.ok ? checked.target.host : url;
  };
  /** A suggest action on the editor's selection: the answer lands in the note as a suggestion round. */
  const suggest = (action: AiSuggestAction, language?: string) => {
    const range = selection?.range();
    if (!range) {
      setHasSelection(false);
      return;
    }
    void runSuggestAction(session, t, { action, range, ...(language ? { language } : {}) });
  };
  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([i18n.language], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const send = () => {
    const text = draft.trim();
    if (!text || running || consent || effect || !state.hasVault) return;
    setDraft("");
    // Nothing sent (the overview was cancelled): the words come back to the field.
    void session.send(text).then((stop) => {
      if (stop === null) setDraft((current) => current || text);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // A soft keyboard has no Shift+Enter: on touch, Enter stays a line break and the button sends.
    if (!touch && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const providerLabel = (id: string) => providerById(id, state.settings.custom)?.label ?? id;
  const runLine = (run: RunMeta, coverage: AnswerCoverage | null) => {
    const tokens = run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens + run.usage.outputTokens;
    const parts = [t("ai.sentLine", { provider: providerLabel(run.providerId), count: run.sent.length, tokens: number.format(tokens) })];
    if (run.kept.length) parts.push(t("ai.keptLine", { count: run.kept.length }));
    if (run.web?.pages.length) parts.push(t("ai.web.runPages", { count: run.web.pages.length }));
    if (run.web?.searches.length) parts.push(t("ai.web.runSearches", { count: run.web.searches.length }));
    // What it read of the user's mail (plan P4-4): a number, never a subject.
    if (run.reading?.messages) parts.push(t("ai.reading.messages", { count: run.reading.messages }));
    if (run.costUsd !== undefined) parts.push(`≈ ${money.format(run.costUsd)}`);
    if (coverage?.level) parts.push(t(`ai.coverage.${coverage.level}`));
    return parts.join(" · ");
  };
  const toolLabel = (name: string) => t(`ai.tool.${name}`, { defaultValue: t("ai.tool.unknown") });
  /** One tool step as a line: running, done, failed — or not allowed, which is the user's answer and no failure (plan P4). */
  type StepLook = "running" | "open" | "done" | "failed" | "declined";
  const stepIcon = (state: StepLook) =>
    state === "running" ? (
      <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
    ) : state === "failed" ? (
      <CircleAlert size={ICON.meta} aria-hidden="true" />
    ) : state === "declined" ? (
      <Ban size={ICON.meta} aria-hidden="true" />
    ) : (
      <Check size={ICON.meta} aria-hidden="true" />
    );
  const stepText = (name: string, state: StepLook) =>
    state === "running"
      ? t("ai.toolRunning", { tool: toolLabel(name) })
      : state === "failed"
        ? t("ai.toolFailed", { tool: toolLabel(name) })
        : state === "declined"
          ? t("ai.toolDeclined", { tool: toolLabel(name) })
          : toolLabel(name);

  /** The answer a run line closes: a run that sent notes should name one (§21, citation duty). */
  const answerBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const prior = items[i]!;
      if (prior.kind === "answer") return prior.text;
      if (prior.kind === "user") return null;
    }
    return null;
  };
  const renderItem = (item: TranscriptItem, index: number) => {
    switch (item.kind) {
      case "user":
        return (
          <div key={item.key} className="pv-ai-msg pv-ai-msg--user">
            {item.context.length > 0 && (
              <div className="pv-ai-ctxline">
                <FileText size={ICON.meta} aria-hidden="true" />
                <span>{item.context.map((path) => path.replace(/^.*\//, "").replace(/\.md$/i, "")).join(", ")}</span>
              </div>
            )}
            {item.text && <div className="pv-ai-usertext">{item.text}</div>}
          </div>
        );
      case "answer":
        return (
          <div key={item.key} className="pv-ai-msg pv-ai-msg--ai">
            <AiAnswer text={item.text} onOpenNote={onOpenNote} onOpenUrl={openAnswerUrl} urlNote={urlNote} />
          </div>
        );
      case "steps": {
        // A step that is still running is the live run's to show: listed here too, it would stand twice — once as done.
        const steps = item.steps.filter((step) => step.state !== "open" || !live?.tools.some((tool) => tool.id === step.id));
        if (steps.length === 0) return null;
        return (
          <ul key={item.key} className="pv-ai-steps">
            {steps.map((step) => (
              <li key={step.id} className={cx("pv-ai-step", step.state === "failed" && "pv-ai-step--failed", step.state === "declined" && "pv-ai-step--declined")}>
                {stepIcon(step.state)}
                <span>{stepText(step.name, step.state)}</span>
              </li>
            ))}
          </ul>
        );
      }
      case "run": {
        const manifest = item.run.manifest;
        const open = openRun === item.key && Boolean(manifest);
        const answer = answerBefore(index);
        const uncited = Boolean(manifest && manifest.sources.some((s) => s.tier === "evidence") && answer !== null && !answer.includes("[["));
        // Coverage after the answer (plan P2b-5): only where notes went, so a statement could have named one.
        const coverage = manifest && manifest.sources.some((s) => s.tier === "evidence" || s.tier === "card") && answer !== null ? answerCoverage(answer) : null;
        // The pages the run read (plan P4), whatever the answer says of them: the app's own list, so no source goes unnamed.
        const pagesRead = (item.run.web?.pages ?? []).filter((page) => page.read);
        return (
          <div key={item.key} className="pv-ai-run">
            {pagesRead.length > 0 && (
              <p className="pv-ai-websources" data-testid="ai-web-sources">
                <span className="pv-ai-websources-label">
                  <Globe size={ICON.meta} aria-hidden="true" />
                  {t("ai.web.sources")}
                </span>
                {pagesRead.map((page, i) => (
                  <a
                    key={`${i}:${page.url}`}
                    href={page.url}
                    className="pv-ai-link"
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenUrl(page.url);
                    }}
                  >
                    {page.title ? `${page.title} — ${hostOf(page.url)}` : hostOf(page.url)}
                  </a>
                ))}
              </p>
            )}
            {uncited && <p className="pv-ai-nocite">{t("ai.noCitation")}</p>}
            {manifest ? (
              <Button size="sm" variant="ghost" className="pv-ai-runline" aria-expanded={open} onClick={() => setOpenRun(open ? null : item.key)}>
                {runLine(item.run, coverage)}
              </Button>
            ) : (
              <span className="pv-ai-runline">{runLine(item.run, coverage)}</span>
            )}
            {open && manifest && (
              <AiSendOverview manifest={manifest} onOpenNote={onOpenNote} touch={touch} coverage={coverage} web={item.run.web ?? null} reading={item.run.reading ?? null} onOpenUrl={(url) => onOpenUrl(url)} />
            )}
          </div>
        );
      }
    }
  };

  const shownNotice = state.notice && state.notice.conversationId === (state.active?.id ?? state.notice.conversationId) ? state.notice : null;
  const notice = shownNotice?.stop ?? null;
  // No answer came back (plan §19.4): the notes that match the question best stand in for it.
  const related = notice?.kind === "failed" ? (shownNotice?.related ?? []) : [];
  const noticeText = notice
    ? notice.kind === "failed"
      ? aiFailureText(t, notice.failure, provider.label, choice.model)
      : STOP_KEYS[notice.kind]
        ? t(STOP_KEYS[notice.kind]!)
        : null
    : null;

  return (
    <div ref={setRootEl} className={cx("pv-ai", touch && "pv-ai--touch", `pv-ai--${dress}`, side && "pv-ai--withside")} data-testid="ai-conversation">
      <p className="pv-ai-marking">
        {t("ai.marking", { model: choice.model, provider: provider.label })}
        {/* A conversation that may use the internet says so for as long as it is open (plan P4). */}
        {active && withWeb && (
          <span className="pv-ai-marking-web" data-testid="ai-web-marking">
            {t("ai.web.marking")}
          </span>
        )}
      </p>

      {lensOpen && !side ? (
        <div className="pv-ai-thread">
          <AiContextLens
            question={draft}
            onClose={() => setLensOpen(false)}
            onOpenNote={onOpenNote}
            onSend={draft.trim() && !running && !consent && state.hasVault ? () => {
              setLensOpen(false);
              send();
            } : undefined}
            touch={touch}
          />
        </div>
      ) : (
      <div className="pv-ai-thread" ref={threadRef} aria-busy={running}>
        {items.length === 0 && !live && (
          <EmptyState icon={<Sparkles size={ICON.empty} />} title={t("ai.empty.startTitle")}>
            {t("ai.empty.startBody")}
          </EmptyState>
        )}
        {items.length === 0 && !live && !consent && state.hasVault && (
          <div className="pv-ai-skills" role="group" aria-label={t("ai.skills.title")} data-testid="ai-skills">
            {startableSkills(t, state.skills.entries)
              .filter((skill) => skill.featured)
              .map((skill) => (
                <Chip key={skill.id} size="sm" icon={<skill.icon size={ICON.meta} />} testId={skill.commandId} onClick={() => void session.runSkill(skill.id, skill.start)}>
                  {skill.title}
                </Chip>
              ))}
          </div>
        )}
        {items.map((item, index) => renderItem(item, index))}
        {live && (
          <div className="pv-ai-live" aria-live="polite">
            {liveTools.length > 0 && (
              <ul className="pv-ai-steps">
                {liveTools.map((tool) => (
                  <li
                    key={tool.id}
                    className={cx("pv-ai-step", tool.state === "failed" && "pv-ai-step--failed", tool.state === "declined" && "pv-ai-step--declined", tool.state === "running" && "pv-ai-step--open")}
                  >
                    {stepIcon(tool.state)}
                    <span>{stepText(tool.name, tool.state)}</span>
                  </li>
                ))}
              </ul>
            )}
            {live.text ? (
              <div className="pv-ai-msg pv-ai-msg--ai">
                <AiAnswer text={live.text} onOpenNote={onOpenNote} onOpenUrl={openAnswerUrl} urlNote={urlNote} />
              </div>
            ) : (
              // While a page or a search waits for its answer, nothing is being thought: the question below is the state.
              !effect && (
                <p className="pv-ai-working">
                  <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
                  {t("ai.working")}
                </p>
              )
            )}
          </div>
        )}
        {noticeText && (
          <Banner
            kind={notice!.kind === "failed" ? "error" : "info"}
            rounded
            actions={
              notice!.kind === "failed" && SETUP_FAILURES.has(notice!.failure.kind) ? (
                <Button size="sm" variant="secondary" onClick={onOpenSettings}>
                  {t("ai.error.openSetup")}
                </Button>
              ) : undefined
            }
          >
            {noticeText}
          </Banner>
        )}
        {related.length > 0 && (
          <section className="pv-ai-overview" aria-label={t("ai.offline.title")} data-testid="ai-related-notes">
            <span className="pv-ai-overview-hint">{t("ai.offline.title")}</span>
            <ul className="pv-ai-overview-sources">
              {related.map((note) => (
                <li key={note.path}>
                  <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenNote(note.path)}>
                    {note.title}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!state.hasVault && <p className="pv-ai-working">{t("ai.empty.noVault")}</p>}
        {consent && (
          <AiSendOverview
            manifest={consent.manifest}
            growth={consent.growth}
            onSend={() => session.answerConsent(true)}
            onCancel={() => session.answerConsent(false)}
            onLeaveOut={(path) => session.leaveOutOfConsent(path)}
            onRedact={(path) => session.redactInConsent(path)}
            onOpenNote={onOpenNote}
            everyRequest={{ value: state.settings.confirmEveryRequest, onChange: (value) => void session.updateSettings((s) => ({ ...s, confirmEveryRequest: value })) }}
            touch={touch}
          />
        )}
        {/* One page or one search waits for an answer (plan P4): asked where the send overview is asked. */}
        {effect && <AiEffectApproval request={effect} onAnswer={(answer) => session.answerEffect(answer)} touch={touch} />}
      </div>
      )}

      {side && (
        <aside className="pv-ai-side" aria-label={t("ai.lens.title")}>
          <AiContextLens question={draft} onOpenNote={onOpenNote} side />
        </aside>
      )}

      <div className="pv-ai-composer">
        {selection && hasSelection && !running && !consent && (
          <div className="pv-ai-chips pv-ai-selchips" role="group" aria-label={t("ai.selection.with")} data-testid="ai-selection-actions">
            <span className="pv-ai-selchips-label">{t("ai.selection.with")}</span>
            <Chip size="sm" icon={<PenLine size={ICON.meta} />} onClick={() => suggest("rewrite")}>
              {t("ai.selection.action.rewrite")}
            </Chip>
            <Chip size="sm" icon={<Scissors size={ICON.meta} />} onClick={() => suggest("shorten")}>
              {t("ai.selection.action.shorten")}
            </Chip>
            <span ref={translateAnchor}>
              <Chip size="sm" icon={<Languages size={ICON.meta} />} onClick={() => setTranslateOpen(true)}>
                {t("ai.selection.action.translate")}
              </Chip>
            </span>
            <Chip size="sm" icon={<ListTodo size={ICON.meta} />} onClick={() => suggest("tasks")}>
              {t("ai.selection.action.tasks")}
            </Chip>
            <Chip size="sm" icon={<MessageCircleQuestion size={ICON.meta} />} onClick={() => void session.send(askMessage("explain")!)}>
              {t("ai.selection.action.explain")}
            </Chip>
            <MenuSurface open={translateOpen} onClose={() => setTranslateOpen(false)} anchorRef={translateAnchor} ariaLabel={t("ai.selection.translateTo")}>
              {AI_TRANSLATE_LANGUAGES.map((language) => (
                <MenuItem
                  key={language.code}
                  onSelect={() => {
                    setTranslateOpen(false);
                    suggest("translate", language.name);
                  }}
                >
                  {languageName(language.code)}
                </MenuItem>
              ))}
            </MenuSurface>
          </div>
        )}
        <div className="pv-ai-chips" aria-label={t("ai.context")}>
          {activeNote && showActive && !state.excludeActive && (
            <Chip size="sm" icon={<FileText size={ICON.meta} />} onRemove={() => session.setExcludeActive(true)} removeLabel={t("ai.removeContext")}>
              {activeNote.title}
            </Chip>
          )}
          {activeNote && showActive && state.excludeActive && (
            <Chip size="sm" tone="muted" icon={<Plus size={ICON.meta} />} onClick={() => session.setExcludeActive(false)}>
              {activeNote.title}
            </Chip>
          )}
          {pins.map((path) => (
            <Chip key={path} size="sm" icon={<Pin size={ICON.meta} />} onRemove={() => void session.unpin(path)} removeLabel={t("ai.removeContext")}>
              {path.replace(/^.*\//, "").replace(/\.md$/i, "")}
            </Chip>
          ))}
          {onPickNote && (
            <Chip size="sm" tone="muted" icon={<Plus size={ICON.meta} />} onClick={onPickNote}>
              {t("ai.pinNote")}
            </Chip>
          )}
        </div>
        <div className="pv-ai-inputrow">
          <TextArea
            className="pv-ai-input"
            rows={touch ? 2 : 1}
            value={draft}
            placeholder={t("ai.placeholder")}
            aria-label={t("ai.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            data-testid="ai-input"
          />
          {running ? (
            <IconButton label={t("ai.stop")} onClick={() => session.stop()} data-testid="ai-stop">
              <Square size={touch ? ICON.touch : ICON.ui} />
            </IconButton>
          ) : (
            <IconButton label={t("ai.send")} active={Boolean(draft.trim())} disabled={!draft.trim() || !state.hasVault || Boolean(consent)} onClick={send} data-testid="ai-send">
              <Send size={touch ? ICON.touch : ICON.ui} />
            </IconButton>
          )}
        </div>
        <div className="pv-ai-foot">
          {!side && (
            <IconButton size="sm" label={t("ai.lens.open")} active={lensOpen} aria-pressed={lensOpen} onClick={() => setLensOpen((open) => !open)} data-testid="ai-lens-open">
              <Eye size={touch ? ICON.ui : ICON.meta} />
            </IconButton>
          )}
          {/* Only where the vault allows the internet: a vault nobody decided about shows nothing of it. */}
          {(webOffer || withWeb) && (
            <IconButton
              size="sm"
              label={active ? (withWeb ? t("ai.web.activeOn") : t("ai.web.activeOff")) : withWeb ? t("ai.web.toggleOn") : t("ai.web.toggleOff")}
              active={withWeb}
              aria-pressed={withWeb}
              disabled={running}
              onClick={toggleWeb}
              data-testid="ai-web-toggle"
            >
              <Globe size={touch ? ICON.ui : ICON.meta} />
            </IconButton>
          )}
          <Button ref={modelButton} size="sm" variant="ghost" onClick={() => setMenuOpen(true)} aria-haspopup="menu" disabled={running}>
            {provider.label} · {choice.model}
          </Button>
          <MenuSurface open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={modelButton} ariaLabel={t("ai.settings.profiles")}>
            {AI_PROFILE_IDS.map((id) => {
              const profile = state.settings.profiles[id];
              if (!profile) return null;
              const selected = profile.providerId === choice.providerId && profile.model === choice.model;
              return (
                <MenuItem key={id} active={selected} hint={`${providerLabel(profile.providerId)} · ${profile.model}`} onSelect={() => void session.setChoice(profile)}>
                  {t(`ai.profile.${id}`)}
                </MenuItem>
              );
            })}
          </MenuSurface>
        </div>
      </div>
    </div>
  );
}
