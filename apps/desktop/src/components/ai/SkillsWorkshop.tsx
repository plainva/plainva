import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Download, MoreHorizontal, Plus } from "lucide-react";
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
  skillView,
  Switch,
  toast,
  useAiSession,
  useAiState,
  workshopSections,
  type SkillRowCaps,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { pickSkillArchive } from "../../services/ai/skillImport";
import { NewSkillModal } from "./NewSkillModal";
import { SkillApprovalModal } from "./SkillApprovalModal";
import { SkillImportModal } from "./SkillImportModal";

/**
 * The skills workshop in the AI tab (plan KI-Harness P3-5, mockup chapter
 * 12): what waits for an approval on this device first, then the vault's own
 * skills, its AGENTS.md and the skills that come with the app — switched,
 * run, reviewed, created, copied, imported and deleted here. Nothing that
 * arrives runs before it is approved here; the model (`workshopSections`,
 * `approvalFacts`) is the phone's as well.
 */
export function SkillsWorkshop({ onOpenFile, onRun, review, onReviewOpened }: { onOpenFile: (path: string) => void; onRun: () => void; review?: string | null; onReviewOpened?: () => void }) {
  const { t } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<{ label: string; imported: SkillImport } | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: SkillRowCaps } | null>(null);

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
  const titleOf = (entry: InstructionEntry) => (entry.source.kind === "agents" ? "AGENTS.md" : skillView(t, entry).title);
  const describe = (entry: InstructionEntry) => {
    const status = t(`ai.workshop.status.${entry.status}`);
    const about = entry.source.kind === "agents" ? t("ai.workshop.mayAgents") : skillView(t, entry).description;
    return entry.status === "active" ? about : `${status} · ${about}`;
  };
  const mainPath = (entry: InstructionEntry) => (entry.source.kind === "agents" ? "AGENTS.md" : `${entry.source.root}/SKILL.md`);

  const capsFor = (entry: InstructionEntry): SkillRowCaps => {
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
      ...(vault
        ? {
            delete: () => {
              void appConfirm({ title: t("ai.workshop.deleteConfirm", { title: titleOf(entry) }), message: t("ai.workshop.deleteBody"), confirmLabel: t("ai.workshop.delete") }).then((ok) => {
                if (ok) void session.deleteInstruction(entry.source.id);
              });
            },
          }
        : {}),
    };
  };
  const openMenu = (event: MouseEvent, entry: InstructionEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ at: { x: event.clientX, y: event.clientY }, caps: capsFor(entry) });
  };
  const switchable = (entry: InstructionEntry) => (
    <div className="pv-ai-rowactions">
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
        <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} onClick={() => setCreating(true)} data-testid="ai-skills-new">
          {t("ai.workshop.newSkill")}
        </Button>
      </div>
      {sections.waiting.length > 0 && (
        <SettingCard label={t("ai.workshop.waiting")}>
          {sections.waiting.map((entry) => (
            <SettingRow key={entry.source.id} label={titleOf(entry)} desc={describe(entry)}>
              <Button size="sm" variant="tonal" onClick={() => setOpen(entry.source.id)} data-testid="ai-skill-review">
                {entry.status === "new" || entry.status === "changed" ? t("ai.workshop.review") : t("ai.workshop.showInstructions")}
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
      {open && <SkillApprovalModal id={open} onClose={() => setOpen(null)} />}
      {creating && <NewSkillModal onClose={() => setCreating(false)} />}
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
