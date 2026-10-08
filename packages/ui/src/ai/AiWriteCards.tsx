import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, Check, Database, EyeOff, FilePlus2, ListChecks, Mail, NotebookPen, PencilLine, TriangleAlert, Unlink, X } from "lucide-react";
import { machineAuthorKind, machineAuthorSubject, type RunWrites, type WriteDraft, type WriteDraftOutcome } from "@plainva/core";
import { LineCompare } from "../components/LineCompare";
import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { cx } from "../components/ui/cx";
import { EmptyState } from "../components/ui/EmptyState";
import { ICON } from "../lib/iconSizes";
import { propertyValueWords } from "../lib/propertySuggestion";
import { toast } from "../services/toastStore";
import type { AiSession } from "./aiSession";
import { draftDetail, type OpenProposal, type WriteDraftState } from "./aiWrites";

/**
 * What an assistant laid down, where the user decides about it (plan
 * KI-Harness P5, mockup chapter 20): under an answer the line that says
 * which note carries a proposal, and a card per draft; in the AI tab the list
 * of everything that waits.
 *
 * Built from the send overview's parts — it is the same kind of surface: the
 * app saying what a run did, with the user's own buttons beside it.
 */

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** The properties a drafted entry's card names; the rest is a count. */
const DRAFT_PROPERTIES_SHOWN = 8;

/**
 * The names the source check found no note for — or a note the writer may not read —, as a hint line says them:
 * the first few, and that there are more. Shown to the user only; no model is sent what a card says.
 */
const MISSING_NAMES_SHOWN = 6;
const missingNames = (names: readonly string[]) => `${names.slice(0, MISSING_NAMES_SHOWN).join(", ")}${names.length > MISSING_NAMES_SHOWN ? ", …" : ""}`;

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * "Create" and "Discard" on a draft, for every place that shows one: the
 * session makes the thing, this says how it went and opens what was made.
 */
export function useDraftActions(session: Pick<AiSession, "createDraft" | "discardDraft" | "canCreateDrafts" | "draftTaskList"> | null, onOpenCreated: (path: string) => void) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  // The provider list a task can also be created in: asked once per surface, like the capture bar does.
  const [taskList, setTaskList] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    void session.draftTaskList().then((name) => {
      if (alive) setTaskList(name);
    });
    return () => {
      alive = false;
    };
  }, [session]);
  const create = (id: string, atProvider = false) => {
    if (!session) return;
    setBusy(id);
    void session
      .createDraft(id, { atProvider })
      .then((outcome) => {
        // "Opened": the composer or the event editor is in front of the user now, and says itself what it is.
        if (outcome.kind === "opened") return;
        if (outcome.kind === "created") {
          toast.success(t("ai.write.draft.createdToast"));
          onOpenCreated(outcome.path);
        } else if (outcome.reason === "failed") toast.error(t("ai.write.draft.failed", { reason: outcome.message ?? "" }));
        else if (outcome.reason === "unavailable") toast.error(t("ai.write.draft.unavailable"));
        else if (outcome.reason === "exists") toast.error(t("ai.write.draft.exists"));
        else if (outcome.reason === "editor-open") toast.warning(t("ai.write.draft.editorOpen"));
        // The calendar's own words for it: the same sentence "New event" says where there is none.
        else if (outcome.reason === "no-calendar") toast.warning(t("pim.noWritableCalendar"));
        else if (outcome.reason === "no-entry-folder") toast.error(t("ai.write.draft.noEntryFolder"));
      })
      .finally(() => setBusy(null));
  };
  const discard = (id: string) => void session?.discardDraft(id);
  return { busy: busy !== null, canCreate: Boolean(session?.canCreateDrafts()), create, discard, taskList };
}

/** Who wrote something, as the user knows them: the assistant by its model; a script by its name; a program or an agent by what its id names. */
export function machineAuthorLabel(t: Translate, authorId: string, fallback?: string): string {
  const kind = machineAuthorKind(authorId);
  const subject = machineAuthorSubject(authorId) ?? authorId;
  if (kind === "assistant") return t("ai.suggestionAuthor", { model: subject });
  // A script is named by the words it was laid down with (its title), else by its folder — always as "Script …".
  if (kind === "script") return fallback?.trim() || t("ai.scripts.author", { name: subject });
  return fallback?.trim() || subject;
}

export interface AiDraftCardProps {
  draft: WriteDraft;
  /** Whether this shell can make what the draft describes. */
  canCreate: boolean;
  busy: boolean;
  /** `atProvider`: a task is also created in its provider list — only said where the card offered that and it stayed on. */
  onCreate(id: string, atProvider?: boolean): void;
  onDiscard(id: string): void;
  /** Says who wrote it — in the list of everything that waits, where drafts of several writers stand together. */
  showAuthor?: boolean;
  /** The provider list a task can also be created in, by its name; null or absent where there is none. */
  taskList?: string | null;
  touch?: boolean;
}

/** A draft that waits: what it would become, and the two things the user can do with it. */
export function AiDraftCard({ draft, canCreate, busy, onCreate, onDiscard, showAuthor, taskList, touch }: AiDraftCardProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  // Starts on, as on the capture field: choosing a list for the database already was the decision,
  // and the chip is there so a single task can stay in the vault.
  const [atProvider, setAtProvider] = useState(true);
  const body = draft.body;
  const offersList = body.kind === "task" && Boolean(taskList);
  const Icon = body.kind === "task" ? ListChecks : body.kind === "journal" ? NotebookPen : body.kind === "entry" ? Database : body.kind === "mail" ? Mail : body.kind === "event" ? CalendarPlus : FilePlus2;
  const detail = draftDetail(draft);
  // An e-mail and an appointment reach other people (plan P5-6): the card names every one of them in full, says which
  // of them the user did not write in the conversation themselves, and its button makes nothing — it opens the app's
  // own composer or event editor, where sending and saving are the user's.
  const outgoing = body.kind === "mail" || body.kind === "event";
  const unnamed = outgoing ? body.unnamed : [];
  // What a drafted entry would have: said on the card, since "Create" writes exactly that (plan P5-4).
  const properties = body.kind === "entry" ? Object.entries(body.properties) : [];
  const day = (key: string) => {
    const date = new Date(`${key}T12:00:00`);
    return Number.isNaN(date.getTime()) ? key : new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" }).format(date);
  };
  const preview = body.kind === "note" || body.kind === "entry" ? body.content.trim() : body.kind === "mail" ? body.body.trim() : body.kind === "event" ? body.description.trim() : "";
  // "Thu, 14 May · 09:00–17:00", or the days of an all-day appointment.
  const eventWhen = body.kind !== "event" ? "" : body.allDay ? (body.endDay === body.day ? `${day(body.day)} · ${t("ai.write.draft.allDay")}` : `${day(body.day)} – ${day(body.endDay)} · ${t("ai.write.draft.allDay")}`) : `${day(body.day)} · ${body.start}–${body.end}`;
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--draft", touch && "pv-ai-overview--touch")} aria-label={`${t(`ai.write.draft.kind.${body.kind}`)}: ${draft.title}`} data-testid="ai-draft" data-kind={body.kind} data-draft={draft.id}>
      <h4 className="pv-ai-overview-head">
        <Icon size={ICON.ui} aria-hidden="true" />
        <span>{t(`ai.write.draft.kind.${body.kind}`)}</span>
      </h4>
      <dl className="pv-ai-overview-list">
        <dt>{t(`ai.write.draft.what.${body.kind}`)}</dt>
        <dd data-testid="ai-draft-title">{body.kind === "journal" ? body.text : draft.title}</dd>
        {"folder" in detail && (
          <>
            <dt>{t("ai.write.draft.landsIn")}</dt>
            {/* No folder named: the vault's inbox. A file its writer named at the vault's top level lies in no folder. */}
            <dd data-testid="ai-draft-place">{detail.folder === "" ? t("ai.write.plan.vaultRoot") : (detail.folder ?? t("ai.write.draft.inbox"))}</dd>
          </>
        )}
        {"day" in detail && (
          <>
            <dt>{t(body.kind === "task" ? "ai.write.draft.readFrom" : "ai.write.draft.day")}</dt>
            <dd>{detail.time ? `${day(detail.day)} · ${detail.time}` : day(detail.day)}</dd>
          </>
        )}
        {"base" in detail && (
          <>
            <dt>{t("ai.write.draft.database")}</dt>
            <dd data-testid="ai-draft-base">{noteName(detail.base).replace(/\.base$/i, "")}</dd>
            {properties.slice(0, DRAFT_PROPERTIES_SHOWN).map(([key, value]) => (
              <Fragment key={key}>
                {/* A property's name is the database's own word, not one of Plainva's. */}
                <dt>{key}</dt>
                <dd data-testid="ai-draft-property">{propertyValueWords(value)}</dd>
              </Fragment>
            ))}
          </>
        )}
        {body.kind === "task" && body.text !== draft.title && (
          <>
            <dt>{t("ai.write.draft.words")}</dt>
            <dd>{body.text}</dd>
          </>
        )}
        {body.kind === "mail" &&
          (["to", "cc", "bcc"] as const).map((field) =>
            body[field].length > 0 ? (
              <Fragment key={field}>
                <dt>{t(`ai.write.draft.${field}`)}</dt>
                {/* Every recipient, in full: this is where the mail would go. */}
                <dd data-testid={`ai-draft-${field}`}>{body[field].join(", ")}</dd>
              </Fragment>
            ) : null,
          )}
        {body.kind === "event" && (
          <>
            <dt>{t("ai.write.draft.when")}</dt>
            <dd data-testid="ai-draft-when">{eventWhen}</dd>
            {body.location && (
              <>
                <dt>{t("ai.write.draft.where")}</dt>
                <dd data-testid="ai-draft-where">{body.location}</dd>
              </>
            )}
            {body.attendees.length > 0 && (
              <>
                <dt>{t("ai.write.draft.attendees")}</dt>
                <dd data-testid="ai-draft-attendees">{body.attendees.join(", ")}</dd>
              </>
            )}
          </>
        )}
        {showAuthor && (
          <>
            <dt>{t("ai.write.draft.by")}</dt>
            <dd data-testid="ai-draft-author">{machineAuthorLabel(t, draft.author.id, draft.author.label)}</dd>
          </>
        )}
      </dl>
      {properties.length > DRAFT_PROPERTIES_SHOWN && (
        <span className="pv-ai-overview-hint" data-testid="ai-draft-more">
          {t("ai.write.draft.moreProperties", { count: properties.length - DRAFT_PROPERTIES_SHOWN })}
        </span>
      )}
      {draft.inherited.length > 0 && (body.kind === "note" || body.kind === "entry") && <span className="pv-ai-overview-hint">{t("ai.write.draft.inherits")}</span>}
      {unnamed.length > 0 && (
        // Where a mail goes and whom a provider invites is the one thing on this card a stranger's text could have chosen.
        <span className="pv-ai-effect-warn" data-testid="ai-draft-unnamed">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t(body.kind === "event" ? "ai.write.draft.unnamedEvent" : "ai.write.draft.unnamedMail", { count: unnamed.length, addresses: unnamed.join(", ") })}</span>
        </span>
      )}
      {outgoing && <span className="pv-ai-overview-hint">{t(body.kind === "mail" ? "ai.write.draft.mailHint" : "ai.write.draft.eventHint")}</span>}
      {draft.defused > 0 && <span className="pv-ai-overview-hint">{t("ai.write.draft.defused")}</span>}
      {/* The source check (plan P5-7): a link in the draft's text that led to no note when it was laid down — and
          one that led to a note the writer may not read, which is another thing to know about a text. */}
      {draft.missing && draft.missing.length > 0 && (
        <span className="pv-ai-overview-hint" data-testid="ai-draft-missing">
          {t("ai.write.missingLinks", { names: missingNames(draft.missing) })}
        </span>
      )}
      {draft.withheld && draft.withheld.length > 0 && (
        <span className="pv-ai-overview-hint" data-testid="ai-draft-withheld">
          {t("ai.write.withheldLinks", { names: missingNames(draft.withheld) })}
        </span>
      )}
      {offersList && (
        // The one thing "Create" would send out of the vault: said on the card, in the capture field's own words, and the user's to switch off.
        <div className="pv-capture-quick">
          <Chip testId="ai-draft-provider" selected={atProvider} disabled={busy} onClick={() => setAtProvider((on) => !on)}>
            {t("tasks.alsoCreateAt", { list: taskList })}
          </Chip>
        </div>
      )}
      {open && preview && <LineCompare lines={null} fallback={preview} testId="ai-draft-text" />}
      <div className="pv-ai-overview-actions">
        {preview && (
          <Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="ai-draft-show">
            {t(open ? "ai.write.draft.hide" : "ai.write.draft.show")}
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => onDiscard(draft.id)} data-testid="ai-draft-discard">
          {t("ai.write.draft.discard")}
        </Button>
        <Button variant="secondary" disabled={busy || !canCreate} onClick={() => onCreate(draft.id, offersList && atProvider)} data-testid="ai-draft-create">
          {t(body.kind === "mail" ? "ai.write.draft.openMail" : body.kind === "event" ? "ai.write.draft.openEvent" : "ai.write.draft.create")}
        </Button>
      </div>
    </section>
  );
}

/** What became of a draft, in one line: created (with the way to it) or discarded. */
export function AiDraftDone({ outcome, onOpenNote }: { outcome: WriteDraftOutcome; onOpenNote(path: string): void }) {
  const { t } = useTranslation();
  // A mail and an appointment end where the user took the step in the app's own editor: sent, saved — or, for a mail
  // whose composer moved to a window of its own, out of this list's sight.
  const created = outcome.outcome !== "discarded";
  const path = outcome.path;
  const name = outcome.title;
  const text =
    outcome.outcome === "sent"
      ? t("ai.write.draft.done.sent", { name })
      : outcome.outcome === "saved"
        ? t(outcome.kind === "event" ? "ai.write.draft.done.savedEvent" : "ai.write.draft.done.savedMail", { name })
        : outcome.outcome === "opened"
          ? t("ai.write.draft.done.movedMail", { name })
          : t(created ? "ai.write.draft.created" : "ai.write.draft.discarded", { name });
  return created && path ? (
    <Button size="sm" variant="ghost" className="pv-ai-runline pv-ai-capture" onClick={() => onOpenNote(path)} data-testid="ai-draft-done" data-outcome="created">
      <Check size={ICON.meta} aria-hidden="true" />
      {text}
    </Button>
  ) : (
    <span className="pv-ai-runline pv-ai-capture" data-testid="ai-draft-done" data-outcome={outcome.outcome}>
      {created ? <Check size={ICON.meta} aria-hidden="true" /> : <X size={ICON.meta} aria-hidden="true" />}
      {text}
    </span>
  );
}

export interface AiRunWritesProps {
  writes: RunWrites;
  state: WriteDraftState;
  canCreate: boolean;
  busy: boolean;
  onOpenNote(path: string): void;
  onCreate(id: string, atProvider?: boolean): void;
  onDiscard(id: string): void;
  taskList?: string | null;
  touch?: boolean;
}

/** Under an answer: the notes its run laid a proposal on, and its drafts — waiting, created or discarded. */
export function AiRunWrites({ writes, state, canCreate, busy, onOpenNote, onCreate, onDiscard, taskList, touch }: AiRunWritesProps) {
  const { t } = useTranslation();
  return (
    <>
      {writes.rounds.map((round) => {
        const what = [round.blocks ? t("ai.write.passages", { count: round.blocks }) : "", round.properties ? t("ai.write.properties", { count: round.properties }) : ""].filter(Boolean).join(", ");
        return (
          <Fragment key={round.path}>
            <Button size="sm" variant="ghost" className="pv-ai-runline pv-ai-capture" onClick={() => onOpenNote(round.path)} data-testid="ai-proposed" data-path={round.path}>
              <PencilLine size={ICON.meta} aria-hidden="true" />
              {t("ai.write.proposedIn", { name: noteName(round.path), what })}
            </Button>
            {/* The source check (plan P5-7): what the suggestion links to that the vault did not have. */}
            {round.missing && round.missing.length > 0 && (
              <span className="pv-ai-runline pv-ai-capture pv-ai-runline--below" data-testid="ai-proposed-missing">
                <Unlink size={ICON.meta} aria-hidden="true" />
                {t("ai.write.missingLinks", { names: missingNames(round.missing) })}
              </span>
            )}
            {round.withheld && round.withheld.length > 0 && (
              <span className="pv-ai-runline pv-ai-capture pv-ai-runline--below" data-testid="ai-proposed-withheld">
                <EyeOff size={ICON.meta} aria-hidden="true" />
                {t("ai.write.withheldLinks", { names: missingNames(round.withheld) })}
              </span>
            )}
          </Fragment>
        );
      })}
      {writes.drafts.map((entry) => {
        const waiting = state.drafts.find((draft) => draft.id === entry.id);
        if (waiting) return <AiDraftCard key={entry.id} draft={waiting} canCreate={canCreate} busy={busy} onCreate={onCreate} onDiscard={onDiscard} taskList={taskList} touch={touch} />;
        const done = state.done.find((outcome) => outcome.id === entry.id);
        // Neither waiting nor decided here: laid down on another device, or long ago. Nothing is claimed about it.
        return done ? <AiDraftDone key={entry.id} outcome={done} onOpenNote={onOpenNote} /> : null;
      })}
    </>
  );
}

/** Posting, accepting or declining a suggestion anywhere changes what waits. */
const COMMENTS_CHANGED_EVENT = "plainva-workspace-comments-changed";

/**
 * The notes that carry open proposals of a machine, looked up when a surface
 * shows them and again whenever the vault's comments change; null until the
 * first answer.
 */
export function useOpenProposals(session: Pick<AiSession, "openProposals"> | null): readonly OpenProposal[] | null {
  const [proposals, setProposals] = useState<readonly OpenProposal[] | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const load = () => {
      void session.openProposals().then((list) => {
        if (alive) setProposals(list);
      });
    };
    load();
    window.addEventListener(COMMENTS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(COMMENTS_CHANGED_EVENT, load);
    };
  }, [session]);
  return proposals;
}

/** How many things wait: the drafts of this device and the notes with a machine's open proposals. For a segment's label. */
export function openWritesCount(state: WriteDraftState, proposals: readonly OpenProposal[] | null): number {
  return state.drafts.length + (proposals?.length ?? 0);
}

/**
 * The list of everything that waits, with the session behind it: what the AI
 * tab and the phone's history screen show under "Open". The session is
 * handed in — the phone's screens hold theirs directly.
 */
export function AiOpenPanel({
  session,
  state,
  proposals,
  onOpenNote,
  onOpenCreated,
  touch,
}: {
  session: Pick<AiSession, "createDraft" | "discardDraft" | "canCreateDrafts" | "draftTaskList">;
  state: WriteDraftState;
  proposals: readonly OpenProposal[] | null;
  onOpenNote(path: string): void;
  onOpenCreated?: (path: string) => void;
  touch?: boolean;
}) {
  const actions = useDraftActions(session, onOpenCreated ?? onOpenNote);
  return (
    <AiOpenWrites
      state={state}
      proposals={proposals}
      canCreate={actions.canCreate}
      busy={actions.busy}
      onOpenNote={onOpenNote}
      onCreate={actions.create}
      onDiscard={actions.discard}
      taskList={actions.taskList}
      touch={touch}
    />
  );
}

export interface AiOpenWritesProps {
  state: WriteDraftState;
  /** The notes that carry open proposals of a machine; null while they are being looked up. */
  proposals: readonly OpenProposal[] | null;
  canCreate: boolean;
  busy: boolean;
  onOpenNote(path: string): void;
  onCreate(id: string, atProvider?: boolean): void;
  onDiscard(id: string): void;
  taskList?: string | null;
  touch?: boolean;
}

/** Everything that waits for the user, whoever laid it down: the proposals on notes, and the drafts of this device. */
export function AiOpenWrites({ state, proposals, canCreate, busy, onOpenNote, onCreate, onDiscard, taskList, touch }: AiOpenWritesProps) {
  const { t, i18n } = useTranslation();
  const when = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(date);
  };
  if (state.drafts.length === 0 && proposals !== null && proposals.length === 0) {
    return (
      <div data-testid="ai-open-empty">
        <EmptyState icon={<PencilLine size={ICON.empty} aria-hidden="true" />} title={t("ai.write.open.empty")}>
          {t("ai.write.open.emptyHint")}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="pv-ai-open" data-testid="ai-open">
      {proposals !== null && proposals.length > 0 && (
        <section className={cx("pv-ai-overview", touch && "pv-ai-overview--touch")} aria-label={t("ai.write.open.proposals")}>
          <h4 className="pv-ai-overview-head">
            <PencilLine size={ICON.ui} aria-hidden="true" />
            <span>{t("ai.write.open.proposals")}</span>
          </h4>
          <ul className="pv-ai-overview-sources" data-testid="ai-open-proposals">
            {proposals.map((proposal) => (
              <li key={`${proposal.path}:${proposal.authorId}`}>
                <Button size="sm" variant="ghost" className="pv-ai-overview-note" onClick={() => onOpenNote(proposal.path)} data-testid="ai-open-proposal">
                  {noteName(proposal.path)}
                </Button>
                <span className="pv-ai-overview-form">
                  {[t("ai.write.open.changes", { count: proposal.changes }), machineAuthorLabel(t, proposal.authorId, proposal.authorLabel), when(proposal.at)].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {state.drafts.map((draft) => (
        <AiDraftCard key={draft.id} draft={draft} canCreate={canCreate} busy={busy} onCreate={onCreate} onDiscard={onDiscard} showAuthor taskList={taskList} touch={touch} />
      ))}
      <span className="pv-ai-overview-hint">{t("ai.write.open.hint")}</span>
    </div>
  );
}
