import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Database, FilePlus2, ListChecks, NotebookPen, PencilLine, X } from "lucide-react";
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
        if (outcome.kind === "created") {
          toast.success(t("ai.write.draft.createdToast"));
          onOpenCreated(outcome.path);
        } else if (outcome.reason === "failed") toast.error(t("ai.write.draft.failed", { reason: outcome.message ?? "" }));
        else if (outcome.reason === "unavailable") toast.error(t("ai.write.draft.unavailable"));
        else if (outcome.reason === "no-entry-folder") toast.error(t("ai.write.draft.noEntryFolder"));
      })
      .finally(() => setBusy(null));
  };
  const discard = (id: string) => void session?.discardDraft(id);
  return { busy: busy !== null, canCreate: Boolean(session?.canCreateDrafts()), create, discard, taskList };
}

/** Who wrote something, as the user knows them: the assistant by its model; a program or an agent by what its id names. */
export function machineAuthorLabel(t: Translate, authorId: string, fallback?: string): string {
  const kind = machineAuthorKind(authorId);
  const subject = machineAuthorSubject(authorId) ?? authorId;
  if (kind === "assistant") return t("ai.suggestionAuthor", { model: subject });
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
  const Icon = body.kind === "task" ? ListChecks : body.kind === "journal" ? NotebookPen : body.kind === "entry" ? Database : FilePlus2;
  const detail = draftDetail(draft);
  // What a drafted entry would have: said on the card, since "Create" writes exactly that (plan P5-4).
  const properties = body.kind === "entry" ? Object.entries(body.properties) : [];
  const day = (key: string) => {
    const date = new Date(`${key}T12:00:00`);
    return Number.isNaN(date.getTime()) ? key : new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "short" }).format(date);
  };
  const preview = body.kind === "note" || body.kind === "entry" ? body.content.trim() : "";
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
            <dd>{detail.folder ?? t("ai.write.draft.inbox")}</dd>
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
      {draft.defused > 0 && <span className="pv-ai-overview-hint">{t("ai.write.draft.defused")}</span>}
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
          {t("ai.write.draft.create")}
        </Button>
      </div>
    </section>
  );
}

/** What became of a draft, in one line: created (with the way to it) or discarded. */
export function AiDraftDone({ outcome, onOpenNote }: { outcome: WriteDraftOutcome; onOpenNote(path: string): void }) {
  const { t } = useTranslation();
  const created = outcome.outcome === "created";
  const path = outcome.path;
  const text = t(created ? "ai.write.draft.created" : "ai.write.draft.discarded", { name: outcome.title });
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
          <Button key={round.path} size="sm" variant="ghost" className="pv-ai-runline pv-ai-capture" onClick={() => onOpenNote(round.path)} data-testid="ai-proposed" data-path={round.path}>
            <PencilLine size={ICON.meta} aria-hidden="true" />
            {t("ai.write.proposedIn", { name: noteName(round.path), what })}
          </Button>
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
