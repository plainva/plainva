import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, FileText, LoaderCircle, Pin, Plus, Send, Sparkles, Square } from "lucide-react";
import { AI_PROFILE_IDS, providerById, type ModelFailure, type RunMeta, type RunStop } from "@plainva/core";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { EmptyState } from "../components/ui/EmptyState";
import { TextArea } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { MenuItem, MenuSurface } from "../components/ui/Menu";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { AiAnswer } from "./AiAnswer";
import { aiFailureText } from "./aiSettingsModel";
import type { AiDress } from "./aiSession";
import { transcriptOf, type TranscriptItem } from "./transcript";
import { useAiSession, useAiState } from "./useAiSession";

/**
 * The conversation itself — the one view the companion window, the AI tab,
 * the phone's sheet and its screen all show (plan §19.1). What it says is
 * derived from the session; where it sits is the dress's business.
 *
 * Marking (ADR 0022, Art. 50): every conversation opens with the quiet line
 * naming the model and the provider — in every dress, never a banner to
 * dismiss. Each run ends with one line saying what was sent where.
 */
export interface AiConversationProps {
  dress: AiDress;
  /** The note open in the shell, for the context chip. */
  activeNote: { path: string; title: string } | null;
  onOpenNote: (target: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenSettings: () => void;
  /** The shell's note picker; the chosen note is pinned to the conversation. */
  onPickNote?: () => void;
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
const SETUP_FAILURES = new Set<ModelFailure["kind"]>(["no_key", "invalid_key", "not_found", "unknown_endpoint"]);

export function AiConversation({ dress, activeNote, onOpenNote, onOpenUrl, onOpenSettings, onPickNote }: AiConversationProps) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const modelButton = useRef<HTMLButtonElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const touch = dress === "sheet" || dress === "screen";

  const active = state?.active ?? null;
  const items = useMemo(() => (active ? transcriptOf(active) : []), [active]);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 4 }), [i18n.language]);

  // Follow the answer while it streams, the way a reader would scroll.
  const liveText = state?.live?.text ?? "";
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, liveText, state?.live?.tools.length]);

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
  const pins = state.active?.pins ?? state.draftPins;
  const showActive = Boolean(activeNote) && !pins.includes(activeNote!.path);

  const send = () => {
    const text = draft.trim();
    if (!text || running || !state.hasVault) return;
    setDraft("");
    void session.send(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // A soft keyboard has no Shift+Enter: on touch, Enter stays a line break and the button sends.
    if (!touch && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const providerLabel = (id: string) => providerById(id, state.settings.custom)?.label ?? id;
  const runLine = (run: RunMeta) => {
    const tokens = run.usage.inputTokens + run.usage.cacheReadTokens + run.usage.cacheWriteTokens + run.usage.outputTokens;
    const parts = [t("ai.sentLine", { provider: providerLabel(run.providerId), count: run.sent.length, tokens: number.format(tokens) })];
    if (run.kept.length) parts.push(t("ai.keptLine", { count: run.kept.length }));
    if (run.costUsd !== undefined) parts.push(`≈ ${money.format(run.costUsd)}`);
    return parts.join(" · ");
  };
  const toolLabel = (name: string) => t(`ai.tool.${name}`, { defaultValue: t("ai.tool.unknown") });

  const renderItem = (item: TranscriptItem) => {
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
            <AiAnswer text={item.text} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
          </div>
        );
      case "steps":
        return (
          <ul key={item.key} className="pv-ai-steps">
            {item.steps.map((step) => (
              <li key={step.id} className={cx("pv-ai-step", step.state === "failed" && "pv-ai-step--failed")}>
                {step.state === "failed" ? <CircleAlert size={ICON.meta} aria-hidden="true" /> : <Check size={ICON.meta} aria-hidden="true" />}
                <span>{step.state === "failed" ? t("ai.toolFailed", { tool: toolLabel(step.name) }) : toolLabel(step.name)}</span>
              </li>
            ))}
          </ul>
        );
      case "run":
        return (
          <div key={item.key} className="pv-ai-run">
            {runLine(item.run)}
          </div>
        );
    }
  };

  const notice = state.notice && state.notice.conversationId === (state.active?.id ?? state.notice.conversationId) ? state.notice.stop : null;
  const noticeText = notice
    ? notice.kind === "failed"
      ? aiFailureText(t, notice.failure, provider.label, choice.model)
      : STOP_KEYS[notice.kind]
        ? t(STOP_KEYS[notice.kind]!)
        : null
    : null;

  return (
    <div className={cx("pv-ai", touch && "pv-ai--touch", `pv-ai--${dress}`)} data-testid="ai-conversation">
      <p className="pv-ai-marking">{t("ai.marking", { model: choice.model, provider: provider.label })}</p>

      <div className="pv-ai-thread" ref={threadRef} aria-busy={running}>
        {items.length === 0 && !live && (
          <EmptyState icon={<Sparkles size={ICON.empty} />} title={t("ai.empty.startTitle")}>
            {t("ai.empty.startBody")}
          </EmptyState>
        )}
        {items.map(renderItem)}
        {live && (
          <div className="pv-ai-live" aria-live="polite">
            {live.tools.length > 0 && (
              <ul className="pv-ai-steps">
                {live.tools.map((tool) => (
                  <li key={tool.id} className={cx("pv-ai-step", tool.state === "failed" && "pv-ai-step--failed", tool.state === "running" && "pv-ai-step--open")}>
                    {tool.state === "running" ? (
                      <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
                    ) : tool.state === "failed" ? (
                      <CircleAlert size={ICON.meta} aria-hidden="true" />
                    ) : (
                      <Check size={ICON.meta} aria-hidden="true" />
                    )}
                    <span>{tool.state === "running" ? t("ai.toolRunning", { tool: toolLabel(tool.name) }) : toolLabel(tool.name)}</span>
                  </li>
                ))}
              </ul>
            )}
            {live.text ? (
              <div className="pv-ai-msg pv-ai-msg--ai">
                <AiAnswer text={live.text} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} />
              </div>
            ) : (
              <p className="pv-ai-working">
                <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-hidden="true" />
                {t("ai.working")}
              </p>
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
        {!state.hasVault && <p className="pv-ai-working">{t("ai.empty.noVault")}</p>}
      </div>

      <div className="pv-ai-composer">
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
            <IconButton label={t("ai.send")} active={Boolean(draft.trim())} disabled={!draft.trim() || !state.hasVault} onClick={send} data-testid="ai-send">
              <Send size={touch ? ICON.touch : ICON.ui} />
            </IconButton>
          )}
        </div>
        <div className="pv-ai-foot">
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
