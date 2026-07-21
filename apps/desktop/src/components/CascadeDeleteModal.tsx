import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, Database, FileText } from "lucide-react";
import {
  Button,
  Checkbox,
  ICON,
  Modal,
  cleanupRefsFor,
  effectiveGroupChecked,
  groupId,
  initialSelection,
  noteDisplayName,
  selectedPaths,
  type CascadeElement,
  type CascadeGroup,
  type CascadeSelection,
  type DeletionPlan,
} from "@plainva/ui";

/**
 * THE cascade deletion dialog (plan Kaskadenloeschung, mockup-approved): a
 * "will be deleted" card, one quiet card per consequence group with a group
 * checkbox + count pill + collapsible per-element opt-out list, an explicit
 * two-step card per linked database, a clean-up card, and a danger button
 * that live-counts the actual selection. The host runs the existing
 * large-deletion second prompt and the execution.
 */

export interface CascadeDeleteModalProps {
  plan: DeletionPlan;
  syncActive: boolean;
  /** The deleted base is the configured default task database (hint line). */
  taskDbAffected: boolean;
  busy: boolean;
  progress: { done: number; total: number } | null;
  onCancel: () => void;
  onConfirm: (selection: CascadeSelection) => void;
}

/** Children directly under their parent (mockup): DFS over the in-group edges. */
function orderHierarchically(items: CascadeElement[], edges: DeletionPlan["incomingEdges"]): CascadeElement[] {
  if (items.length < 2) return items;
  const byPath = new Map(items.map((i) => [i.path, i]));
  const children = new Map<string, CascadeElement[]>();
  for (const e of edges) {
    const child = byPath.get(e.source);
    if (!child || !byPath.has(e.target) || e.target === e.source) continue;
    const bucket = children.get(e.target) ?? [];
    if (!bucket.includes(child)) bucket.push(child);
    children.set(e.target, bucket);
  }
  const minDepth = Math.min(...items.map((i) => i.depth));
  const out: CascadeElement[] = [];
  const seen = new Set<string>();
  const visit = (item: CascadeElement) => {
    if (seen.has(item.path)) return;
    seen.add(item.path);
    out.push(item);
    for (const child of children.get(item.path) ?? []) visit(child);
  };
  for (const item of items) if (item.depth === minDepth) visit(item);
  for (const item of items) visit(item); // stragglers (multi-parent)
  return out;
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx + 1);
}

export function CascadeDeleteModal({
  plan,
  syncActive,
  taskDbAffected,
  busy,
  progress,
  onCancel,
  onConfirm,
}: CascadeDeleteModalProps) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<CascadeSelection>(() => initialSelection(plan));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const paths = useMemo(() => selectedPaths(plan, sel), [plan, sel]);
  const cleanupSources = useMemo(() => {
    const refs = cleanupRefsFor(plan, new Set(paths));
    return new Set(refs.map((r) => r.source)).size;
  }, [plan, paths]);

  const title =
    plan.primary.length === 1
      ? t(plan.primary[0].kind === "base" ? "cascade.titleBase" : "cascade.titleNote", { name: plan.primary[0].title })
      : t("cascade.titleMany", { count: plan.primary.length });

  const toggleGroup = (g: CascadeGroup, checked: boolean) =>
    setSel((prev) => ({ ...prev, groups: { ...prev.groups, [groupId(g)]: checked } }));
  const toggleItem = (path: string, included: boolean) =>
    setSel((prev) => {
      const excluded = new Set(prev.excluded);
      if (included) excluded.delete(path);
      else excluded.add(path);
      return { ...prev, excluded };
    });
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderItems = (g: CascadeGroup) => {
    const id = groupId(g);
    if (g.items.length === 0) return null;
    const open = expanded.has(id);
    const groupPaths = new Set(g.items.map((i) => i.path));
    return (
      <>
        <button type="button" className="pv-cascade-showbtn" onClick={() => toggleExpanded(id)} data-testid="cascade-show-items">
          <ChevronRight
            size={ICON.meta}
            aria-hidden
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          />
          {open ? t("cascade.hideItems") : t("cascade.showItems", { count: g.items.length })}
        </button>
        {open && (
          <div className="pv-cascade-items">
            {orderHierarchically(g.items, plan.incomingEdges).map((item) => {
              const included = !sel.excluded.has(item.path);
              const subs = plan.incomingEdges.filter((e) => e.target === item.path && groupPaths.has(e.source)).length;
              return (
                <div key={item.path} className={`pv-cascade-item${item.depth > 1 ? " pv-cascade-item--sub" : ""}${included ? "" : " is-off"}`}>
                  <Checkbox
                    checked={included}
                    disabled={busy}
                    onChange={(e) => toggleItem(item.path, e.target.checked)}
                    aria-label={item.title}
                  />
                  <span className="pv-cascade-item-ic" aria-hidden>
                    <FileText size={ICON.meta} />
                  </span>
                  <span className="pv-cascade-item-title">{item.title}</span>
                  <span className="pv-cascade-item-path">{folderOf(item.path)}</span>
                  {item.sharedWith.length > 0 && (
                    <span className="pv-cascade-badge pv-cascade-badge--warn">
                      {t("cascade.badgeShared", { name: item.sharedWith[0] })}
                    </span>
                  )}
                  {item.sharedWith.length === 0 && item.alsoMemberOf.length > 0 && (
                    <span className="pv-cascade-badge pv-cascade-badge--warn">
                      {t("cascade.badgeAlsoIn", { base: item.alsoMemberOf.join(", ") })}
                    </span>
                  )}
                  {item.sharedWith.length === 0 && item.alsoMemberOf.length === 0 && subs > 0 && (
                    <span className="pv-cascade-badge pv-cascade-badge--muted">{t("cascade.badgeSubs", { count: subs })}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const groupCard = (g: CascadeGroup, labelKey: string, toggleKey: string, descNode: React.ReactNode) => {
    const id = groupId(g);
    const checked = effectiveGroupChecked(plan, sel, g);
    const selCount = g.items.filter((i) => !sel.excluded.has(i.path)).length;
    const sharedExcluded = g.items.filter((i) => i.sharedWith.length > 0 && sel.excluded.has(i.path)).length;
    const memberExcluded = g.items.filter(
      (i) => i.sharedWith.length === 0 && i.alsoMemberOf.length > 0 && sel.excluded.has(i.path)
    ).length;
    return (
      <div key={id}>
        <div className="pv-setgroup-label">{labelKey}</div>
        <div className="pv-setcard">
          <div className="pv-cascade-row">
            <Checkbox
              checked={checked}
              disabled={busy}
              onChange={(e) => toggleGroup(g, e.target.checked)}
              aria-label={toggleKey}
              data-testid={`cascade-group-${g.kind}`}
            />
            <div className="pv-cascade-main">
              <div className="pv-cascade-label">{toggleKey}</div>
              <div className="pv-cascade-desc">{descNode}</div>
            </div>
            <span className="pv-cascade-count">
              {t("cascade.countOf", { selected: selCount, total: g.kind === "linkedAssigned" && g.baseTotal ? g.baseTotal : g.items.length })}
            </span>
          </div>
          {sharedExcluded > 0 && <div className="pv-cascade-note">{t("cascade.excludedShared", { count: sharedExcluded })}</div>}
          {memberExcluded > 0 && <div className="pv-cascade-note">{t("cascade.excludedMembers", { count: memberExcluded })}</div>}
          {renderItems(g)}
        </div>
      </div>
    );
  };

  // linked pairs render as ONE named card with the two steps.
  const linkedPairs = useMemo(() => {
    const pairs = new Map<string, { assigned?: CascadeGroup; all?: CascadeGroup }>();
    for (const g of plan.groups) {
      if (g.kind !== "linkedAssigned" && g.kind !== "linkedAll") continue;
      const entry = pairs.get(g.basePath) ?? {};
      if (g.kind === "linkedAssigned") entry.assigned = g;
      else entry.all = g;
      pairs.set(g.basePath, entry);
    }
    return pairs;
  }, [plan]);

  const linkedCard = (basePath: string, pair: { assigned?: CascadeGroup; all?: CascadeGroup }) => {
    const label = pair.assigned?.baseLabel ?? pair.all?.baseLabel ?? noteDisplayName(basePath);
    const assigned = pair.assigned;
    const all = pair.all;
    const assignedChecked = assigned ? effectiveGroupChecked(plan, sel, assigned) : false;
    const allChecked = all ? effectiveGroupChecked(plan, sel, all) : false;
    const assignedSel = assigned ? assigned.items.filter((i) => !sel.excluded.has(i.path)).length : 0;
    return (
      <div key={`linked ${basePath}`}>
        <div className="pv-setgroup-label">{t("cascade.groupLinked", { base: label })}</div>
        <div className="pv-setcard">
          {assigned && assigned.items.length > 0 && (
            <div className="pv-cascade-row">
              <Checkbox
                checked={assignedChecked}
                disabled={busy || allChecked}
                onChange={(e) => toggleGroup(assigned, e.target.checked)}
                aria-label={t("cascade.linkedAssignedToggle")}
                data-testid="cascade-group-linkedAssigned"
              />
              <div className="pv-cascade-main">
                <div className="pv-cascade-label">{t("cascade.linkedAssignedToggle")}</div>
                <div className="pv-cascade-desc">{t("cascade.linkedAssignedDesc", { count: assigned.items.length })}</div>
              </div>
              <span className="pv-cascade-count">
                {t("cascade.countOf", { selected: assignedSel, total: assigned.baseTotal ?? assigned.items.length })}
              </span>
            </div>
          )}
          {all && (
            <div className="pv-cascade-row pv-cascade-row--danger">
              <Checkbox
                checked={allChecked}
                disabled={busy}
                onChange={(e) => toggleGroup(all, e.target.checked)}
                aria-label={t("cascade.linkedAllToggle", { name: label })}
                data-testid="cascade-group-linkedAll"
              />
              <div className="pv-cascade-main">
                <div className="pv-cascade-label">{t("cascade.linkedAllToggle", { name: label })}</div>
                <div className="pv-cascade-desc">{t("cascade.linkedAllDesc")}</div>
              </div>
              <span className="pv-cascade-count">{t("cascade.fileBadge", { count: (all.items.length + assignedSel) + 1 })}</span>
            </div>
          )}
          {assigned && renderItems(assigned)}
        </div>
      </div>
    );
  };

  const showCleanupCard = cleanupSources > 0 || plan.affectedBases.length > 0;

  return (
    <Modal
      onClose={onCancel}
      title={title}
      icon={<AlertTriangle size={ICON.head} className="pv-dialog-ic pv-dialog-ic--danger" aria-hidden />}
      size="md"
      closeOnOverlay={false}
      hideClose={busy}
      testId="cascade-delete-modal"
      footer={
        <>
          <span className="pv-cascade-foot">
            {busy && progress
              ? t("cascade.deleting", { done: progress.done, total: progress.total })
              : `${syncActive ? `${t("dialogs.deleteSyncNote")} ` : ""}${t("cascade.footHint", { restore: t("versions.deletedTitle") })}`}
          </span>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={() => onConfirm(sel)} disabled={busy || paths.length === 0} data-testid="cascade-confirm">
            {t("cascade.deleteN", { count: paths.length })}
          </Button>
        </>
      }
    >
      <div className="pv-cascade">
        {plan.primary.length === 1 && (
          <div className="pv-cascade-desc">
            {plan.primary[0].path}
            {linkedPairs.size > 0 &&
              ` · ${t("cascade.subtitleLinked", { base: [...linkedPairs.values()].map((p) => (p.assigned ?? p.all)?.baseLabel).filter(Boolean).join(", ") })}`}
          </div>
        )}

        <div>
          <div className="pv-setgroup-label">{t("cascade.groupPrimary")}</div>
          <div className="pv-setcard">
            {plan.primary.map((p, i) => (
              <div key={p.path} className="pv-cascade-row">
                <span className="pv-cascade-item-ic" aria-hidden>
                  {p.kind === "base" ? <Database size={ICON.ui} /> : <FileText size={ICON.ui} />}
                </span>
                <div className="pv-cascade-main">
                  <div className="pv-cascade-label">{p.title}</div>
                  {plan.primary.length === 1 && (
                    <div className="pv-cascade-desc">
                      {t(p.kind === "base" ? "cascade.primaryBaseDesc" : "cascade.primaryNoteDesc")}
                    </div>
                  )}
                </div>
                {i === 0 && <span className="pv-cascade-count">{t("cascade.fileBadge", { count: plan.primary.length })}</span>}
              </div>
            ))}
          </div>
        </div>

        {plan.groups.map((g) => {
          if (g.kind === "dbItems") {
            const label =
              plan.affectedBases.length > 1
                ? `${t("cascade.groupDbItems")} · ${g.baseLabel}`
                : t("cascade.groupDbItems");
            return groupCard(g, label, t("cascade.dbItemsToggle"), t("cascade.dbItemsDesc"));
          }
          if (g.kind === "assigned") {
            const label = g.baseLabel
              ? t("cascade.groupAssignedOf", { base: g.baseLabel })
              : t("cascade.groupAssigned");
            return groupCard(g, label, t("cascade.assignedToggle"), t("cascade.assignedDesc"));
          }
          return null; // linked pairs render below
        })}

        {[...linkedPairs.entries()].map(([basePath, pair]) => linkedCard(basePath, pair))}

        {showCleanupCard && (
          <div>
            <div className="pv-setgroup-label">{t("cascade.groupCleanup")}</div>
            <div className="pv-setcard">
              {cleanupSources > 0 && (
                <div className="pv-cascade-row">
                  <Checkbox
                    checked={sel.cleanupRefs}
                    disabled={busy}
                    onChange={(e) => setSel((prev) => ({ ...prev, cleanupRefs: e.target.checked }))}
                    aria-label={t("cascade.cleanupToggle")}
                    data-testid="cascade-cleanup"
                  />
                  <div className="pv-cascade-main">
                    <div className="pv-cascade-label">{t("cascade.cleanupToggle")}</div>
                    <div className="pv-cascade-desc">{t("cascade.cleanupDesc", { count: cleanupSources })}</div>
                  </div>
                </div>
              )}
              {taskDbAffected && <div className="pv-cascade-note">{t("cascade.cleanupTaskDb")}</div>}
              {plan.affectedBases.length > 0 && <div className="pv-cascade-note">{t("cascade.cleanupTemplates")}</div>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
