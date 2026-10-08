import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { CodeXml, Download, FlaskConical, MoreHorizontal, Plus } from "lucide-react";
import type { InstructionEntry, SkillImport } from "@plainva/core";
import {
  Button,
  ICON,
  IconButton,
  MenuItem,
  MenuSurface,
  RowActionList,
  SettingCard,
  SettingCardNote,
  SettingRow,
  skillRowActions,
  skillRowDescription,
  skillTestOverview,
  skillTestPlanFor,
  skillView,
  Switch,
  toast,
  useAiSession,
  useAiState,
  useSkillTestPlan,
  workshopSections,
  workshopTitle,
  type SkillRowCaps,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { pickSkillArchive } from "../../services/ai/skillImport";
import { NewSkillModal } from "./NewSkillModal";
import { ScriptFormModal } from "./ScriptFormModal";
import { ScriptRunModal } from "./ScriptRunModal";
import { SkillApprovalModal } from "./SkillApprovalModal";
import { SkillImportModal } from "./SkillImportModal";
import { SkillTestModal } from "./SkillTestModal";

/**
 * The skills workshop in the AI tab (plan KI-Harness P3-5, mockup chapter
 * 12): what waits for an approval on this device first, then the vault's own
 * skills, its AGENTS.md and the skills that come with the app — switched,
 * run, reviewed, created, copied, imported and deleted here. Nothing that
 * arrives runs before it is approved here; the model (`workshopSections`,
 * `approvalFacts`) is the phone's as well.
 *
 * The vault's scripts (plan P5.5, mockup chapter 21) stand in the same
 * workshop: what waits, above with the skills; the approved ones in a group
 * of their own, each with its switch and — while it is active — a way to run
 * it here. A script is written and changed in a form, not in the editor: its
 * two files belong together, and saving approves exactly what was written.
 */
export function SkillsWorkshop({ onOpenFile, onRun, review, onReviewOpened }: { onOpenFile: (path: string) => void; onRun: () => void; review?: string | null; onReviewOpened?: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** The script form: a new one (`id` null) or an existing one to change. */
  const [scriptForm, setScriptForm] = useState<{ id: string | null } | null>(null);
  /** The script whose run dialog is open. */
  const [running, setRunning] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ label: string; imported: SkillImport } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: SkillRowCaps } | null>(null);
  /** The regression run's dialog: for some skills, or (null) for all that bring scenarios. */
  const [testing, setTesting] = useState<{ ids: string[] | null } | null>(null);
  const plan = useSkillTestPlan(session, state);

  useEffect(() => {
    void session?.refreshSkills();
  }, [session]);
  // A settings row may ask for one entry's review on arrival.
  useEffect(() => {
    if (!review) return;
    setOpen(review);
    onReviewOpened?.();
  }, [review, onReviewOpened]);

  if (!session || !state) return null;
  const sections = workshopSections(state.skills.entries);
  const titleOf = (entry: InstructionEntry) => workshopTitle(t, entry);
  const describe = (entry: InstructionEntry) => skillRowDescription(t, entry, state.skillTests.records, plan);
  const testable = (entry: InstructionEntry) => plan?.targets.some((target) => target.id === entry.source.id && target.scenarios > 0) === true;
  const overview = skillTestOverview(t, state.skillTests.records, plan, i18n.language);
  const mainPath = (entry: InstructionEntry) => (entry.source.kind === "agents" ? "AGENTS.md" : `${entry.source.root}/SKILL.md`);

  const remove = (entry: InstructionEntry, question: string) => {
    void appConfirm({ title: t(question, { title: titleOf(entry) }), message: t("ai.workshop.deleteBody"), confirmLabel: t("ai.workshop.delete") }).then((ok) => {
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
    const startable = entry.status === "active" && entry.source.kind === "skill";
    return {
      ...(startable
        ? {
            run: () => {
              const view = skillView(t, entry);
              onRun();
              void session.runSkill(view.id, view.start);
            },
          }
        : {}),
      ...(startable && plan && testable(entry) ? { test: () => setTesting({ ids: [entry.source.id] }), testLabel: t("ai.workshop.test.run", { model: plan.choice.model }) } : {}),
      ...(!vault ? { showInstructions: () => setOpen(entry.source.id) } : {}),
      ...(vault ? { edit: () => onOpenFile(mainPath(entry)) } : {}),
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
  const openMenu = (event: MouseEvent, entry: InstructionEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ at: { x: event.clientX, y: event.clientY }, caps: capsFor(entry) });
  };
  const switchable = (entry: InstructionEntry) => (
    <div className="pv-ai-rowactions">
      {entry.source.kind === "script" && entry.status === "active" && (
        <Button size="sm" variant="ghost" onClick={() => setRunning(entry.source.id)} data-testid="ai-script-open-run">
          {t("ai.workshop.run")}
        </Button>
      )}
      <Switch checked={entry.status === "active"} label={t("ai.workshop.switchLabel", { title: titleOf(entry) })} onChange={(on) => void session.switchInstruction(entry.source.id, on)} />
      <IconButton label={t("common.moreActions")} size="sm" onClick={(event) => openMenu(event, entry)} data-testid="ai-skill-more">
        <MoreHorizontal size={ICON.ui} />
      </IconButton>
    </div>
  );

  return (
    <div className="pv-skills" data-testid="ai-skills-workshop">
      <div className="pv-skills-actions">
        <Button
          size="sm"
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
        <Button size="sm" variant="secondary" icon={<CodeXml size={ICON.ui} />} disabled={!state.scripts.available} onClick={() => setScriptForm({ id: null })} data-testid="ai-scripts-new">
          {t("ai.scripts.new")}
        </Button>
        <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} onClick={() => setCreating(true)} data-testid="ai-skills-new">
          {t("ai.workshop.newSkill")}
        </Button>
      </div>
      {sections.waiting.length > 0 && (
        <SettingCard label={t("ai.workshop.waiting")}>
          {sections.waiting.map((entry) => (
            <SettingRow key={entry.source.id} label={titleOf(entry)} desc={describe(entry)}>
              <Button size="sm" variant="tonal" onClick={() => setOpen(entry.source.id)} data-testid="ai-skill-review">
                {entry.status === "new" || entry.status === "changed" ? t("ai.workshop.review") : entry.source.kind === "script" ? t("ai.scripts.show") : t("ai.workshop.showInstructions")}
              </Button>
            </SettingRow>
          ))}
        </SettingCard>
      )}
      <SettingCard label={t("ai.workshop.own")}>
        {sections.own.length === 0 ? (
          <SettingCardNote>{t("ai.workshop.noOwn")}</SettingCardNote>
        ) : (
          sections.own.map((entry) => (
            <SettingRow key={entry.source.id} label={titleOf(entry)} desc={describe(entry)}>
              {switchable(entry)}
            </SettingRow>
          ))
        )}
      </SettingCard>
      <SettingCard label={t("ai.scripts.group")}>
        {!state.scripts.available && <SettingCardNote>{t("ai.scripts.unavailable")}</SettingCardNote>}
        {sections.scripts.length === 0 ? (
          <SettingCardNote>{t("ai.scripts.none")}</SettingCardNote>
        ) : (
          sections.scripts.map((entry) => (
            <SettingRow key={entry.source.id} label={titleOf(entry)} desc={describe(entry)}>
              {switchable(entry)}
            </SettingRow>
          ))
        )}
      </SettingCard>
      {sections.agents && (
        <SettingCard label={t("ai.workshop.vault")}>
          <SettingRow label="AGENTS.md" desc={describe(sections.agents)}>
            {switchable(sections.agents)}
          </SettingRow>
        </SettingCard>
      )}
      <SettingCard label={t("ai.workshop.app")}>
        {sections.app.map((entry) => (
          <SettingRow key={entry.source.id} label={titleOf(entry)} desc={describe(entry)}>
            {switchable(entry)}
          </SettingRow>
        ))}
      </SettingCard>
      <SettingCard label={t("ai.workshop.test.title")}>
        <SettingRow label={plan ? t("ai.workshop.test.run", { model: plan.choice.model }) : t("ai.workshop.test.title")} desc={overview.summary}>
          <Button size="sm" variant="tonal" icon={<FlaskConical size={ICON.ui} />} disabled={!plan || plan.total === 0} onClick={() => setTesting({ ids: null })} data-testid="ai-skills-test">
            {t("ai.workshop.test.open")}
          </Button>
        </SettingRow>
        {overview.hint && <SettingCardNote>{overview.hint}</SettingCardNote>}
      </SettingCard>
      {testing && <SkillTestModal ids={testing.ids} plan={skillTestPlanFor(plan, testing.ids)} onClose={() => setTesting(null)} />}
      {open && <SkillApprovalModal id={open} onClose={() => setOpen(null)} />}
      {creating && <NewSkillModal onClose={() => setCreating(false)} />}
      {scriptForm && <ScriptFormModal id={scriptForm.id} onClose={() => setScriptForm(null)} />}
      {running && <ScriptRunModal id={running} onClose={() => setRunning(null)} onOpenNote={onOpenFile} />}
      {importing && <SkillImportModal label={importing.label} imported={importing.imported} onClose={() => setImporting(null)} />}
      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          <RowActionList build={(tt) => skillRowActions(tt, menu.caps)}>
            {(a) => (
              <MenuItem key={a.id} icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={`ai-skill-action-${a.id}`} onSelect={a.run}>
                {a.label}
              </MenuItem>
            )}
          </RowActionList>
        </MenuSurface>
      )}
    </div>
  );
}
