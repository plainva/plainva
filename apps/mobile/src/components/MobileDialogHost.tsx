import { useMemo, useState, useSyncExternalStore } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import {
  effectiveGroupChecked,
  groupId,
  initialSelection,
  selectedPaths,
  type CascadeGroup,
  type CascadeSelection,
  type DeletionPlan,
} from "@plainva/ui";
import {
  currentMobileDialog,
  dismissMobileDialog,
  subscribeMobileDialogs,
  type MobileDialog,
} from "../services/mobileDialogs";

/**
 * Renders the pending mobileDialogs request as an M3 bottom sheet (R3.3).
 * Mounted once in main.tsx; the sheet sits above every other surface
 * (backdrop --dialog), backdrop taps cancel.
 */
export function MobileDialogHost() {
  const dialog = useSyncExternalStore(subscribeMobileDialogs, currentMobileDialog);
  if (!dialog) return null;
  // Remount per request so input state never leaks between dialogs.
  return <DialogSheet dialog={dialog} key={dialog.id} />;
}

function DialogSheet({ dialog }: { dialog: MobileDialog }) {
  const { t } = useTranslation();
  const [text, setText] = useState(dialog.kind === "prompt" ? (dialog.initial ?? "") : "");

  const cancel = () => {
    if (dialog.kind === "prompt") dialog.resolve({ value: "", cancelled: true });
    else if (dialog.kind === "confirm") dialog.resolve(false);
    else dialog.resolve(null);
    dismissMobileDialog(dialog);
  };

  if (dialog.kind === "cascade") {
    return <CascadeSheet dialog={dialog} onCancel={cancel} />;
  }

  const submitPrompt = () => {
    if (dialog.kind !== "prompt") return;
    dialog.resolve({ value: text, cancelled: false });
    dismissMobileDialog(dialog);
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={cancel}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={cancel} />
        <p className="m-sheet-title">{dialog.title}</p>
        {dialog.message && <p className="m-hint m-hint--inset">{dialog.message}</p>}

        {dialog.kind === "prompt" && (
          <>
            <div className="m-sheet-inputrow">
              <input
                autoFocus
                className="m-searchfield"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPrompt();
                }}
                placeholder={dialog.placeholder}
                value={text}
              />
            </div>
            <div className="m-btnrow">
              <button className="m-btn" onClick={cancel}>
                {t("common.cancel")}
              </button>
              <button className="m-btn m-btn--filled" onClick={submitPrompt}>
                {t("common.ok")}
              </button>
            </div>
          </>
        )}

        {dialog.kind === "confirm" && (
          <div className="m-btnrow">
            <button className="m-btn" onClick={cancel}>
              {t("common.cancel")}
            </button>
            <button
              className={`m-btn m-btn--filled${dialog.danger ? " m-btn--danger" : ""}`}
              onClick={() => {
                dialog.resolve(true);
                dismissMobileDialog(dialog);
              }}
            >
              {dialog.confirmLabel ?? t("common.confirm")}
            </button>
          </div>
        )}

        {dialog.kind === "select" &&
          dialog.options.map((opt) => (
            <button
              className="m-row"
              key={opt.value}
              onClick={() => {
                dialog.resolve(opt.value);
                dismissMobileDialog(dialog);
              }}
            >
              <span>
                {opt.label}
                {opt.desc && <span className="m-select-desc">{opt.desc}</span>}
              </span>
              <span className={`m-slotmark${dialog.value === opt.value ? " is-on" : ""}`} />
            </button>
          ))}
      </div>
    </div>
  );
}

/**
 * Cascade-deletion sheet (plan Kaskadenloeschung, mobile v1): the shared plan
 * rendered as group rows with a checkbox + counter — assigned elements, rows
 * of a deleted base, and one two-step block per linked database (step 2 is
 * danger-tinted and implies step 1). No per-element opt-out on mobile; the
 * plan's shared/multi-membership exclusions still apply. The danger button
 * live-counts the actual selection.
 */
function CascadeSheet({
  dialog,
  onCancel,
}: {
  dialog: Extract<MobileDialog, { kind: "cascade" }>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const plan: DeletionPlan = dialog.plan;
  const [sel, setSel] = useState<CascadeSelection>(() => initialSelection(plan));
  const count = useMemo(() => selectedPaths(plan, sel).length, [plan, sel]);

  const toggle = (g: CascadeGroup, on: boolean) =>
    setSel((prev) => ({ ...prev, groups: { ...prev.groups, [groupId(g)]: on } }));

  const excludedNote = (g: CascadeGroup): string | null => {
    const shared = g.items.filter((i) => i.sharedWith.length > 0 && sel.excluded.has(i.path)).length;
    const members = g.items.filter((i) => i.sharedWith.length === 0 && i.alsoMemberOf.length > 0 && sel.excluded.has(i.path)).length;
    const parts: string[] = [];
    if (shared > 0) parts.push(t("cascade.excludedShared", { count: shared }));
    if (members > 0) parts.push(t("cascade.excludedMembers", { count: members }));
    return parts.length > 0 ? parts.join(" ") : null;
  };

  const groupRow = (g: CascadeGroup, label: string, danger = false, impliedBy?: CascadeGroup) => {
    const checked = effectiveGroupChecked(plan, sel, g);
    const lockedByAll = !!impliedBy && (sel.groups[groupId(impliedBy)] ?? impliedBy.defaultChecked);
    const selCount = g.items.filter((i) => !sel.excluded.has(i.path)).length;
    const note = excludedNote(g);
    return (
      <div key={groupId(g)}>
        <label className={`m-cascade-row${danger ? " m-cascade-row--danger" : ""}`}>
          <input
            type="checkbox"
            checked={checked}
            disabled={lockedByAll}
            onChange={(e) => toggle(g, e.target.checked)}
          />
          <span className="m-cascade-main">{label}</span>
          <span className="m-cascade-count">
            {g.kind === "linkedAll"
              ? t("cascade.fileBadge", { count: g.items.length + selCount + 1 })
              : t("cascade.countOf", { selected: selCount, total: g.kind === "linkedAssigned" && g.baseTotal ? g.baseTotal : g.items.length })}
          </span>
        </label>
        {note && <p className="m-cascade-note">{note}</p>}
      </div>
    );
  };

  const rows: React.ReactNode[] = [];
  const linkedAllByBase = new Map(plan.groups.filter((g) => g.kind === "linkedAll").map((g) => [g.basePath, g]));
  for (const g of plan.groups) {
    if (g.kind === "dbItems") rows.push(groupRow(g, t("cascade.dbItemsToggle")));
    else if (g.kind === "assigned") {
      if (g.items.length > 0)
        rows.push(groupRow(g, g.baseLabel ? t("cascade.groupAssignedOf", { base: g.baseLabel }) : t("cascade.groupAssigned")));
    } else if (g.kind === "linkedAssigned") {
      if (g.items.length > 0)
        rows.push(groupRow(g, t("cascade.groupLinked", { base: g.baseLabel }), false, linkedAllByBase.get(g.basePath)));
    } else if (g.kind === "linkedAll") {
      rows.push(groupRow(g, t("cascade.linkedAllToggle", { name: g.baseLabel }), true));
    }
  }
  const cleanupCount = useMemo(() => {
    const set = new Set(selectedPaths(plan, sel));
    return new Set(plan.incomingEdges.filter((e) => set.has(e.target) && !set.has(e.source)).map((e) => e.source)).size;
  }, [plan, sel]);

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onCancel}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onCancel} />
        <p className="m-sheet-title">{dialog.title}</p>
        {dialog.message && <p className="m-hint m-hint--inset">{dialog.message}</p>}
        {rows}
        {cleanupCount > 0 && (
          <label className="m-cascade-row">
            <input
              type="checkbox"
              checked={sel.cleanupRefs}
              onChange={(e) => setSel((prev) => ({ ...prev, cleanupRefs: e.target.checked }))}
            />
            <span className="m-cascade-main">{t("cascade.cleanupToggle")}</span>
            <span className="m-cascade-count">{cleanupCount}</span>
          </label>
        )}
        <div className="m-btnrow">
          <button className="m-btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            className="m-btn m-btn--filled m-btn--danger"
            onClick={() => {
              dialog.resolve(sel);
              dismissMobileDialog(dialog);
            }}
          >
            {t("cascade.deleteN", { count })}
          </button>
        </div>
      </div>
    </div>
  );
}
