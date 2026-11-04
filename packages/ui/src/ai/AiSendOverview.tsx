import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Minus, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  DISPATCH_TOOL,
  isMcpExposedToolName,
  MAIL_TOOL_NAMES,
  REDACTABLE,
  shortHash,
  SITUATION_SOURCE,
  type AnswerCoverage,
  type EgressManifest,
  type ImagePart,
  type ManifestSource,
  type ModelChoice,
  type RunReading,
  type RunWeb,
  type ScopeGrowth,
  type SensitiveKind,
  type SnapshotState,
} from "@plainva/core";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { MenuItem, MenuSurface } from "../components/ui/Menu";
import { IconButton } from "../components/ui/IconButton";
import { Switch } from "../components/ui/Switch";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import { megabytes } from "./aiTranscribe";
import { pictureSize } from "./aiImage";
import { AiPicture } from "./AiPicture";
import { useSensitiveKinds } from "./sensitiveKinds";
import { appSkillOf } from "./appSkills";
import { scriptToolLabel } from "./scriptsWorkshop";
import type { ReplayRefusal, RunSnapshotStates } from "./runReplay";

/**
 * A past run's snapshot as its opened line shows it (plan KI-Harness P9-2,
 * ADR 0034): paths and versions, never a text.
 */
export interface RunSnapshotView {
  /** When the question was asked (ISO). */
  at: string;
  /** How the sources, the notes the tools read and the skills read now; null while that is being asked. */
  states: RunSnapshotStates | null;
  /** The notes the run's tools read, with their version where a tool was given them whole. */
  read: { path: string; title: string; hash?: string }[];
  /** More was read than the run's record keeps. */
  readMore: boolean;
  /** The tools the run called, each with how often. */
  tools: { name: string; count: number }[];
  /** The skills it ran with, by the version of their instructions. */
  skills: { id: string; name: string; hash: string }[];
  /** What it left for the user to decide. */
  result: { rounds: number; drafts: number; plans: number };
  /** The same question to another model: the models to choose from, or why there is none. */
  replay: { choices: { key: string; label: string; hint: string; choice: ModelChoice }[]; onReplay(choice: ModelChoice): void } | { refused: ReplayRefusal };
}

/** How a version's state reads as a chip: unchanged quietly, a change and a gone note as what they are. */
const STATE_TONE: Record<SnapshotState, "muted" | "warning" | "removal"> = { same: "muted", changed: "warning", gone: "removal" };

/** How many notes the tools read an opened line names; the rest is counted. */
const SNAPSHOT_READ_SHOWN = 8;

/** How many of a run's sources read otherwise now than the version that went. */
const changedSources = (snapshot: RunSnapshotView): number => Object.values(snapshot.states?.sources ?? {}).filter((state) => state !== "same").length;

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
  /** After the answer: what the run asked of the internet (plan P4) — every page and every search, read or not. */
  web?: RunWeb | null;
  /** After the answer: what the run read of mail and appointments (plan P4-4), in numbers, and who read the raw text. */
  reading?: RunReading | null;
  /** Opens one of those pages; the shell asks before it does. */
  onOpenUrl?: (url: string) => void;
  /** Before sending: the pictures the request would carry (plan P4-5), exactly as they would go. */
  images?: readonly ImagePart[];
  /** The provider's own list says the chosen model reads no pictures: said, never a lock. */
  blind?: boolean;
  /** The tools of foreign servers among the further tools (plan P4.5), as lines per server; the caller knows the servers' names. */
  external?: readonly string[];
  /** After the answer: what the run asked of foreign servers — server, tool, how it ended — as lines. */
  externalCalls?: readonly string[];
  /**
   * The overview stands in a confirmation of its own — a routine's (plan
   * KI-Harness P8): it shows what a run would bring along, under the caller's
   * title, with the folders the notes come from — the confirmation is about
   * those, not about today's notes — and without buttons: the yes is the
   * dialog's.
   */
  preview?: { title: string };
  /** After the answer: the run's snapshot (plan KI-Harness P9-2) — versions, tools, result, and the way to ask another model. */
  snapshot?: RunSnapshotView;
}

/** A page as a row names it: without the scheme every address shares. */
const shortAddress = (url: string) => url.replace(/^https:\/\//, "").replace(/\/$/, "");

/** A skill's title for the overview: the app's in the user's language, the vault's own by its name. */
function useSkillTitle(): (id: string, name: string) => string {
  const { t } = useTranslation();
  return (id, name) => {
    const app = appSkillOf(id);
    return app ? t(`ai.skills.${app.key}.title`) : name;
  };
}

export function AiSendOverview({ manifest, growth = [], onSend, onCancel, onLeaveOut, onRedact, onOpenNote, everyRequest, touch, coverage, web, reading, onOpenUrl, images, blind, external, externalCalls, preview, snapshot }: AiSendOverviewProps) {
  const { t, i18n } = useTranslation();
  const replayButton = useRef<HTMLButtonElement>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  /** A version and how it reads now, as a source's row shows it beside its form. */
  const versionChip = (state: SnapshotState | undefined) =>
    state ? (
      <Chip size="sm" tone={STATE_TONE[state]} testId="ai-snapshot-state">
        {t(`ai.snapshot.state.${state}`)}
      </Chip>
    ) : null;
  const versionText = (hash: string | undefined) => (hash ? t("ai.snapshot.version", { hash: shortHash(hash) }) : "");
  // The dispatcher is the search's other half, not a tool of its own to a reader.
  const shownTools = manifest.tools.filter((tool) => tool !== DISPATCH_TOOL);
  const further = manifest.more ?? [];
  // A tool in the app's words; a script (plan P5.5) by its own name.
  const toolWord = (name: string) => scriptToolLabel(t, name) ?? t(`ai.tool.${name}`, { defaultValue: name });
  // A foreign tool is named by its server, never by the name a server gave it: the caller brings those lines.
  const foreign = further.filter(isMcpExposedToolName);
  const furtherLines = [
    further.some((name) => MAIL_TOOL_NAMES.includes(name)) ? t("ai.overview.furtherMail") : "",
    ...further.filter((name) => !MAIL_TOOL_NAMES.includes(name) && !isMcpExposedToolName(name)).map(toolWord),
    ...(external ?? (foreign.length ? [t("ai.ext.overviewOther", { n: foreign.length })] : [])),
  ].filter(Boolean);
  const readingLines = reading
    ? [
        reading.mailSearches ? t("ai.reading.searches", { count: reading.mailSearches }) : "",
        reading.messages ? t("ai.reading.messages", { count: reading.messages }) : "",
        reading.descriptions ? t("ai.reading.descriptions", { count: reading.descriptions }) : "",
      ].filter(Boolean)
    : [];
  const kindList = useSensitiveKinds();
  const skillTitle = useSkillTitle();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 4 }), [i18n.language]);
  const when = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);
  /** When a run was asked, in the reader's language; a date that does not read stays as it was stored. */
  const askedAt = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : when.format(date);
  };
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
        return t("ai.overview.why.tools", { tools: g.tools.filter((tool) => tool !== DISPATCH_TOOL).map(toolWord).join(", ") });
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
        // What connected servers wrote about their skills goes with the list too (plan P9-4b): their words, counted.
        instructions.catalog?.servers ? t("ai.overview.catalogServers", { count: instructions.catalog.servers }) : null,
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
    source.image
      ? t("ai.overview.evidenceImage", { width: number.format(source.image.width), height: number.format(source.image.height), size: pictureSize(source.image.bytes) })
      : source.columns !== undefined
      ? t("ai.overview.evidenceColumns", { count: source.columns })
      : source.audioBytes !== undefined
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
    // Entries of the memory a rule keeps from this recipient (plan P6): counted, never named.
    manifest.memory?.withheld ? t("ai.overview.keptMemory", { count: manifest.memory.withheld }) : null,
    // Examples of the writing style a rule keeps from this recipient (plan P9-3): none of their features go.
    manifest.style?.withheld ? t("ai.overview.keptStyle", { count: manifest.style.withheld }) : null,
  ].filter((line): line is string => Boolean(line));
  // The writing style has a row of its own (plan P9-3): how many features go, measured from how many examples.
  const style = manifest.style && manifest.style.features > 0 ? manifest.style : null;
  // The memory has a row of its own, with how much of it goes.
  const classes = manifest.dataClasses.filter((c) => c !== "notes" && c !== "memory" && c !== "style");
  const memory = manifest.memory;
  const memoryLine = memory
    ? [memory.entries > 0 ? t("ai.overview.memoryEntries", { count: memory.entries }) : null, memory.lookup ? t("ai.overview.memoryLookup") : null].filter((line): line is string => Boolean(line)).join(" · ")
    : "";
  const estimate =
    manifest.estimatedCostUsd !== undefined
      ? t("ai.overview.estimateCost", { tokens: number.format(manifest.estimatedTokens), cost: money.format(manifest.estimatedCostUsd) })
      : t("ai.overview.estimate", { tokens: number.format(manifest.estimatedTokens) });

  const standing = manifest.standing;
  const fill = manifest.fill;
  const title = preview
    ? preview.title
    : standing
      ? t("ai.overview.standingTitle", { provider: manifest.providerLabel })
      : asking
        ? t("ai.overview.title", { provider: manifest.providerLabel })
        : t("ai.overview.sentTitle", { provider: manifest.providerLabel });

  return (
    <section className={cx("pv-ai-overview", asking && "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid={preview ? "ai-routine-overview" : asking ? "ai-consent" : "ai-overview"}>
      <h4 className="pv-ai-overview-head">
        <ShieldCheck size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      {(growth.length > 0 || standing || fill) && (
        <ul className="pv-ai-overview-why">
          {standing && <li>{t("ai.overview.why.standing")}</li>}
          {/* A run that fills a column (plan P5-4): the notes go one at a time, and the estimate is the run's. */}
          {fill && <li data-testid="ai-overview-fill">{t("ai.overview.why.fill", { column: fill.column, count: manifest.sources.length })}</li>}
          {growth.map((g, i) => (
            <li key={i}>{why(g)}</li>
          ))}
        </ul>
      )}
      <dl className="pv-ai-overview-list">
        {snapshot && (
          <>
            <dt>{t("ai.snapshot.asked")}</dt>
            <dd data-testid="ai-snapshot-asked">{askedAt(snapshot.at)}</dd>
          </>
        )}
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
                  <span className="pv-ai-overview-form">{snapshot && source.hash ? `${form(source)} · ${versionText(source.hash)}` : form(source)}</span>
                  {/* After the answer (plan P9-2): whether the note still reads as the version that went. */}
                  {snapshot && source.hash && versionChip(snapshot.states?.sources[source.path])}
                  {/* The thread, the picture, or a database's columns are what was asked about: they go, or the request is cancelled. */}
                  {onLeaveOut && source.comments === undefined && !source.image && source.columns === undefined && (
                    <IconButton size="sm" label={t("ai.overview.leaveOut", { note: source.title })} onClick={() => onLeaveOut(source.path)}>
                      <Minus size={ICON.meta} />
                    </IconButton>
                  )}
                  {source.sensitive && source.sensitive.length > 0 && sensitiveLine(source.path, source.sensitive, Boolean(source.redacted), !source.selection && source.comments === undefined && source.columns === undefined)}
                </li>
              ))}
            </ul>
          )}
          {/* Before sending: the pictures as they would go — scaled down, encoded anew, without what the file knows of place and time. */}
          {asking && images && images.length > 0 && (
            <>
              <div className="pv-ai-overview-pictures" data-testid="ai-overview-pictures">
                {images.map((picture, index) => (
                  <AiPicture key={index} picture={picture} alt={picture.name} />
                ))}
              </div>
              <span className="pv-ai-overview-hint">{t("ai.image.asSent")}</span>
              {blind && (
                <span className="pv-ai-overview-sensitive" data-testid="ai-overview-blind">
                  <ShieldAlert size={ICON.meta} aria-hidden="true" />
                  <span>{t("ai.image.blind", { model: manifest.model })}</span>
                </span>
              )}
            </>
          )}
        </dd>
        {/* After the answer (plan P9-2): the notes the run's tools read, by the version a tool was given. */}
        {snapshot && snapshot.read.length > 0 && (
          <>
            <dt>{t("ai.snapshot.read")}</dt>
            <dd data-testid="ai-snapshot-read">
              <ul className="pv-ai-overview-sources">
                {snapshot.read.slice(0, SNAPSHOT_READ_SHOWN).map((note) => (
                  <li key={note.path}>
                    {onOpenNote ? (
                      <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenNote(note.path)}>
                        {note.title}
                      </Button>
                    ) : (
                      <span className="pv-ai-overview-note">{note.title}</span>
                    )}
                    <span className="pv-ai-overview-form">{note.hash ? versionText(note.hash) : t("ai.snapshot.readHit")}</span>
                    {note.hash && versionChip(snapshot.states?.read[note.path])}
                  </li>
                ))}
              </ul>
              {snapshot.read.length > SNAPSHOT_READ_SHOWN && <span className="pv-ai-overview-hint">{t("ai.snapshot.readMore", { count: snapshot.read.length - SNAPSHOT_READ_SHOWN })}</span>}
              {snapshot.readMore && <span className="pv-ai-overview-hint">{t("ai.snapshot.readBeyond")}</span>}
            </dd>
          </>
        )}
        {(standing || preview) && manifest.folders.length > 0 && (
          <>
            <dt>{t("ai.overview.folders")}</dt>
            <dd data-testid="ai-overview-folders">{manifest.folders.map((folder) => folder || "/").join(" · ")}</dd>
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
        {memoryLine && (
          <>
            <dt>{t("ai.overview.memory")}</dt>
            <dd data-testid="ai-overview-memory">{memoryLine}</dd>
          </>
        )}
        {style && (
          <>
            <dt>{t("ai.style.title")}</dt>
            <dd data-testid="ai-overview-style">
              {[t("ai.style.featuresCount", { count: style.features }), t("ai.style.examplesCount", { count: style.examples })].join(" · ")}
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
        {/* After the answer (plan P9-2): the version of each skill the run used, and whether it is still that one. */}
        {snapshot && snapshot.skills.length > 0 && (
          <>
            <dt>{t("ai.snapshot.skills")}</dt>
            <dd data-testid="ai-snapshot-skills">
              <ul className="pv-ai-overview-sources">
                {snapshot.skills.map((skill) => (
                  <li key={skill.id}>
                    <span className="pv-ai-overview-note">{skillTitle(skill.id, skill.name)}</span>
                    <span className="pv-ai-overview-form">{versionText(skill.hash)}</span>
                    {versionChip(snapshot.states?.skills[skill.id])}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {shownTools.length > 0 && (
          <>
            <dt>{t("ai.overview.tools")}</dt>
            <dd>{shownTools.map(toolWord).join(" · ")}</dd>
          </>
        )}
        {/* After the answer (plan P9-2): the tools the run called, and how often. */}
        {snapshot && snapshot.tools.length > 0 && (
          <>
            <dt>{t("ai.snapshot.used")}</dt>
            <dd data-testid="ai-snapshot-used">{snapshot.tools.map((tool) => t("ai.snapshot.toolCount", { tool: toolWord(tool.name), count: tool.count })).join(" · ")}</dd>
          </>
        )}
        {/* What the tool search reaches (ADR 0019): in the conversation's reach, but not approved here — each kind asks first. */}
        {furtherLines.length > 0 && (
          <>
            <dt>{t("ai.overview.further")}</dt>
            <dd data-testid="ai-overview-further">{furtherLines.join(" · ")}</dd>
          </>
        )}
        {/* Before sending: that the conversation may use the internet, and for which sites it will not ask. */}
        {manifest.web && asking && (
          <>
            <dt>{t("ai.overview.web")}</dt>
            <dd data-testid="ai-overview-web">
              {t("ai.overview.webOn")}
              {manifest.webHosts && manifest.webHosts.length > 0 && <span className="pv-ai-overview-hint">{t("ai.overview.webHosts", { hosts: manifest.webHosts.join(", ") })}</span>}
            </dd>
          </>
        )}
        {/* Afterwards: what was asked for — whether it gave a page or not, it left the device. */}
        {web && web.pages.length > 0 && (
          <>
            <dt>{t("ai.overview.webPages")}</dt>
            <dd data-testid="ai-overview-web-pages">
              <ul className="pv-ai-overview-sources">
                {web.pages.map((page, index) => (
                  <li key={`${index}:${page.url}`}>
                    {onOpenUrl ? (
                      <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenUrl(page.url)}>
                        {shortAddress(page.url)}
                      </Button>
                    ) : (
                      <span className="pv-ai-overview-note">{shortAddress(page.url)}</span>
                    )}
                    {!page.read && <span className="pv-ai-overview-form">{t("ai.overview.webNotRead")}</span>}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {web && web.searches.length > 0 && (
          <>
            <dt>{t("ai.overview.webSearches")}</dt>
            <dd data-testid="ai-overview-web-searches">{web.searches.map((search) => search.query).join(" · ")}</dd>
          </>
        )}
        {/* Afterwards: what the run read of mail and appointments — in numbers — and who read the raw text. */}
        {readingLines.length > 0 && reading && (
          <>
            <dt>{t("ai.overview.reading")}</dt>
            <dd data-testid="ai-overview-reading">
              {readingLines.join(" · ")}
              {reading.messages + reading.descriptions > 0 && (
                <span className="pv-ai-overview-hint">
                  {reading.reader === "device" ? t("ai.reading.byDevice", { reader: reading.readerModel ?? "" }) : t("ai.reading.byProvider", { provider: manifest.providerLabel })}
                </span>
              )}
            </dd>
          </>
        )}
        {/* Afterwards: what the run asked of foreign servers (plan P4.5) — who, what, how it ended; never what was said. */}
        {externalCalls && externalCalls.length > 0 && (
          <>
            <dt>{t("ai.ext.overviewCalls")}</dt>
            <dd data-testid="ai-overview-external">
              {externalCalls.map((line, index) => (
                <span key={index} className="pv-ai-overview-hint">
                  {line}
                </span>
              ))}
            </dd>
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
        {/* After the answer (plan P9-2): what the run left — the answer, and what waits for the user's decision. */}
        {snapshot && (
          <>
            <dt>{t("ai.snapshot.result")}</dt>
            <dd data-testid="ai-snapshot-result">
              {[
                t("ai.snapshot.resultAnswer"),
                snapshot.result.rounds ? t("ai.snapshot.resultRounds", { count: snapshot.result.rounds }) : "",
                snapshot.result.drafts ? t("ai.snapshot.resultDrafts", { count: snapshot.result.drafts }) : "",
                snapshot.result.plans ? t("ai.snapshot.resultPlans", { count: snapshot.result.plans }) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </>
        )}
      </dl>
      {/* The same question to another model (plan P9-2): a new conversation with the same notes, through the send overview. */}
      {snapshot && (
        <div className="pv-ai-overview-actions" data-testid="ai-snapshot-replay">
          {"refused" in snapshot.replay ? (
            <span className="pv-ai-overview-hint" data-testid="ai-snapshot-replay-refused">
              {t(`ai.snapshot.refused.${snapshot.replay.refused}`)}
            </span>
          ) : snapshot.replay.choices.length === 0 ? (
            <span className="pv-ai-overview-hint">{t("ai.snapshot.replayNone")}</span>
          ) : (
            <>
              <span className="pv-ai-overview-hint">
                {t("ai.snapshot.replayHint")}
                {changedSources(snapshot) > 0 ? ` ${t("ai.snapshot.replayChanged", { count: changedSources(snapshot) })}` : ""}
              </span>
              <Button ref={replayButton} size="sm" variant="secondary" onClick={() => setReplayOpen(true)} aria-haspopup="menu" data-testid="ai-snapshot-replay-open">
                <ArrowLeftRight size={ICON.meta} aria-hidden="true" />
                {t("ai.snapshot.replay")}
              </Button>
              <MenuSurface open={replayOpen} onClose={() => setReplayOpen(false)} anchorRef={replayButton} ariaLabel={t("ai.snapshot.replayMenu")}>
                {snapshot.replay.choices.map((option) => (
                  <MenuItem key={option.key} hint={option.hint} onSelect={() => (snapshot.replay as { onReplay(choice: ModelChoice): void }).onReplay(option.choice)}>
                    {option.label}
                  </MenuItem>
                ))}
              </MenuSurface>
            </>
          )}
        </div>
      )}
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
