import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download, Plus } from "lucide-react";
import type { InstructionEntry, SkillImport } from "@plainva/core";
import { Button, GroupCard, ICON, Row, RowList, SectionLabel, skillRowActions, skillView, Switch, toast, workshopSections, type SkillRowCaps } from "@plainva/ui";
import { RowActionSheet } from "./RowActionSheet";
import { NewSkillSheet } from "./NewSkillSheet";
import { SkillApprovalSheet } from "./SkillApprovalSheet";
import { SkillImportSheet } from "./SkillImportSheet";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { pickSkillArchive } from "../services/ai/skillImport";
import { mConfirm } from "../services/mobileDialogs";

/**
 * The skills workshop on the phone (plan KI-Harness P3-5, mockup chapter 12):
 * the segment "Skills" of the AI screen — the desktop's lists in the phone's
 * grammar of group cards, the approval as a sheet. The model is shared
 * (`workshopSections`, `approvalFacts`); nothing here decides on its own.
 */
export function MobileSkillsWorkshop({ onOpenNote, onRun, review }: { onOpenNote: (path: string) => void; onRun: () => void; review?: string | null }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [open, setOpen] = useState<string | null>(review ?? null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<{ label: string; imported: SkillImport } | null>(null);
  const [sheet, setSheet] = useState<{ title: string; caps: SkillRowCaps } | null>(null);

  useEffect(() => {
    void session.refreshSkills();
  }, [session]);

  const sections = workshopSections(state.skills.entries);
  const titleOf = (entry: InstructionEntry) => (entry.source.kind === "agents" ? "AGENTS.md" : skillView(t, entry).title);
  const describe = (entry: InstructionEntry) => {
    const about = entry.source.kind === "agents" ? t("ai.workshop.mayAgents") : skillView(t, entry).description;
    return entry.status === "active" ? about : `${t(`ai.workshop.status.${entry.status}`)} · ${about}`;
  };
  const mainPath = (entry: InstructionEntry) => (entry.source.kind === "agents" ? "AGENTS.md" : `${entry.source.root}/SKILL.md`);
  const capsFor = (entry: InstructionEntry): SkillRowCaps => {
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
      ...(!vault ? { showInstructions: () => setOpen(entry.source.id) } : {}),
      ...(vault ? { edit: () => onOpenNote(mainPath(entry)) } : {}),
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
      ...(vault
        ? {
            delete: () => {
              void mConfirm({ title: t("ai.workshop.deleteConfirm", { title: titleOf(entry) }), message: t("ai.workshop.deleteBody"), danger: true, confirmLabel: t("ai.workshop.delete") }).then((ok) => {
                if (ok) void session.deleteInstruction(entry.source.id);
              });
            },
          }
        : {}),
    };
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
        <Button variant="tonal" icon={<Plus size={ICON.ui} />} onClick={() => setCreating(true)} data-testid="ai-skills-new">
          {t("ai.workshop.newSkill")}
        </Button>
      </div>
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
      <SectionLabel>{t("ai.workshop.own")}</SectionLabel>
      <GroupCard>
        {sections.own.length === 0 ? <p className="m-hint">{t("ai.workshop.noOwn")}</p> : <RowList>{sections.own.map(switchRow)}</RowList>}
      </GroupCard>
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
      {open && <SkillApprovalSheet id={open} onClose={() => setOpen(null)} />}
      {creating && <NewSkillSheet onClose={() => setCreating(false)} />}
      {importing && <SkillImportSheet label={importing.label} imported={importing.imported} onClose={() => setImporting(null)} />}
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          actions={skillRowActions(t, sheet.caps).map((a) => ({ icon: <a.icon size={ICON.head} />, label: a.label, danger: a.danger, testId: `ai-skill-action-${a.id}`, onClick: a.run }))}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
