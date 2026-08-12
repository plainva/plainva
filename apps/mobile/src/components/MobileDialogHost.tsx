import { useMemo, useState, useSyncExternalStore } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import { Button, type CascadeGroup, type CascadeSelection, Checkbox, Chip, type DeletionPlan, effectiveGroupChecked, GroupCard, groupId, initialSelection, Row, RowList, SearchField, selectedPaths, TextInput, ScrollEdge} from "@plainva/ui";
import {
  currentMobileDialog,
  dismissMobileDialog,
  subscribeMobileDialogs,
  type MobileDialog,
  type MobileSelectOption,
} from "../services/mobileDialogs";

/** Substring match over label and the secondary line, accent-blind enough for
 *  a phone: what people type is what they saw on the node. */
function filterOptions(options: MobileSelectOption[], filter: string): MobileSelectOption[] {
  const q = filter.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || (o.desc ?? "").toLowerCase().includes(q),
  );
}

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
  const [filter, setFilter] = useState("");

  const cancel = () => {
    if (dialog.kind === "prompt") dialog.resolve({ value: "", cancelled: true });
    else if (dialog.kind === "confirm") dialog.resolve(false);
    else dialog.resolve(null);
    dismissMobileDialog(dialog);
  };

  if (dialog.kind === "cascade") {
    return <CascadeSheet dialog={dialog} onCancel={cancel} />;
  }

  if (dialog.kind === "answers") {
    return <AnswersSheet dialog={dialog} onCancel={cancel} />;
  }

  const submitPrompt = () => {
    if (dialog.kind !== "prompt") return;
    dialog.resolve({ value: text, cancelled: false });
    dismissMobileDialog(dialog);
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={cancel}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={cancel} />
        <p className="m-sheet-title">{dialog.title}</p>
        {dialog.message && <p className="m-hint m-hint--inset">{dialog.message}</p>}

        {dialog.kind === "prompt" && (
          <>
            <div className="m-sheet-inputrow">
              <TextInput
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPrompt();
                }}
                placeholder={dialog.placeholder}
                type={dialog.secure ? "password" : "text"}
                value={text}
              />
            </div>
            <div className="m-btnrow">
              <Button variant="ghost" onClick={cancel}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={submitPrompt}>
                {t("common.ok")}
              </Button>
            </div>
          </>
        )}

        {dialog.kind === "confirm" && (
          <div className="m-btnrow">
            <Button variant="ghost" onClick={cancel}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={dialog.danger ? "danger" : "primary"}
              onClick={() => {
                dialog.resolve(true);
                dismissMobileDialog(dialog);
              }}
            >
              {dialog.confirmLabel ?? t("common.confirm")}
            </Button>
          </div>
        )}

        {dialog.kind === "select" && dialog.search && (
          <SearchField
            clearLabel={t("sidebar.clearSearch")}
            onValueChange={setFilter}
            placeholder={dialog.search}
            value={filter}
          />
        )}
        {/* The container grammar, applied to the last surface without it (E2).
            This was a run of loose rows — no card, no hairlines — and the mark
            for the current choice sat at the far END, so the eye crossed the
            whole row to find out what is selected. Every selection in the app
            runs through this sheet, so this is about a dozen surfaces, not one.
            The mark is the app's own slot mark, moved to the front: a second
            shape for "this one is chosen" would be a dialect, and its column
            exists on every row, so the list does not shift when the choice
            moves. */}
        {dialog.kind === "select" && (
          <GroupCard>
            <RowList>
              {filterOptions(dialog.options, dialog.search ? filter : "").map((opt) => (
                <Row
                  key={opt.value}
                  icon={<span className={`m-slotmark${dialog.value === opt.value ? " is-on" : ""}`} />}
                  title={opt.label}
                  subtitle={opt.desc}
                  onClick={() => {
                    dialog.resolve(opt.value);
                    dismissMobileDialog(dialog);
                  }}
                />
              ))}
            </RowList>
          </GroupCard>
        )}
      </div>
    </div>
  );
}

/**
 * Every question a template asks, in ONE sheet (plan Vorlagen-Engine, P6).
 *
 * A `select` question renders as chips rather than a native dropdown: a second
 * OS wheel on top of the sheet would be exactly the stacked-decision problem
 * this sheet exists to remove. Text and date fields use the shared `.m-field`
 * row, so the sheet looks like every other form on the phone.
 */
function AnswersSheet({
  dialog,
  onCancel,
}: {
  dialog: Extract<MobileDialog, { kind: "answers" }>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      dialog.fields.map((f) => [
        f.label,
        f.defaultValue ?? (f.kind === "select" ? (f.options?.[0] ?? "") : ""),
      ]),
    ),
  );
  const set = (label: string, value: string) => setAnswers((prev) => ({ ...prev, [label]: value }));

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onCancel}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onCancel} />
        <p className="m-sheet-title">{dialog.title}</p>
        {dialog.message && <p className="m-hint m-hint--inset">{dialog.message}</p>}
        {dialog.fields.map((field, i) =>
          field.kind === "select" ? (
            <div className="m-field" key={field.label}>
              <span>{field.label}</span>
              <ScrollEdge axis="x" className="m-chiprow">
                {(field.options ?? []).map((opt) => (
                  <Chip selected={answers[field.label] === opt} key={opt} onClick={() => set(field.label, opt)}>
                    {opt}
                  </Chip>
                ))}
              </ScrollEdge>
            </div>
          ) : (
            <label className="m-field" key={field.label}>
              <span>{field.label}</span>
              <TextInput
                autoFocus={i === 0}
                onChange={(e) => set(field.label, e.target.value)}
                type={field.kind === "date" ? "date" : "text"}
                value={answers[field.label] ?? ""}
              />
            </label>
          ),
        )}
        <div className="m-btnrow">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              dialog.resolve(answers);
              dismissMobileDialog(dialog);
            }}
          >
            {t("common.ok")}
          </Button>
        </div>
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
          <Checkbox
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
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onCancel} />
        <p className="m-sheet-title">{dialog.title}</p>
        {dialog.message && <p className="m-hint m-hint--inset">{dialog.message}</p>}
        {rows}
        {cleanupCount > 0 && (
          <label className="m-cascade-row">
            <Checkbox
              checked={sel.cleanupRefs}
              onChange={(e) => setSel((prev) => ({ ...prev, cleanupRefs: e.target.checked }))}
            />
            <span className="m-cascade-main">{t("cascade.cleanupToggle")}</span>
            <span className="m-cascade-count">{cleanupCount}</span>
          </label>
        )}
        <div className="m-btnrow">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              dialog.resolve(sel);
              dismissMobileDialog(dialog);
            }}
          >
            {t("cascade.deleteN", { count })}
          </Button>
        </div>
      </div>
    </div>
  );
}
