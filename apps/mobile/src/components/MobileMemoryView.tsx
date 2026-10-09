import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus } from "lucide-react";
import { memoryFileOf } from "@plainva/core";
import {
  Banner,
  Button,
  filterMemoryRows,
  GroupCard,
  ICON,
  memoryGroups,
  MEMORY_SEARCH_FROM,
  MemoryMeter,
  memoryRowActions,
  Row,
  RowList,
  SearchField,
  SectionLabel,
  Switch,
  toast,
  workshopSections,
  type MemoryRow,
  type MemoryRowCaps,
} from "@plainva/ui";
import { MemoryEntrySheet } from "./MemoryEntrySheet";
import { MemoryRuleSheet } from "./MemoryRuleSheet";
import { RowActionSheet } from "./RowActionSheet";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { mConfirm } from "../services/mobileDialogs";

/**
 * The vault's memory on the phone (plan KI-Harness P6, mockup chapter 22):
 * the segment "Memory" of the AI screen — the desktop's lists in the phone's
 * grammar of group cards, a tap on an entry opens what can be done with it.
 * The model is shared (`memoryGroups`); nothing here decides on its own.
 */
export function MobileMemoryView({ onOpenNote, onOpenWaiting, onReviewRules }: { onOpenNote: (path: string) => void; onOpenWaiting: () => void; onReviewRules: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  /** The entry form: a new one (`id` null) or an existing one to reword. */
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [rule, setRule] = useState(false);
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<{ title: string; caps: MemoryRowCaps } | null>(null);

  useEffect(() => {
    void session.refreshMemory();
    void session.refreshSkills();
  }, [session]);

  const memory = state.memory;
  if (!memory.available) {
    return (
      <div className="m-settings" data-testid="ai-memory">
        <p className="m-hint">{t("ai.memory.unavailable")}</p>
      </div>
    );
  }
  const groups = memoryGroups(t, memory, i18n.language);
  const waiting = state.drafts.drafts.filter((draft) => draft.body.kind === "memory" || draft.body.kind === "forget" || draft.body.kind === "rule").length;
  const agents = workshopSections(state.skills.entries).agents;
  const shownLong = filterMemoryRows(groups.long, query);
  /** A group's name with how many entries it holds — "Always included · 4"; the name alone while it is empty. */
  const counted = (name: string, count: number) => (count > 0 ? `${name} · ${count}` : name);

  const remove = (row: MemoryRow) => {
    void mConfirm({ title: t("ai.memory.deleteConfirm"), message: `${row.text}\n\n${t("ai.memory.deleteBody")}`, danger: true, confirmLabel: t("ai.memory.action.delete") }).then((ok) => {
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
  const capsFor = (row: MemoryRow): MemoryRowCaps => ({
    edit: () => setForm({ id: row.id }),
    ...(row.place === "active" ? { toLong: () => move(row) } : { toActive: () => move(row) }),
    delete: () => remove(row),
  });
  const rowOf = (row: MemoryRow) => (
    <Row
      key={row.id}
      title={row.text}
      // What a reader has to know first — a rule the entry carries, or why it goes nowhere — then who added it.
      subtitle={[...row.marks.map((mark) => mark.text), row.description].join(" · ")}
      wrap
      disabled={!memory.writable}
      onClick={() => setSheet({ title: row.text, caps: capsFor(row) })}
      data-testid="ai-memory-entry"
    />
  );

  return (
    <div className="m-settings" data-testid="ai-memory">
      <div className="m-skills-actions">
        <Button variant="tonal" icon={<Plus size={ICON.ui} />} disabled={!memory.writable} onClick={() => setForm({ id: null })} data-testid="ai-memory-new">
          {t("ai.memory.newEntry")}
        </Button>
      </div>
      <GroupCard>
        <RowList>
          <Row
            controls
            title={t("ai.memory.use")}
            subtitle={t(memory.on ? "ai.memory.useDesc" : "ai.memory.off")}
            wrap
            end={<Switch checked={memory.on} label={t("ai.memory.use")} onChange={(on) => void session.switchMemory(on)} data-testid="ai-memory-switch" />}
          />
        </RowList>
      </GroupCard>
      {waiting > 0 && (
        <Banner
          kind="info"
          actions={
            <Button size="sm" variant="secondary" onClick={onOpenWaiting} data-testid="ai-memory-waiting">
              {t("ai.memory.waitingShow")}
            </Button>
          }
        >
          {t("ai.memory.waiting", { count: waiting })}
        </Banner>
      )}
      <SectionLabel>{counted(t("ai.memory.active"), groups.active.length)}</SectionLabel>
      <div className="m-hint">
        <MemoryMeter fill={groups.fill} label={groups.budget} />
      </div>
      {/* A group with nothing in it is a sentence on the page's edge, not a card: a card's edge belongs to its rows. */}
      {groups.active.length === 0 ? (
        <p className="m-hint">{t("ai.memory.activeEmpty")}</p>
      ) : (
        <GroupCard>
          <RowList>{groups.active.map(rowOf)}</RowList>
        </GroupCard>
      )}
      {memory.cut.includes("active") && <p className="m-hint">{t("ai.memory.cut")}</p>}
      <SectionLabel>{counted(t("ai.memory.long"), groups.long.length)}</SectionLabel>
      {groups.long.length > MEMORY_SEARCH_FROM && (
        <SearchField value={query} onValueChange={setQuery} placeholder={t("ai.memory.search")} aria-label={t("ai.memory.search")} clearLabel={t("sidebar.clearSearch")} data-testid="ai-memory-search" />
      )}
      {groups.long.length === 0 ? (
        <p className="m-hint">{t("ai.memory.longEmpty")}</p>
      ) : shownLong.length === 0 ? (
        <p className="m-hint">{t("ai.memory.searchNone")}</p>
      ) : (
        <GroupCard>
          <RowList>{shownLong.map(rowOf)}</RowList>
        </GroupCard>
      )}
      {memory.cut.includes("long") && <p className="m-hint">{t("ai.memory.cut")}</p>}
      <SectionLabel>{t("ai.memory.rules.title")}</SectionLabel>
      <GroupCard>
        <RowList>
          {agents && (agents.status === "new" || agents.status === "changed") && (
            <Row title={t("ai.workshop.vault")} subtitle={t(`ai.workshop.status.${agents.status}`)} onClick={() => onReviewRules(agents.source.id)} end={<ChevronRight size={ICON.ui} />} data-testid="ai-memory-rules-review" />
          )}
          <Row title={t("ai.memory.rules.add")} subtitle={t("ai.memory.rules.desc")} wrap disabled={!memory.writable} onClick={() => setRule(true)} end={<Plus size={ICON.ui} />} data-testid="ai-memory-rule-new" />
          {/* With the file's standing on this phone: a rule in a file that waits is not in effect. */}
          {agents && (
            <Row
              title={t("ai.memory.rules.open")}
              subtitle={`AGENTS.md · ${t(`ai.workshop.status.${agents.status}`)}`}
              onClick={() => onOpenNote("AGENTS.md")}
              end={<ChevronRight size={ICON.ui} />}
              data-testid="ai-memory-rules-open"
            />
          )}
        </RowList>
      </GroupCard>
      <p className="m-hint">{t("ai.memory.files")}</p>
      {/* The memory is the user's files: each one that is there opens in the editor. */}
      {memory.files.length > 0 && (
        <GroupCard>
          <RowList>
            {memory.files.map((place) => (
              <Row
                key={place}
                title={t("ai.memory.openFile")}
                subtitle={`${t(place === "active" ? "ai.memory.active" : "ai.memory.long")} · ${memoryFileOf(place)}`}
                wrap
                onClick={() => onOpenNote(memoryFileOf(place))}
                end={<ChevronRight size={ICON.ui} />}
                data-testid={`ai-memory-file-${place}`}
              />
            ))}
          </RowList>
        </GroupCard>
      )}
      {form && <MemoryEntrySheet id={form.id} onClose={() => setForm(null)} />}
      {rule && <MemoryRuleSheet onClose={() => setRule(false)} />}
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          // The sheet closes with the choice: what an action opens — the form, a question — must not lie under it.
          actions={memoryRowActions(t, sheet.caps).map((a) => ({
            icon: <a.icon size={ICON.head} />,
            label: a.label,
            danger: a.danger,
            testId: `ai-memory-action-${a.id}`,
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
