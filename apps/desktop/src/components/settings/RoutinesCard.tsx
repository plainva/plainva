import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Eye, MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { ROUTINE_NAME_MAX, ROUTINES_MAX, routineDraftOf, type Routine, type RoutineDraft } from "@plainva/core";
import {
  AiRoutineConfirm,
  Banner,
  Button,
  Checkbox,
  Chip,
  ICON,
  IconButton,
  MenuItem,
  MenuSurface,
  Modal,
  newLogDraft,
  newRoutineDraft,
  routineChoiceKey,
  routineDayName,
  routineKindPatch,
  routineLogFolders,
  routineModelOptions,
  routineNow,
  routineRows,
  routineSkillOptions,
  routineWeek,
  Segmented,
  Select,
  SettingCard,
  SettingCardNote,
  SettingRow,
  Switch,
  TextInput,
  toast,
  useMinuteClock,
  useTodayKey,
  useRoutineForm,
  useWeekStartDay,
  type AiSession,
  type RoutineKind,
  type RoutineModelOption,
  type RoutineSkillOption,
} from "@plainva/ui";
import { getDesktopAiSession } from "../../services/ai/desktopAi";
import { appConfirm } from "../../services/appDialogs";

const NOOP = () => () => {};
const NONE = () => null;

/**
 * The routines of this vault on this device (plan KI-Harness P8, mockup
 * chapter 24): what each does and when, how its last run ended, when the
 * next one stands, and what it needs from its user. The switch pauses one;
 * the menu runs it now, edits it or removes it. A routine that rests or
 * needs its user leads to its confirmation instead.
 *
 * The list and its texts are the shared view model (`routineRows`); the phone
 * dresses the same in its own grammar. `folders` are the vault's folders, for
 * a routine that keeps a folder's log (plan P8-2).
 */
export function RoutinesCard({ onOpenNote, folders = [] }: { onOpenNote?: (path: string) => void; folders?: readonly string[] }) {
  const { t, i18n } = useTranslation();
  const session = getDesktopAiSession();
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  const weekStart = useWeekStartDay();
  const day = useTodayKey();
  const clock = useMinuteClock();
  const [dialog, setDialog] = useState<{ routine: Routine | null; review: boolean } | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  useEffect(() => {
    void session?.refreshSkills();
  }, [session]);
  const now = useMemo(() => routineNow(day, clock), [day, clock]);
  if (!session || !state || !state.settings.enabled || !state.routines.available) return null;

  const { list, running } = state.routines;
  const entries = state.skills.entries;
  const rows = routineRows(t, { list, running, entries, settings: state.settings, keys: state.keys }, now, i18n.language, weekStart);
  const skills = routineSkillOptions(t, entries);
  const full = list.length >= ROUTINES_MAX;
  const picked = menu ? list.find((routine) => routine.id === menu.id) : undefined;

  const runNow = (routine: Routine) => {
    void session.runRoutine(routine.id, "hand").then((outcome) => {
      if (outcome.kind === "refused" && outcome.reason === "busy") toast.info(t("ai.routines.busy"));
    });
  };
  const remove = async (routine: Routine) => {
    const yes = await appConfirm({ title: t("ai.routines.removeTitle", { name: routine.name }), message: t("ai.routines.removeBody"), confirmLabel: t("ai.routines.remove") });
    if (yes) await session.removeRoutine(routine.id);
  };

  return (
    <>
      <SettingCard label={t("ai.routines.title")}>
        <SettingCardNote>{t("ai.routines.note")}</SettingCardNote>
        {state.routines.loaded && rows.length === 0 && <SettingCardNote>{t("ai.routines.empty")}</SettingCardNote>}
        {rows.map((row) => {
          const routine = list.find((candidate) => candidate.id === row.id)!;
          return (
            <div key={row.id} className="pv-setrow" data-testid="settings-ai-routine">
              <div className="pv-setrow-main">
                <div className="pv-setrow-label">{row.name}</div>
                <div className="pv-setrow-desc">{row.line}</div>
                <div className="pv-setrow-desc" data-testid="settings-ai-routine-status">
                  {row.status}
                </div>
              </div>
              <div className="pv-setrow-ctrl">
                <div className="pv-ai-rowactions">
                  {row.need && (
                    <Button size="sm" variant="tonal" icon={<Eye size={ICON.ui} />} onClick={() => setDialog({ routine, review: true })} data-testid="settings-ai-routine-review">
                      {t("ai.routines.review")}
                    </Button>
                  )}
                  <IconButton
                    size="sm"
                    label={t("ai.routines.more", { name: row.name })}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      setMenu({ id: row.id, at: { x: box.left, y: box.bottom } });
                    }}
                    data-testid="settings-ai-routine-more"
                  >
                    <MoreHorizontal size={ICON.ui} />
                  </IconButton>
                  <Switch checked={!row.paused} disabled={row.running} label={t("ai.routines.active", { name: row.name })} onChange={(on) => void session.pauseRoutine(row.id, !on)} />
                </div>
              </div>
            </div>
          );
        })}
        <SettingRow label={t("ai.routines.add")} desc={full ? t("ai.routines.full", { max: ROUTINES_MAX }) : skills.length === 0 ? t("ai.routines.noSkill") : t("ai.routines.eligible")}>
          {/* A folder's log needs no skill: without one, a new routine starts as a log. */}
          <Button size="sm" variant="secondary" icon={<Plus size={ICON.ui} />} disabled={full} onClick={() => setDialog({ routine: null, review: false })} data-testid="settings-ai-routine-add">
            {t("ai.routines.add")}
          </Button>
        </SettingRow>
      </SettingCard>
      {menu && picked && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} align="right" ariaLabel={t("ai.routines.more", { name: picked.name })}>
          <MenuItem icon={<Play size={ICON.ui} />} disabled={running !== null} onSelect={() => runNow(picked)} data-testid="settings-ai-routine-run">
            {t("ai.routines.runNow")}
          </MenuItem>
          <MenuItem icon={<Pencil size={ICON.ui} />} disabled={running?.id === picked.id} onSelect={() => setDialog({ routine: picked, review: false })} data-testid="settings-ai-routine-edit">
            {t("common.edit")}
          </MenuItem>
          <MenuItem icon={<Trash2 size={ICON.ui} />} danger disabled={running?.id === picked.id} onSelect={() => void remove(picked)} data-testid="settings-ai-routine-remove">
            {t("ai.routines.remove")}
          </MenuItem>
        </MenuSurface>
      )}
      {dialog && (
        <RoutineDialog
          key={dialog.routine?.id ?? "new"}
          session={session}
          routine={dialog.routine}
          review={dialog.review}
          skills={skills}
          folders={folders}
          models={routineModelOptions(t, state.settings, dialog.routine?.choice ?? null)}
          weekStart={weekStart}
          onClose={() => setDialog(null)}
          {...(onOpenNote ? { onOpenNote } : {})}
        />
      )}
    </>
  );
}

interface RoutineDialogProps {
  session: AiSession;
  /** The routine being edited or looked at again; null for a new one. */
  routine: Routine | null;
  /** A second look: straight to what holds for it, with what a run would send now. */
  review: boolean;
  skills: readonly RoutineSkillOption[];
  /** The vault's folders, for a folder's log. */
  folders: readonly string[];
  models: readonly RoutineModelOption[];
  weekStart: number;
  onClose: () => void;
  onOpenNote?: (path: string) => void;
}

/** Setting a routine up, in two steps: the form, then what holds for a run nobody watches. Only the yes there makes it. */
function RoutineDialog({ session, routine, review, skills, folders, models, weekStart, onClose, onOpenNote }: RoutineDialogProps) {
  const { t, i18n } = useTranslation();
  const [initial] = useState<RoutineDraft>(() => (routine ? routineDraftOf(routine) : skills[0] ? newRoutineDraft(skills[0].id, models[0]?.choice ?? null) : newLogDraft(models[0]?.choice ?? null)));
  const form = useRoutineForm(session, initial, { ...(routine ? { id: routine.id } : {}), review });
  const { draft } = form;
  const skill = skills.find((option) => option.id === draft.skill);
  const kind: RoutineKind = draft.log ? "log" : "skill";
  const confirm = () => {
    void form.confirm().then((saved) => {
      if (saved === "saved") onClose();
      else toast.error(saved === "full" ? t("ai.routines.full", { max: ROUTINES_MAX }) : t("ai.routines.refused.failed"));
    });
  };
  const refusal = form.refused ? (
    <Banner kind="warning" rounded>
      <span data-testid="ai-routine-refused">{t(`ai.routines.refused.${form.refused === "off" ? "failed" : form.refused}`)}</span>
    </Banner>
  ) : null;

  if (form.step === "confirm") {
    return (
      <Modal
        title={t("ai.routines.confirm.title", { name: draft.name.trim() })}
        icon={<CalendarClock size={ICON.ui} />}
        size="lg"
        onClose={onClose}
        testId="ai-routine-confirm"
        footer={
          <>
            <Button variant="ghost" onClick={form.back} data-testid="ai-routine-back">
              {routine && review ? t("common.edit") : t("common.back")}
            </Button>
            <Button variant="primary" disabled={!form.preview || form.busy} onClick={confirm} data-testid="ai-routine-save">
              {routine ? t("ai.routines.confirm.saveAgain") : t("ai.routines.confirm.save")}
            </Button>
          </>
        }
      >
        {refusal}
        {form.preview && <AiRoutineConfirm draft={draft} preview={form.preview} weekStart={weekStart} {...(onOpenNote ? { onOpenNote } : {})} />}
      </Modal>
    );
  }

  return (
    <Modal
      title={routine ? t("ai.routines.form.titleEdit") : t("ai.routines.form.titleNew")}
      icon={<CalendarClock size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-routine-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={form.problems.length > 0 || form.busy} onClick={form.toConfirm} data-testid="ai-routine-next">
            {t("common.next")}
          </Button>
        </>
      }
    >
      <label className="pv-modal-label" htmlFor="pv-routine-name">
        {t("ai.routines.form.name")}
      </label>
      <TextInput
        id="pv-routine-name"
        value={draft.name}
        maxLength={ROUTINE_NAME_MAX}
        placeholder={draft.log ? t("ai.routines.log.namePlaceholder") : t("ai.routines.form.namePlaceholder")}
        onChange={(event) => form.change({ name: event.target.value })}
        data-testid="ai-routine-name"
      />

      {/* What it does (plan P8-2): runs a skill, or keeps a folder's log. */}
      <span className="pv-modal-label">{t("ai.routines.kind")}</span>
      {/* A block of its own: the next field's label begins below it. */}
      <div>
        <Segmented<RoutineKind>
          ariaLabel={t("ai.routines.kind")}
          value={kind}
          onChange={(next) => form.change(routineKindPatch(draft, next, skills[0]?.id ?? ""))}
          options={[
            { value: "skill", label: t("ai.routines.kindSkill"), testId: "ai-routine-kind-skill" },
            { value: "log", label: t("ai.routines.kindLog"), testId: "ai-routine-kind-log" },
          ]}
        />
      </div>

      {draft.log ? (
        <>
          <span className="pv-modal-label">{t("ai.routines.log.folder")}</span>
          <Select
            value={draft.log.folder}
            options={[{ value: "", label: t("ai.routines.log.wholeVault") }, ...routineLogFolders(folders, draft.log.folder || null).map((folder) => ({ value: folder, label: folder }))]}
            onChange={(folder) => form.change({ log: { folder } })}
            ariaLabel={t("ai.routines.log.folder")}
            minWidth="100%"
            data-testid="ai-routine-folder"
          />
          <p className="pv-modal-hint">{t("ai.routines.log.folderDesc")}</p>
        </>
      ) : (
        <>
          <span className="pv-modal-label">{t("ai.routines.form.skill")}</span>
          {skills.length > 0 ? (
            <Select value={draft.skill} options={skills.map((option) => ({ value: option.id, label: option.title }))} onChange={(value) => form.change({ skill: value })} ariaLabel={t("ai.routines.form.skill")} minWidth="100%" data-testid="ai-routine-skill" />
          ) : (
            <p className="pv-modal-hint">{t("ai.routines.noSkill")}</p>
          )}
          <p className="pv-modal-hint">{t("ai.routines.form.skillDesc")}</p>

          <label className="pv-modal-label" htmlFor="pv-routine-request">
            {t("ai.routines.form.request")}
          </label>
          <TextInput id="pv-routine-request" value={draft.request} maxLength={500} placeholder={skill?.request ?? ""} onChange={(event) => form.change({ request: event.target.value })} data-testid="ai-routine-request" />
          <p className="pv-modal-hint">{t("ai.routines.form.requestDesc")}</p>
        </>
      )}

      <span className="pv-modal-label">{t("ai.routines.form.when")}</span>
      <div className="pv-ai-chips" role="group" aria-label={t("ai.routines.form.when")}>
        {routineWeek(weekStart).map((day) => (
          <Chip key={day} size="sm" selected={draft.days.includes(day)} onClick={() => form.toggleDay(day)} tip={routineDayName(day, i18n.language, "long")} testId={`ai-routine-day-${day}`}>
            {routineDayName(day, i18n.language)}
          </Chip>
        ))}
        <TextInput type="time" value={draft.time} aria-label={t("ai.routines.form.time")} onChange={(event) => form.change({ time: event.target.value })} data-testid="ai-routine-time" />
      </div>
      <p className="pv-modal-hint">{t("ai.routines.form.whenDesc")}</p>

      <span className="pv-modal-label">{t("ai.routines.form.missed")}</span>
      <Segmented<"catch-up" | "skip">
        ariaLabel={t("ai.routines.form.missed")}
        value={draft.missed}
        onChange={(missed) => form.change({ missed })}
        options={[
          { value: "catch-up", label: t("ai.routines.form.catchUp"), testId: "ai-routine-catchup" },
          { value: "skip", label: t("ai.routines.form.skip"), testId: "ai-routine-skip" },
        ]}
      />
      <p className="pv-modal-hint">{t("ai.routines.form.missedDesc")}</p>

      {/* A folder's log always looks first whether anything changed: the choice is a skill's routine's only. */}
      {!draft.log && (
        <>
          <Checkbox checked={draft.onlyWhenChanged} onChange={(event) => form.change({ onlyWhenChanged: event.target.checked })} data-testid="ai-routine-changed">
            {t("ai.routines.form.changed")}
          </Checkbox>
          <p className="pv-modal-hint">{t("ai.routines.form.changedDesc")}</p>
        </>
      )}

      <span className="pv-modal-label">{t("ai.routines.form.model")}</span>
      {models.length > 0 ? (
        <Select
          value={draft.choice ? routineChoiceKey(draft.choice) : ""}
          options={models.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(value) => form.change({ choice: models.find((option) => option.value === value)?.choice ?? null })}
          ariaLabel={t("ai.routines.form.model")}
          minWidth="100%"
          data-testid="ai-routine-model"
        />
      ) : (
        <p className="pv-modal-hint">{t("ai.routines.form.noModel")}</p>
      )}
      <p className="pv-modal-hint">{t("ai.routines.form.modelDesc")}</p>
      {refusal}
    </Modal>
  );
}
