import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstructionEntry, WriteDraft } from "@plainva/core";
import { toast } from "../services/toastStore";
import { AiDraftCard, AiDraftDone, machineAuthorLabel, useDraftActions } from "./AiWriteCards";
import type { LearnOutcome, LearnPlanOutcome } from "./aiLearn";
import type { AiSession, AiState, SkillTestPlan } from "./aiSession";
import { skillDraftChange, skillDraftFacts, skillDraftRefusalText, skillRestoreRefusalText, skillVersionFacts, type SkillDraftFacts, type SkillVersionFacts } from "./learnView";

/**
 * Learning's dialogs, as far as both shells share them (plan KI-Harness
 * P6-2, mockup chapter 22): what each of them does, as hooks, and the list
 * of drafts a review laid down. The desktop puts them in a `Modal`, the
 * phone in a sheet.
 */

/**
 * "Learn from this conversation": first what would go where — nothing is
 * sent by looking —, then the review itself, started by the user, and what
 * came back. One conversation per mount: the shell keys the dialog by it.
 */
export function useLearnFlow(session: AiSession, conversationId: string) {
  const [plan, setPlan] = useState<LearnPlanOutcome | null>(null);
  const [outcome, setOutcome] = useState<LearnOutcome | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let alive = true;
    void session.learnPlan(conversationId).then((next) => {
      if (alive) setPlan(next);
    });
    return () => {
      alive = false;
    };
  }, [session, conversationId]);
  const start = () => {
    setRunning(true);
    void session
      .learnFrom(conversationId)
      .then(setOutcome)
      .finally(() => setRunning(false));
  };
  return { plan, outcome, running, start, stop: () => session.stopLearning() };
}

/** The drafts a review laid down, in the order it proposed them: each waiting with its card, or with what became of it. */
export function LearnDrafts({ session, state, ids, onOpenNote, touch }: { session: AiSession; state: AiState; ids: readonly string[]; onOpenNote(path: string): void; touch?: boolean }) {
  const actions = useDraftActions(session, onOpenNote);
  return (
    <div className="pv-ai-open" data-testid="ai-learn-drafts">
      {ids.map((id) => {
        const waiting = state.drafts.drafts.find((draft) => draft.id === id);
        if (waiting) return <AiDraftCard key={id} draft={waiting} canCreate={actions.canCreate} busy={actions.busy} onCreate={actions.create} onDiscard={actions.discard} taskList={actions.taskList} touch={touch} />;
        const done = state.drafts.done.find((entry) => entry.id === id);
        return done ? <AiDraftDone key={id} outcome={done} onOpenNote={onOpenNote} /> : null;
      })}
    </div>
  );
}

/**
 * A skill's draft under review: what it would change, in words, and the two
 * things the user can do with it — rework its instructions here, then take
 * it over or discard it. `facts` is null once the draft is gone: taken over,
 * discarded, or never there.
 */
export function useSkillDraftReview(session: AiSession, state: AiState, draftId: string, onClose: () => void) {
  const { t, i18n } = useTranslation();
  const draft: WriteDraft | null = state.drafts.drafts.find((candidate) => candidate.id === draftId) ?? null;
  const [plan, setPlan] = useState<SkillTestPlan | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // What its last check says is about one model: the plan names it.
    void session.skillTestPlan().then((next) => {
      if (alive) setPlan(next);
    });
    return () => {
      alive = false;
    };
  }, [session]);
  const facts: SkillDraftFacts | null = draft
    ? skillDraftFacts(
        t,
        draft,
        {
          entries: state.skills.entries,
          records: state.skillTests.records,
          plan,
          conversation: draft.conversationId ? (state.summaries.find((summary) => summary.id === draft.conversationId)?.title ?? null) : null,
          author: machineAuthorLabel(t, draft.author.id, draft.author.label),
        },
        i18n.language,
      )
    : null;
  const body = edited ?? facts?.body ?? "";
  const change = facts ? skillDraftChange(t, facts, body, i18n.language) : null;
  const take = () => {
    if (!draft) return;
    setBusy(true);
    void session
      .createDraft(draft.id, edited !== null ? { body: edited } : {})
      .then((outcome) => {
        if (outcome.kind === "kept") {
          toast.success(t("ai.learn.done.skill"));
          onClose();
        } else if (outcome.kind === "refused") setRefusal(skillDraftRefusalText(t, outcome.reason) ?? t(outcome.reason === "unavailable" ? "ai.write.draft.unavailable" : "ai.learn.restoreRefused.failed"));
      })
      .finally(() => setBusy(false));
  };
  const discard = () => {
    if (!draft) return;
    void session.discardDraft(draft.id).then(onClose);
  };
  return {
    draft,
    facts,
    change,
    body,
    /** The instructions are being reworked: the field is shown in place of the comparison. What was typed stays when the comparison comes back. */
    editing,
    rework: () => {
      setEdited(body);
      setEditing(true);
    },
    compare: () => setEditing(false),
    setBody: setEdited,
    busy,
    refusal,
    canTake: Boolean(facts && !facts.blocked && body.trim()) && !busy,
    take,
    discard,
  };
}

/** One earlier version of a skill as the dialog lists it. */
export interface SkillVersionChoice {
  id: string;
  at: number;
}

/**
 * A skill's earlier versions: the list the vault keeps, the one that is
 * chosen held against the skill as it is now, and the way back. `versions`
 * is null while they are looked up, and stays null where the vault keeps no
 * history at all (`none`).
 */
export function useSkillVersions(session: AiSession, entry: InstructionEntry | null, onClose: () => void) {
  const { t, i18n } = useTranslation();
  const id = entry?.source.id ?? null;
  const [versions, setVersions] = useState<SkillVersionChoice[] | null>(null);
  const [none, setNone] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; text: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void session.skillVersions(id).then((list) => {
      if (!alive) return;
      setNone(list === null);
      setVersions(list ?? []);
      // The newest one is what most people came for: shown at once, against the skill as it is now.
      const newest = list?.[0];
      if (!newest) return;
      setChosen({ id: newest.id, text: null });
      void session.readSkillVersion(id, newest.id).then((text) => {
        if (alive) setChosen((current) => (current?.id === newest.id ? { id: newest.id, text: text ?? "" } : current));
      });
    });
    return () => {
      alive = false;
    };
  }, [session, id]);
  const choose = (version: string) => {
    if (!id) return;
    setRefusal(null);
    setChosen({ id: version, text: null });
    void session.readSkillVersion(id, version).then((text) => {
      setChosen((current) => (current?.id === version ? { id: version, text: text ?? "" } : current));
    });
  };
  const facts: SkillVersionFacts | null = entry && chosen && chosen.text !== null ? skillVersionFacts(t, entry, chosen.text, i18n.language) : null;
  const restore = () => {
    if (!id || !chosen || chosen.text === null) return;
    setBusy(true);
    void session
      .restoreSkillVersion(id, chosen.id, chosen.text)
      .then((outcome) => {
        if (outcome.ok) {
          toast.success(t("ai.learn.versions.restored"));
          onClose();
        } else setRefusal(skillRestoreRefusalText(t, outcome));
      })
      .finally(() => setBusy(false));
  };
  return {
    versions,
    none,
    chosen: chosen?.id ?? null,
    /** The chosen version's text, for where the comparison is too large to draw; null while it is read. */
    text: chosen?.text ?? null,
    facts,
    choose,
    busy,
    refusal,
    canRestore: Boolean(facts && !facts.blocked && !facts.same) && !busy,
    restore,
  };
}
