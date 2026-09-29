import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, HardDrive, LoaderCircle, Minus, Pin, X } from "lucide-react";
import type { GateExclusion, PackageRef } from "@plainva/core";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { toast } from "../services/toastStore";
import type { ContextPreview } from "./aiSession";
import { useAiSession, useAiState } from "./useAiSession";

/**
 * "View context" (plan §13.3, mockup v5 §3): what the AI would see for the
 * next request — before it sees it. Built by the session exactly like a send,
 * for the model chosen now, and sent nowhere. Per source: the section, why it
 * was chosen, its size and whether it goes; notes can be left out of the next
 * request, pinned to the conversation, or kept on this device for good. Notes
 * the rules keep back are listed too, so the reader knows what is missing —
 * they were never scored. One view for every dress: inline over the thread,
 * or the AI tab's side column.
 */
export interface AiContextLensProps {
  /** The words in the composer: the question the context is built for. */
  question: string;
  onClose?: () => void;
  onOpenNote?: (path: string) => void;
  /** "Send with this context", while there is something to send. */
  onSend?: () => void;
  touch?: boolean;
  /** The tab's side column: always there, no close. */
  side?: boolean;
}

const titleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|base)$/i, "");
/** Tokens as the overview estimates them: about four characters each. */
const tokensOf = (chars: number) => Math.ceil(chars / 4);

export function AiContextLens({ question, onClose, onOpenNote, onSend, touch, side }: AiContextLensProps) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const [asked, setAsked] = useState(question);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; preview: ContextPreview | null } | null>(null);

  // The composer changes with every key: the context follows once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(question), 500);
    return () => clearTimeout(timer);
  }, [question]);

  const pins = state?.active ? state.active.pins : (state?.draftPins ?? []);
  const leftOut = state?.leaveOutNext ?? [];
  const choice = session?.choice();
  const key = JSON.stringify([asked, leftOut, pins, state?.excludeActive, state?.active?.id, state?.active?.updatedAt, choice?.providerId, choice?.model, refresh]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    void session.previewContext(asked).then(
      (preview) => {
        if (alive) setResult({ key, preview });
      },
      () => {
        if (alive) setResult({ key, preview: null });
      },
    );
    return () => {
      alive = false;
    };
    // `key` carries every input of the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, key]);

  if (!session || !state) return null;
  const loading = result?.key !== key;
  const preview = result?.preview ?? null;

  const form = (ref: PackageRef) =>
    ref.unchanged
      ? t("ai.overview.unchanged")
      : ref.tier === "evidence"
        ? ref.section === undefined
          ? t("ai.overview.evidenceWhole")
          : ref.section
            ? t("ai.overview.evidenceSection", { section: ref.section })
            : t("ai.overview.evidenceStart")
        : ref.tier === "card"
          ? t("ai.overview.card")
          : t("ai.overview.handle");
  const why = (e: GateExclusion) =>
    e.source?.kind === "note" ? t("ai.lens.ruleNote") : e.source?.kind === "folder" ? t("ai.lens.ruleFolder", { folder: e.source.folder || "/" }) : t("ai.lens.ruleDefault");
  const keepLocal = (path: string) => {
    void session.keepOnDevice(path).then((ok) => {
      if (ok) {
        toast.success(t("ai.lens.keepLocalDone", { note: titleOf(path) }));
        setRefresh((n) => n + 1);
      } else {
        toast.error(t("ai.lens.keepLocalFailed", { note: titleOf(path) }));
      }
    });
  };

  const manifest = preview?.manifest;
  const refs = preview?.pack.refs ?? [];
  const excluded = preview?.pack.excluded ?? [];
  const kept = manifest
    ? [
        manifest.withheld.links ? t("ai.overview.keptLinks", { count: manifest.withheld.links }) : null,
        manifest.withheld.places ? t("ai.overview.keptPlaces", { count: manifest.withheld.places }) : null,
        manifest.withheld.moodProperties ? t("ai.overview.keptMood", { count: manifest.withheld.moodProperties }) : null,
      ].filter((line): line is string => Boolean(line))
    : [];

  return (
    <section className={cx("pv-ai-lens", side && "pv-ai-lens--side", touch && "pv-ai-lens--touch")} aria-label={t("ai.lens.title")} data-testid="ai-lens">
      <div className="pv-ai-lens-head">
        <Eye size={ICON.ui} aria-hidden="true" />
        <h4>{t("ai.lens.title")}</h4>
        {loading && <LoaderCircle size={ICON.meta} className="pv-ai-spin" aria-label={t("ai.lens.loading")} />}
        {onClose && (
          <IconButton size="sm" label={t("common.close")} onClick={onClose} data-testid="ai-lens-close">
            <X size={ICON.meta} />
          </IconButton>
        )}
      </div>
      <p className="pv-ai-lens-tag">{t("ai.lens.tagline")}</p>

      {!preview ? (
        !loading && <p className="pv-ai-lens-note">{t("ai.lens.unavailable")}</p>
      ) : (
        <>
          <dl className="pv-ai-lens-stats">
            <div>
              <dt>{t("ai.overview.goesTo")}</dt>
              <dd>
                {preview.manifest.providerLabel} · {preview.manifest.model}
              </dd>
            </div>
            <div>
              <dt>{t("ai.overview.notes")}</dt>
              <dd>{t("ai.lens.sourcesOf", { sent: number.format(refs.length), candidates: number.format(preview.candidates) })}</dd>
            </div>
            <div>
              <dt>{t("ai.overview.size")}</dt>
              <dd>{t("ai.overview.estimate", { tokens: number.format(preview.manifest.estimatedTokens) })}</dd>
            </div>
          </dl>
          {preview.manifest.local && <p className="pv-ai-lens-note">{t("ai.lens.local")}</p>}

          {refs.length === 0 ? (
            <p className="pv-ai-lens-note">{t("ai.lens.nothing")}</p>
          ) : (
            <ul className="pv-ai-lens-list">
              {refs.map((ref) => {
                const pinned = pins.includes(ref.path);
                return (
                  <li key={ref.path} className="pv-ai-lens-row">
                    <div className="pv-ai-lens-main">
                      {onOpenNote ? (
                        <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenNote(ref.path)}>
                          {ref.title}
                        </Button>
                      ) : (
                        <span className="pv-ai-overview-note">{ref.title}</span>
                      )}
                      <span className="pv-ai-overview-form">
                        {form(ref)}
                        {ref.chars > 0 ? ` · ${t("ai.overview.estimate", { tokens: number.format(tokensOf(ref.chars)) })}` : ""}
                      </span>
                    </div>
                    <div className="pv-ai-lens-why">
                      {ref.reasons.map((reason) => (
                        <span key={reason} className="pv-ai-lens-reason">
                          {t(`ai.lens.signal.${reason}`)}
                        </span>
                      ))}
                    </div>
                    <div className="pv-ai-lens-actions">
                      <IconButton size="sm" label={t("ai.overview.leaveOut", { note: ref.title })} onClick={() => session.toggleLeaveOut(ref.path)}>
                        <Minus size={ICON.meta} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        active={pinned}
                        label={pinned ? t("ai.lens.unpin", { note: ref.title }) : t("ai.lens.pin", { note: ref.title })}
                        onClick={() => void (pinned ? session.unpin(ref.path) : session.pin(ref.path))}
                      >
                        <Pin size={ICON.meta} />
                      </IconButton>
                      {!preview.manifest.local && (
                        <IconButton size="sm" label={t("ai.lens.keepLocal", { note: ref.title })} onClick={() => keepLocal(ref.path)}>
                          <HardDrive size={ICON.meta} />
                        </IconButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {leftOut.length > 0 && (
            <div className="pv-ai-lens-group">
              <h5>{t("ai.lens.leftOut")}</h5>
              <ul className="pv-ai-lens-list">
                {leftOut.map((path) => (
                  <li key={path} className="pv-ai-lens-row pv-ai-lens-row--quiet">
                    <span className="pv-ai-overview-note">{titleOf(path)}</span>
                    <Button size="sm" variant="ghost" onClick={() => session.toggleLeaveOut(path)}>
                      {t("ai.lens.takeBack")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {kept.length > 0 && <p className="pv-ai-lens-note">{`${t("ai.overview.keptBack")}: ${kept.join(" · ")}`}</p>}

          {excluded.length > 0 && (
            <div className="pv-ai-lens-group">
              <h5>{t("ai.lens.never", { count: excluded.length })}</h5>
              <p className="pv-ai-lens-note">{t("ai.lens.neverHint")}</p>
              <ul className="pv-ai-lens-list">
                {excluded.map((e) => (
                  <li key={e.path} className="pv-ai-lens-row pv-ai-lens-row--quiet">
                    <span className="pv-ai-overview-note">{titleOf(e.path)}</span>
                    <span className="pv-ai-overview-form">{why(e)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {onSend && (
        <div className="pv-ai-overview-actions">
          <Button variant="primary" onClick={onSend} data-testid="ai-lens-send">
            {t("ai.lens.sendWith")}
          </Button>
        </div>
      )}
    </section>
  );
}
