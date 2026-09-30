import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Minus, ShieldCheck } from "lucide-react";
import type { EgressManifest, ManifestSource, ScopeGrowth } from "@plainva/core";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Switch } from "../components/ui/Switch";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";

/**
 * The send overview (plan §13.3): what goes where, before it goes — and,
 * afterwards, what went. One view for both uses and both shells: with
 * `onSend` it is the scope approval waiting above the composer (E25), without
 * it the record a run line opens. Paths and sections only; the text itself is
 * the note's, and the note is one click away.
 */
export interface AiSendOverviewProps {
  manifest: EgressManifest;
  /** Why the overview asks now; empty when it only shows. */
  growth?: readonly ScopeGrowth[];
  onSend?: () => void;
  onCancel?: () => void;
  /** Leave one note out of the waiting request. */
  onLeaveOut?: (path: string) => void;
  onOpenNote?: (path: string) => void;
  /** "Ask before every request", when the overview offers the setting. */
  everyRequest?: { value: boolean; onChange: (value: boolean) => void };
  touch?: boolean;
}

export function AiSendOverview({ manifest, growth = [], onSend, onCancel, onLeaveOut, onOpenNote, everyRequest, touch }: AiSendOverviewProps) {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 4 }), [i18n.language]);
  const asking = Boolean(onSend);

  const why = (g: ScopeGrowth) => {
    switch (g.kind) {
      case "first":
        return t("ai.overview.why.first");
      case "recipient":
        return t("ai.overview.why.recipient", { model: g.recipient.slice(g.recipient.indexOf("/") + 1) });
      case "dataClass":
        return t("ai.overview.why.dataClass", { kind: t(`ai.overview.class.${g.dataClass}`) });
      case "folder":
        return t("ai.overview.why.folder", { folder: g.folder || "/" });
      case "tools":
        return t("ai.overview.why.tools", { tools: g.tools.map((tool) => t(`ai.tool.${tool}`, { defaultValue: tool })).join(", ") });
      case "web":
        return t("ai.overview.why.web");
      case "size":
        return t("ai.overview.why.size", { tokens: number.format(g.tokens) });
    }
  };
  const form = (source: ManifestSource) =>
    source.selection
      ? t("ai.overview.evidenceSelection")
      : source.unchanged
      ? t("ai.overview.unchanged")
      : source.tier === "evidence"
        ? source.section === undefined
          ? t("ai.overview.evidenceWhole")
          : source.section
            ? t("ai.overview.evidenceSection", { section: source.section })
            : t("ai.overview.evidenceStart")
        : source.tier === "card"
          ? t("ai.overview.card")
          : t("ai.overview.handle");
  const kept = [
    manifest.withheld.notes ? t("ai.overview.keptNotes", { count: manifest.withheld.notes }) : null,
    manifest.withheld.links ? t("ai.overview.keptLinks", { count: manifest.withheld.links }) : null,
    manifest.withheld.places ? t("ai.overview.keptPlaces", { count: manifest.withheld.places }) : null,
    manifest.withheld.moodProperties ? t("ai.overview.keptMood", { count: manifest.withheld.moodProperties }) : null,
  ].filter((line): line is string => Boolean(line));
  const classes = manifest.dataClasses.filter((c) => c !== "notes");
  const estimate =
    manifest.estimatedCostUsd !== undefined
      ? t("ai.overview.estimateCost", { tokens: number.format(manifest.estimatedTokens), cost: money.format(manifest.estimatedCostUsd) })
      : t("ai.overview.estimate", { tokens: number.format(manifest.estimatedTokens) });

  return (
    <section className={cx("pv-ai-overview", asking && "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={t("ai.overview.title", { provider: manifest.providerLabel })} data-testid={asking ? "ai-consent" : "ai-overview"}>
      <h4 className="pv-ai-overview-head">
        <ShieldCheck size={ICON.ui} aria-hidden="true" />
        <span>{asking ? t("ai.overview.title", { provider: manifest.providerLabel }) : t("ai.overview.sentTitle", { provider: manifest.providerLabel })}</span>
      </h4>
      {growth.length > 0 && (
        <ul className="pv-ai-overview-why">
          {growth.map((g, i) => (
            <li key={i}>{why(g)}</li>
          ))}
        </ul>
      )}
      <dl className="pv-ai-overview-list">
        <dt>{t("ai.overview.goesTo")}</dt>
        <dd>
          {manifest.providerLabel} · {manifest.model}
        </dd>
        <dt>{t("ai.overview.notes")}</dt>
        <dd>
          {manifest.sources.length === 0 ? (
            t("ai.overview.noNotes")
          ) : (
            <ul className="pv-ai-overview-sources">
              {manifest.sources.map((source) => (
                <li key={source.path}>
                  {onOpenNote ? (
                    <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenNote(source.path)}>
                      {source.title}
                    </Button>
                  ) : (
                    <span className="pv-ai-overview-note">{source.title}</span>
                  )}
                  <span className="pv-ai-overview-form">{form(source)}</span>
                  {onLeaveOut && (
                    <IconButton size="sm" label={t("ai.overview.leaveOut", { note: source.title })} onClick={() => onLeaveOut(source.path)}>
                      <Minus size={ICON.meta} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </dd>
        {classes.length > 0 && (
          <>
            <dt>{t("ai.overview.alsoGoes")}</dt>
            <dd>{classes.map((c) => t(`ai.overview.class.${c}`)).join(" · ")}</dd>
          </>
        )}
        {kept.length > 0 && (
          <>
            <dt>{t("ai.overview.keptBack")}</dt>
            <dd>{kept.join(" · ")}</dd>
          </>
        )}
        {manifest.tools.length > 0 && (
          <>
            <dt>{t("ai.overview.tools")}</dt>
            <dd>{manifest.tools.map((tool) => t(`ai.tool.${tool}`, { defaultValue: tool })).join(" · ")}</dd>
          </>
        )}
        <dt>{t("ai.overview.size")}</dt>
        <dd>{estimate}</dd>
      </dl>
      {asking && (
        <div className="pv-ai-overview-actions">
          {everyRequest && (
            <span className="pv-ai-overview-every">
              <Switch checked={everyRequest.value} onChange={everyRequest.onChange} label={t("ai.overview.everyRequest")} />
              <span aria-hidden="true">{t("ai.overview.everyRequest")}</span>
            </span>
          )}
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onSend} data-testid="ai-consent-send">
            {t("ai.overview.send")}
          </Button>
        </div>
      )}
    </section>
  );
}
