import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, CodeXml, Download, FlaskConical, Plus } from "lucide-react";
import { LEARN_LOG_FILE, type InstructionEntry, type SkillImport } from "@plainva/core";
import { Button, GroupCard, ICON, observedFailures, openLearnSurface, Row, RowList, SectionLabel, skillRestoreRefusalText, skillRowActions, skillRowDescription, skillTestOverview, skillTestPlanFor, skillView, Switch, toast, useSkillTestPlan, workshopSections, workshopTitle, type SkillRowCaps } from "@plainva/ui";
import { RowActionSheet } from "./RowActionSheet";
import { NewSkillSheet } from "./NewSkillSheet";
import { ScriptFormSheet } from "./ScriptFormSheet";
import { ScriptRunSheet } from "./ScriptRunSheet";
import { SkillApprovalSheet } from "./SkillApprovalSheet";
import { SkillImportSheet } from "./SkillImportSheet";
import { SkillTestSheet } from "./SkillTestSheet";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { pickSkillArchive } from "../services/ai/skillImport";
import { mConfirm } from "../services/mobileDialogs";

/**
 * The skills workshop on the phone (plan KI-Harness P3-5, mockup chapter 12):
 * the segment "Skills" of the AI screen — the desktop's lists in the phone's
 * grammar of group cards, the approval as a sheet. The model is shared
 * (`workshopSections`, `approvalFacts`); nothing here decides on its own.
 *
 * The vault's scripts (plan P5.5, mockup chapter 21) stand in the same
 * workshop, in a group of their own: a tap on one opens what it can do —
 * run it, see its code, change it in a form, revoke or delete it.
 */
export function MobileSkillsWorkshop({ onOpenNote, onRun, review }: { onOpenNote: (path: string) => void; onRun: () => void; review?: string | null }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [open, setOpen] = useState<string | null>(review ?? null);
  const [creating, setCreating] = useState(false);
  /** The script form: a new one (`id` null) or an existing one to change. */
  const [scriptForm, setScriptForm] = useState<{ id: string | null } | null>(null);
  /** The script whose run sheet is open. */
  const [running, setRunning] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ label: string; imported: SkillImport } | null>(null);
  const [sheet, setSheet] = useState<{ title: string; caps: SkillRowCaps } | null>(null);
  /** The regression run's sheet: for some skills, or (null) for all that bring scenarios. */
  const [testing, setTesting] = useState<{ ids: string[] | null } | null>(null);
  const plan = useSkillTestPlan(session, state);

  useEffect(() => {
    void session.refreshSkills();
  }, [session]);

  const sections = workshopSections(state.skills.entries);
  const titleOf = (entry: InstructionEntry) => workshopTitle(t, entry);
  const describe = (entry: InstructionEntry) => skillRowDescription(t, entry, state.skillTests.records, plan);
  const testable = (entry: InstructionEntry) => plan?.targets.some((target) => target.id === entry.source.id && target.scenarios > 0) === true;
  const overview = skillTestOverview(t, state.skillTests.records, plan, i18n.language);
  const mainPath = (entry: InstructionEntry) => (entry.source.kind === "agents" ? "AGENTS.md" : `${entry.source.root}/SKILL.md`);
  const remove = (entry: InstructionEntry, question: string) => {
    void mConfirm({ title: t(question, { title: titleOf(entry) }), message: t("ai.workshop.deleteBody"), danger: true, confirmLabel: t("ai.workshop.delete") }).then((ok) => {
      if (ok) void session.deleteInstruction(entry.source.id);
    });
  };
  const capsFor = (entry: InstructionEntry): SkillRowCaps => {
    if (entry.source.kind === "script") {
      const readable = Boolean(entry.source.script) && typeof entry.source.code === "string";
      return {
        ...(entry.status === "active" ? { run: () => setRunning(entry.source.id) } : {}),
        showInstructions: () => setOpen(entry.source.id),
        showLabel: t("ai.scripts.show"),
        ...(readable ? { edit: () => setScriptForm({ id: entry.source.id }) } : {}),
        ...(entry.approval ? { revoke: () => void session.revokeInstruction(entry.source.id) } : {}),
        delete: () => remove(entry, "ai.scripts.deleteConfirm"),
      };
    }
    const vault = entry.source.origin === "vault";
    return {
      ...(entry.status === "active" && entry.source.kind === "skill"
        ? {
            run: () => {
              const view = skillView(t, entry);
              onRun();
              void session.runSkill(view.id, view.start);
            },
          }
        : {}),
      ...(entry.status === "active" && entry.source.kind === "skill" && plan && testable(entry)
        ? { test: () => setTesting({ ids: [entry.source.id] }), testLabel: t("ai.workshop.test.run", { model: plan.choice.model }) }
        : {}),
      ...(!vault ? { showInstructions: () => setOpen(entry.source.id) } : {}),
      ...(vault ? { edit: () => onOpenNote(mainPath(entry)) } : {}),
      // What the vault's history keeps of a skill's file, and the way back (plan P6-2).
      ...(vault && entry.source.kind === "skill" ? { versions: () => openLearnSurface({ kind: "skill-versions", skillId: entry.source.id }) } : {}),
      ...(!vault && entry.source.kind === "skill"
        ? {
            copy: () => {
              void session.copyAppSkill(entry.source.id).then((result) => {
                if (result.ok) toast.success(t("ai.workshop.copied", { path: result.path }));
                else if (result.reason === "exists") toast.error(t("ai.workshop.importDialog.exists"));
              });
            },
          }
        : {}),
      ...(vault && entry.approval ? { revoke: () => void session.revokeInstruction(entry.source.id) } : {}),
      ...(vault ? { delete: () => remove(entry, "ai.workshop.deleteConfirm") } : {}),
    };
  };
  // A version that came from a proposal and had a run that failed (plan P6-2): the way back is offered, never taken.
  const failures = observedFailures(t, state.skills.entries);
  const goBack = (id: string) => {
    void session.revertObservedSkill(id).then((outcome) => {
      if (outcome.ok) toast.success(t("ai.learn.watch.backDone"));
      else toast.error(skillRestoreRefusalText(t, outcome));
    });
  };
  const switchRow = (entry: InstructionEntry) => (
    <Row
      key={entry.source.id}
      controls
      title={titleOf(entry)}
      subtitle={describe(entry)}
      onClick={() => setSheet({ title: titleOf(entry), caps: capsFor(entry) })}
      data-testid="ai-skill-row"
      end={<Switch checked={entry.status === "active"} label={t("ai.workshop.switchLabel", { title: titleOf(entry) })} onChange={(on) => void session.switchInstruction(entry.source.id, on)} />}
    />
  );

  return (
    <div className="m-settings" data-testid="ai-skills-workshop">
      <div className="m-skills-actions">
        <Button
          variant="secondary"
          icon={<Download size={ICON.ui} />}
          onClick={() => {
            void pickSkillArchive()
              .then((picked) => picked && setImporting(picked))
              .catch((error: unknown) => toast.error(t("ai.workshop.importDialog.failed", { message: error instanceof Error ? error.message : String(error) })));
          }}
          data-testid="ai-skills-import"
        >
          {t("ai.workshop.import")}
        </Button>
        <Button variant="secondary" icon={<CodeXml size={ICON.ui} />} disabled={!state.scripts.available} onClick={() => setScriptForm({ id: null })} data-testid="ai-scripts-new">
          {t("ai.scripts.new")}
        </Button>
        <Button variant="tonal" icon={<Plus size={ICON.ui} />} onClick={() => setCreating(true)} data-testid="ai-skills-new">
          {t("ai.workshop.newSkill")}
        </Button>
      </div>
      {failures.length > 0 && (
        <>
          <SectionLabel>{t("ai.learn.watch.title")}</SectionLabel>
          {failures.map((failure) => (
            <div key={failure.id} className="m-skill-watch" data-testid="ai-skill-watch">
              <p className="m-hint">{failure.text}</p>
              <div className="m-skills-actions">
                <Button variant="ghost" onClick={() => void session.keepObservedSkill(failure.id)} data-testid="ai-skill-watch-keep">
                  {t("ai.learn.watch.keep")}
                </Button>
                <Button variant="tonal" onClick={() => goBack(failure.id)} data-testid="ai-skill-watch-back">
                  {t("ai.learn.watch.back")}
                </Button>
              </div>
            </div>
          ))}
          <p className="m-hint">{t("ai.learn.watch.hint")}</p>
        </>
      )}
      {sections.waiting.length > 0 && (
        <>
          <SectionLabel>{t("ai.workshop.waiting")}</SectionLabel>
          <GroupCard>
            <RowList>
              {sections.waiting.map((entry) => (
                <Row key={entry.source.id} title={titleOf(entry)} subtitle={describe(entry)} onClick={() => setOpen(entry.source.id)} end={<ChevronRight size={ICON.ui} />} data-testid="ai-skill-review" />
              ))}
            </RowList>
          </GroupCard>
        </>
      )}
      {/* A group with nothing in it is a sentence on the page's edge, not a card: a card's edge belongs to its rows. */}
      <SectionLabel>{t("ai.workshop.own")}</SectionLabel>
      {sections.own.length === 0 ? (
        <p className="m-hint">{t("ai.workshop.noOwn")}</p>
      ) : (
        <GroupCard>
          <RowList>{sections.own.map(switchRow)}</RowList>
        </GroupCard>
      )}
      <SectionLabel>{t("ai.scripts.group")}</SectionLabel>
      {!state.scripts.available && <p className="m-hint">{t("ai.scripts.unavailable")}</p>}
      {sections.scripts.length === 0 ? (
        <p className="m-hint">{t("ai.scripts.none")}</p>
      ) : (
        <GroupCard>
          <RowList>{sections.scripts.map(switchRow)}</RowList>
        </GroupCard>
      )}
      {sections.agents && (
        <>
          <SectionLabel>{t("ai.workshop.vault")}</SectionLabel>
          <GroupCard>
            <RowList>{switchRow(sections.agents)}</RowList>
          </GroupCard>
        </>
      )}
      <SectionLabel>{t("ai.workshop.app")}</SectionLabel>
      <GroupCard>
        <RowList>{sections.app.map(switchRow)}</RowList>
      </GroupCard>
      <SectionLabel>{t("ai.workshop.test.title")}</SectionLabel>
      <GroupCard>
        <RowList>
          <Row
            title={plan ? t("ai.workshop.test.run", { model: plan.choice.model }) : t("ai.workshop.test.title")}
            subtitle={overview.summary}
            wrap
            disabled={!plan || plan.total === 0}
            onClick={() => setTesting({ ids: null })}
            end={<FlaskConical size={ICON.ui} />}
            data-testid="ai-skills-test"
          />
        </RowList>
      </GroupCard>
      {overview.hint && <p className="m-hint">{overview.hint}</p>}
      {state.learnLog && (
        <>
          <SectionLabel>{t("ai.learn.log.title")}</SectionLabel>
          <GroupCard>
            <RowList>
              <Row title={t("ai.memory.openFile")} subtitle={`${LEARN_LOG_FILE} · ${t("ai.learn.log.desc")}`} wrap onClick={() => onOpenNote(LEARN_LOG_FILE)} data-testid="ai-learn-log" />
            </RowList>
          </GroupCard>
        </>
      )}
      {testing && <SkillTestSheet ids={testing.ids} plan={skillTestPlanFor(plan, testing.ids)} onClose={() => setTesting(null)} />}
      {open && <SkillApprovalSheet id={open} onClose={() => setOpen(null)} />}
      {creating && <NewSkillSheet onClose={() => setCreating(false)} />}
      {scriptForm && <ScriptFormSheet id={scriptForm.id} onClose={() => setScriptForm(null)} />}
      {running && <ScriptRunSheet id={running} onClose={() => setRunning(null)} onOpenNote={onOpenNote} />}
      {importing && <SkillImportSheet label={importing.label} imported={importing.imported} onClose={() => setImporting(null)} />}
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          // The sheet closes with the choice: what an action opens — a run, a review, a form — must not lie under it.
          actions={skillRowActions(t, sheet.caps).map((a) => ({
            icon: <a.icon size={ICON.head} />,
            label: a.label,
            danger: a.danger,
            testId: `ai-skill-action-${a.id}`,
            onClick: () => {
              setSheet(null);
              a.run();
            },
          }))}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
