import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookMarked, FileText, MoreHorizontal, Plus, Scale } from "lucide-react";
import { memoryFileOf, type MemoryPlace } from "@plainva/core";
import {
  Banner,
  Button,
  cx,
  EmptyState,
  filterMemoryRows,
  ICON,
  IconButton,
  memoryGroups,
  MEMORY_SEARCH_FROM,
  MemoryMeter,
  memoryRowActions,
  MenuItem,
  MenuSurface,
  Modal,
  RowActionList,
  SearchField,
  SettingCard,
  SettingCardNote,
  SettingRow,
  skillView,
  Switch,
  toast,
  useAiSession,
  useAiState,
  useUpkeepRows,
  workshopSections,
  type MemoryRow,
  type MemoryRowCaps,
  type UpkeepRow,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { MemoryEntryModal } from "./MemoryEntryModal";
import { MemoryRuleModal } from "./MemoryRuleModal";
import { UpkeepCard } from "./UpkeepCard";

/** The skill that looks through the memory with a model, when the user starts it (plan P6-3). */
const MEMORY_CARE = "plainva:memory-care";

/**
 * The vault's memory in the AI tab (plan KI-Harness P6, mockup chapter 22):
 * what goes into every conversation, what an assistant can look up, and the
 * way to the vault's rules. The memory is two files of the vault; the model
 * of this view (`memoryGroups`) is the phone's as well.
 *
 * Nothing here is written by a model: an assistant leaves a draft, and the
 * user's "Remember" on that draft is what writes. So every entry in these
 * lists was typed here, typed into the file, or accepted on this device or
 * another one.
 */
export function MemoryView({
  onOpenFile,
  onOpenWaiting,
  onReviewRules,
  onRun,
}: {
  onOpenFile: (path: string) => void;
  onOpenWaiting: () => void;
  onReviewRules: (id: string) => void;
  /** A skill was started from here: the shell shows its conversation. */
  onRun: () => void;
}) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  /** The entry form: a new one (`id` null) or an existing one to reword. */
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [rule, setRule] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: MemoryRowCaps } | null>(null);
  /** The two entries a hint asked to see side by side. */
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);
  // What this device noticed by itself about the memory (plan P6-3): no model is asked for any of it.
  const upkeep = useUpkeepRows(session, state, "memory");

  useEffect(() => {
    void session?.refreshMemory();
    void session?.refreshSkills();
  }, [session]);

  if (!session || !state) return null;
  const memory = state.memory;
  if (!memory.available) {
    return (
      <div className="pv-skills" data-testid="ai-memory">
        <EmptyState icon={<BookMarked size={ICON.empty} />} title={t("ai.memory.segment")}>
          {t("ai.memory.unavailable")}
        </EmptyState>
      </div>
    );
  }
  const groups = memoryGroups(t, memory, i18n.language);
  const waiting = state.drafts.drafts.filter((draft) => draft.body.kind === "memory" || draft.body.kind === "forget" || draft.body.kind === "rule").length;
  const agents = workshopSections(state.skills.entries).agents;
  const shownLong = filterMemoryRows(groups.long, query);

  const remove = (row: MemoryRow) => {
    void appConfirm({ title: t("ai.memory.deleteConfirm"), message: `${row.text}\n\n${t("ai.memory.deleteBody")}`, confirmLabel: t("ai.memory.action.delete") }).then((ok) => {
      if (!ok) return;
      void session.removeMemory(row.id).then((result) => {
        if (!result.ok) toast.error(t("ai.memory.problem.failed"));
      });
    });
  };
  const move = (row: MemoryRow) => {
    void session.moveMemory(row.id, row.place === "active" ? "long" : "active").then((result) => {
      if (!result.ok) toast.error(t(result.reason === "duplicate" ? "ai.memory.problem.duplicate" : "ai.memory.problem.failed"));
    });
  };
  const capsFor = (row: MemoryRow): MemoryRowCaps =>
    memory.writable
      ? {
          edit: () => setForm({ id: row.id }),
          ...(row.place === "active" ? { toLong: () => move(row) } : { toActive: () => move(row) }),
          delete: () => remove(row),
        }
      : {};
  const openMenu = (event: MouseEvent, row: MemoryRow) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ at: { x: event.clientX, y: event.clientY }, caps: capsFor(row) });
  };
  const rowOf = (row: MemoryRow) => (
    // The row's menu opens from its button and from the secondary click, like every row's.
    <div
      key={row.id}
      className={cx("pv-setrow", "pv-memory-row", row.blocked && "pv-memory-row--blocked")}
      onContextMenu={memory.writable ? (event) => openMenu(event, row) : undefined}
      data-testid="ai-memory-entry"
      data-place={row.place}
    >
      <div className="pv-setrow-main">
        <div className="pv-setrow-label pv-memory-text">{row.text}</div>
        <div className="pv-setrow-desc">{row.description}</div>
        {row.marks.length > 0 && (
          <div className="pv-memory-marks">
            {row.marks.map((mark) => (
              <span key={mark.text} className={cx("pv-memory-mark", mark.kind === "problem" && "pv-memory-mark--problem")} data-testid="ai-memory-mark">
                {mark.text}
              </span>
            ))}
          </div>
        )}
      </div>
      {memory.writable && (
        <div className="pv-setrow-ctrl">
          <IconButton label={t("common.moreActions")} size="sm" onClick={(event) => openMenu(event, row)} data-testid="ai-memory-more">
            <MoreHorizontal size={ICON.ui} />
          </IconButton>
        </div>
      )}
    </div>
  );

  // A hint's one step: the entry's own form, or the two entries side by side with everything a row can do.
  const takeStep = (row: UpkeepRow) => {
    const step = row.step?.what;
    if (step?.do === "compare-entries") setPair({ a: step.a, b: step.b });
    else if (step?.do === "edit-entry") setForm({ id: step.id });
  };
  const rowById = (id: string) => [...groups.active, ...groups.long].find((candidate) => candidate.id === id) ?? null;
  // Both entries, while both still stand: once one is reworded or gone, there is no pair to look at.
  const pairRows = pair ? [rowById(pair.a), rowById(pair.b)].filter((found): found is MemoryRow => found !== null) : [];
  // With a model, when the user starts it: the skill that reads the entries and drafts what to merge and what to take out.
  const care = state.skills.entries.find((entry) => entry.source.id === MEMORY_CARE && entry.status === "active") ?? null;
  const canCare = Boolean(care) && state.settings.enabled && memory.on && memory.writable;

  /** A group's name with how many entries it holds — "Always included · 4"; the name alone while it is empty. */
  const counted = (name: string, count: number) => (count > 0 ? `${name} · ${count}` : name);
  // The memory is the user's files: each place offers its own, once there is one, in the editor.
  const fileOf = (place: MemoryPlace) =>
    memory.files.includes(place) ? (
      <SettingCardNote>
        <Button size="sm" variant="ghost" icon={<FileText size={ICON.ui} />} onClick={() => onOpenFile(memoryFileOf(place))} data-testid={`ai-memory-file-${place}`}>
          {t("ai.memory.openFile")}
        </Button>
      </SettingCardNote>
    ) : null;

  return (
    <div className="pv-skills pv-memory" data-testid="ai-memory">
      <div className="pv-skills-actions">
        <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} disabled={!memory.writable} onClick={() => setForm({ id: null })} data-testid="ai-memory-new">
          {t("ai.memory.newEntry")}
        </Button>
      </div>
      <SettingCard>
        <SettingRow label={t("ai.memory.use")} desc={t(memory.on ? "ai.memory.useDesc" : "ai.memory.off")}>
          <Switch checked={memory.on} label={t("ai.memory.use")} onChange={(on) => void session.switchMemory(on)} data-testid="ai-memory-switch" />
        </SettingRow>
      </SettingCard>
      {waiting > 0 && (
        <Banner
          kind="info"
          rounded
          actions={
            <Button size="sm" variant="secondary" onClick={onOpenWaiting} data-testid="ai-memory-waiting">
              {t("ai.memory.waitingShow")}
            </Button>
          }
        >
          {t("ai.memory.waiting", { count: waiting })}
        </Banner>
      )}
      {upkeep.length > 0 && (
        <UpkeepCard rows={upkeep} onStep={takeStep} onDismiss={(key) => void session.dismissUpkeepHint(key)} testId="ai-upkeep-memory">
          {care && canCare && (
            <SettingRow label={t("ai.upkeep.care.label")} desc={t("ai.upkeep.care.desc", { skill: skillView(t, care).title })}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const view = skillView(t, care);
                  onRun();
                  void session.runSkill(view.id, view.start);
                }}
                data-testid="ai-memory-care"
              >
                {t("ai.upkeep.care.step")}
              </Button>
            </SettingRow>
          )}
        </UpkeepCard>
      )}
      <SettingCard label={counted(t("ai.memory.active"), groups.active.length)}>
        <SettingCardNote>
          <MemoryMeter fill={groups.fill} label={groups.budget} />
        </SettingCardNote>
        {groups.active.length === 0 ? <SettingCardNote>{t("ai.memory.activeEmpty")}</SettingCardNote> : groups.active.map(rowOf)}
        {memory.cut.includes("active") && <SettingCardNote>{t("ai.memory.cut")}</SettingCardNote>}
        {fileOf("active")}
      </SettingCard>
      <SettingCard label={counted(t("ai.memory.long"), groups.long.length)}>
        {groups.long.length > MEMORY_SEARCH_FROM && (
          <SettingCardNote>
            <SearchField value={query} onValueChange={setQuery} placeholder={t("ai.memory.search")} aria-label={t("ai.memory.search")} clearLabel={t("sidebar.clearSearch")} data-testid="ai-memory-search" />
          </SettingCardNote>
        )}
        {groups.long.length === 0 ? (
          <SettingCardNote>{t("ai.memory.longEmpty")}</SettingCardNote>
        ) : shownLong.length === 0 ? (
          <SettingCardNote>{t("ai.memory.searchNone")}</SettingCardNote>
        ) : (
          shownLong.map(rowOf)
        )}
        {memory.cut.includes("long") && <SettingCardNote>{t("ai.memory.cut")}</SettingCardNote>}
        {fileOf("long")}
      </SettingCard>
      <SettingCard label={t("ai.memory.rules.title")}>
        {/* The file's standing on this device comes first where there is one: a rule in a file that waits is not in effect. */}
        <SettingRow label={t("ai.workshop.vault")} desc={agents ? `AGENTS.md · ${t(`ai.workshop.status.${agents.status}`)} · ${t("ai.memory.rules.desc")}` : t("ai.memory.rules.desc")}>
          <div className="pv-ai-rowactions">
            {agents && (agents.status === "new" || agents.status === "changed") && (
              <Button size="sm" variant="tonal" onClick={() => onReviewRules(agents.source.id)} data-testid="ai-memory-rules-review">
                {t("ai.workshop.review")}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!memory.writable} onClick={() => setRule(true)} data-testid="ai-memory-rule-new">
              {t("ai.memory.rules.add")}
            </Button>
            {agents && (
              <Button size="sm" variant="ghost" onClick={() => onOpenFile("AGENTS.md")} data-testid="ai-memory-rules-open">
                {t("ai.memory.rules.open")}
              </Button>
            )}
          </div>
        </SettingRow>
      </SettingCard>
      <p className="pv-memory-foot">{t("ai.memory.files")}</p>
      {/* Under the entry's form and the row menus: both open from its rows. */}
      {pair && pairRows.length === 2 && (
        <Modal
          title={t("ai.upkeep.entries.title")}
          icon={<Scale size={ICON.ui} />}
          size="md"
          onClose={() => setPair(null)}
          testId="ai-memory-compare"
          footer={
            <Button variant="ghost" onClick={() => setPair(null)}>
              {t("common.close")}
            </Button>
          }
        >
          <div className="pv-setcard">{pairRows.map(rowOf)}</div>
          <p className="pv-modal-hint">{t("ai.upkeep.entries.hint")}</p>
        </Modal>
      )}
      {form && <MemoryEntryModal id={form.id} onClose={() => setForm(null)} />}
      {rule && <MemoryRuleModal onClose={() => setRule(false)} />}
      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          <RowActionList build={(tt) => memoryRowActions(tt, menu.caps)}>
            {(a) => (
              <MenuItem key={a.id} icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={`ai-memory-action-${a.id}`} onSelect={a.run}>
                {a.label}
              </MenuItem>
            )}
          </RowActionList>
        </MenuSurface>
      )}
    </div>
  );
}
