import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Minus, ShieldAlert, ShieldCheck } from "lucide-react";
import { REDACTABLE, SITUATION_SOURCE, type AnswerCoverage, type EgressManifest, type ManifestSource, type ScopeGrowth, type SensitiveKind } from "@plainva/core";
import { Button } from "../components/ui/Button";
import { IconButton } from "../components/ui/IconButton";
import { Switch } from "../components/ui/Switch";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { megabytes } from "./aiTranscribe";
import { useSensitiveKinds } from "./sensitiveKinds";
import { appSkillOf } from "./appSkills";

/**
 * The send overview (plan §13.3): what goes where, before it goes — and,
 * afterwards, what went. One view for both uses and both shells: with
 * `onSend` it is the scope approval waiting above the composer (E25), without
 * it the record a run line opens. Paths and sections only; the text itself is
 * the note's, and the note is one click away. A manifest with `standing` is
 * the standing approval of search by meaning with a cloud model (plan
 * P2a-5): it names how many notes go and from which folders, not each note.
 */
export interface AiSendOverviewProps {
  manifest: EgressManifest;
  /** Why the overview asks now; empty when it only shows. */
  growth?: readonly ScopeGrowth[];
  onSend?: () => void;
  onCancel?: () => void;
  /** Leave one note out of the waiting request. */
  onLeaveOut?: (path: string) => void;
  /** Redact one source's numbers and secrets for this conversation, or no longer (P2b-6). */
  onRedact?: (path: string) => void;
  onOpenNote?: (path: string) => void;
  /** "Ask before every request", when the overview offers the setting. */
  everyRequest?: { value: boolean; onChange: (value: boolean) => void };
  touch?: boolean;
  /** After the answer: how many of its statements name a note (plan P2b-5). */
  coverage?: AnswerCoverage | null;
}

/** A skill's title for the overview: the app's in the user's language, the vault's own by its name. */
function useSkillTitle(): (id: string, name: string) => string {
  const { t } = useTranslation();
  return (id, name) => {
    const app = appSkillOf(id);
    return app ? t(`ai.skills.${app.key}.title`) : name;
  };
}

export function AiSendOverview({ manifest, growth = [], onSend, onCancel, onLeaveOut, onRedact, onOpenNote, everyRequest, touch, coverage }: AiSendOverviewProps) {
  const { t, i18n } = useTranslation();
  const kindList = useSensitiveKinds();
  const skillTitle = useSkillTitle();
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
      case "sensitive":
        return t("ai.overview.why.sensitive", { kinds: kindList(g.sensitive) });
      case "instructions":
        return t("ai.overview.why.instructions");
    }
  };
  /** The instructions that go with the request (plan KI-Harness P3): the skill, the list of skills, AGENTS.md. */
  const instructions = manifest.instructions;
  const instructionLines = instructions
    ? [
        instructions.skill
          ? t(instructions.skill.origin === "plainva" ? "ai.overview.skillApp" : "ai.overview.skillVault", { title: skillTitle(instructions.skill.id, instructions.skill.name) })
          : null,
        instructions.catalog
          ? instructions.catalog.vault.length
            ? t("ai.overview.catalogVault", { count: instructions.catalog.count, vault: instructions.catalog.vault.length })
            : t("ai.overview.catalog", { count: instructions.catalog.count })
          : null,
        instructions.vault ? t("ai.overview.vaultInstructions") : null,
      ].filter((line): line is string => Boolean(line))
    : [];
  /** The hint at a source or at the situation (P2b-6); redacting is offered where it can work — never for a selected passage. */
  const sensitiveLine = (path: string, kinds: readonly SensitiveKind[], redacted: boolean, canRedact: boolean) => (
    <span className="pv-ai-overview-sensitive" data-testid="ai-overview-sensitive">
      <ShieldAlert size={ICON.meta} aria-hidden="true" />
      <span>{t("ai.lens.sensitive", { kinds: kindList(kinds) })}</span>
      {onRedact && canRedact && kinds.some((kind) => REDACTABLE.has(kind)) && (
        <Button size="sm" variant="ghost" onClick={() => onRedact(path)} data-testid="ai-overview-redact">
          {redacted ? t("ai.lens.unredact") : t("ai.lens.redact")}
        </Button>
      )}
    </span>
  );
  const form = (source: ManifestSource) =>
    source.audioBytes !== undefined
      ? t("ai.overview.evidenceAudio", { size: megabytes(source.audioBytes) })
      : source.comments !== undefined
      ? source.comments > 0
        ? t("ai.thread.evidence", { count: source.comments })
        : t("ai.thread.evidencePassage")
      : source.selection
      ? t("ai.overview.evidenceSelection")
      : source.unchanged
      ? t("ai.overview.unchanged")
      : source.tier === "evidence"
        ? source.section === undefined
          ? t("ai.overview.evidenceWhole")
          : source.section
            ? t("ai.overview.evidenceSection", { section: source.section })
            : t("ai.overview.evidenceStart")
        : source.gist
          ? t("ai.overview.gist")
          : source.tier === "card"
            ? t("ai.overview.card")
            : t("ai.overview.handle");
  const kept = [
    manifest.withheld.notes ? t("ai.overview.keptNotes", { count: manifest.withheld.notes }) : null,
    manifest.withheld.links ? t("ai.overview.keptLinks", { count: manifest.withheld.links }) : null,
    manifest.withheld.places ? t("ai.overview.keptPlaces", { count: manifest.withheld.places }) : null,
    manifest.withheld.moodProperties ? t("ai.overview.keptMood", { count: manifest.withheld.moodProperties }) : null,
    manifest.withheld.sensitive ? t("ai.overview.keptSensitive", { count: manifest.withheld.sensitive }) : null,
  ].filter((line): line is string => Boolean(line));
  const classes = manifest.dataClasses.filter((c) => c !== "notes");
  const estimate =
    manifest.estimatedCostUsd !== undefined
      ? t("ai.overview.estimateCost", { tokens: number.format(manifest.estimatedTokens), cost: money.format(manifest.estimatedCostUsd) })
      : t("ai.overview.estimate", { tokens: number.format(manifest.estimatedTokens) });

  const standing = manifest.standing;
  const title = standing
    ? t("ai.overview.standingTitle", { provider: manifest.providerLabel })
    : asking
      ? t("ai.overview.title", { provider: manifest.providerLabel })
      : t("ai.overview.sentTitle", { provider: manifest.providerLabel });

  return (
    <section className={cx("pv-ai-overview", asking && "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid={asking ? "ai-consent" : "ai-overview"}>
      <h4 className="pv-ai-overview-head">
        <ShieldCheck size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      {(growth.length > 0 || standing) && (
        <ul className="pv-ai-overview-why">
          {standing && <li>{t("ai.overview.why.standing")}</li>}
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
          {standing ? (
            t("ai.overview.standingNotes", { count: standing.notes })
          ) : manifest.sources.length === 0 ? (
            t("ai.overview.noNotes")
          ) : (
            <ul className="pv-ai-overview-sources">
              {manifest.sources.map((source, index) => (
                // A note and the comment thread on it are two rows with one path (plan P3-6).
                <li key={`${index}:${source.path}`} className={cx(Boolean(source.sensitive?.length) && "pv-ai-overview-source--hint")}>
                  {onOpenNote ? (
                    <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenNote(source.path)}>
                      {source.title}
                    </Button>
                  ) : (
                    <span className="pv-ai-overview-note">{source.title}</span>
                  )}
                  <span className="pv-ai-overview-form">{form(source)}</span>
                  {/* The thread is what was asked about: it goes, or the request is cancelled. */}
                  {onLeaveOut && source.comments === undefined && (
                    <IconButton size="sm" label={t("ai.overview.leaveOut", { note: source.title })} onClick={() => onLeaveOut(source.path)}>
                      <Minus size={ICON.meta} />
                    </IconButton>
                  )}
                  {source.sensitive && source.sensitive.length > 0 && sensitiveLine(source.path, source.sensitive, Boolean(source.redacted), !source.selection && source.comments === undefined)}
                </li>
              ))}
            </ul>
          )}
        </dd>
        {standing && manifest.folders.length > 0 && (
          <>
            <dt>{t("ai.overview.folders")}</dt>
            <dd>{manifest.folders.map((folder) => folder || "/").join(" · ")}</dd>
          </>
        )}
        {classes.length > 0 && (
          <>
            <dt>{t("ai.overview.alsoGoes")}</dt>
            <dd>
              {classes.map((c) => t(`ai.overview.class.${c}`)).join(" · ")}
              {manifest.situationHint && sensitiveLine(SITUATION_SOURCE, manifest.situationHint.sensitive, Boolean(manifest.situationHint.redacted), true)}
            </dd>
          </>
        )}
        {kept.length > 0 && (
          <>
            <dt>{t("ai.overview.keptBack")}</dt>
            <dd>{kept.join(" · ")}</dd>
          </>
        )}
        {instructionLines.length > 0 && (
          <>
            <dt>{t("ai.overview.instructions")}</dt>
            <dd data-testid="ai-overview-instructions">
              {instructionLines.join(" · ")}
              {instructions?.skill?.localPreferred && !manifest.local && <span className="pv-ai-overview-hint">{t("ai.overview.localPreferred")}</span>}
            </dd>
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
        {coverage?.level && (
          <>
            <dt>{t("ai.coverage.label")}</dt>
            <dd data-testid="ai-coverage">{`${t(`ai.coverage.${coverage.level}`)} — ${t("ai.coverage.detail", { cited: number.format(coverage.cited), total: number.format(coverage.statements) })}`}</dd>
          </>
        )}
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
            {standing ? t("ai.overview.approveStanding") : t("ai.overview.send")}
          </Button>
        </div>
      )}
    </section>
  );
}
