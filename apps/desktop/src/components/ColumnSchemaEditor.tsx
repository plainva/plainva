import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, AlertTriangle, GripVertical, ChevronDown, Lock, Type } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Select, type SelectOption } from "./Select";
import { useRowDrag } from "./base/useRowDrag";
import { PALETTE_NAMES, PALETTE_SWATCH, chipClass, groupOptions, type CuratedOption } from "./propertyModel";
import { isValidNewPropertyName } from "./base/renameProperty";
import { TypeMenu, BASE_TYPE_GROUPS, TYPE_ICONS, typeLabel, type MenuPropertyType } from "./PropertyValues";
import { findReverseColumn, isValidReverseColumnName } from "../services/baseRelations";
import type { ColumnSchema } from "../services/baseSchema";

type TFn = (key: string, opts?: any) => string;

/** What the Save button asks the host to do about the counterpart's reverse column. */
export interface ReverseIntent {
  action: "create" | "remove";
  name: string;
}

/** Display stem of a `.base` path ("DB/Projekte.base" -> "Projekte"). */
function baseStem(path: string): string {
  return path.split("/").pop()?.replace(/\.base$/i, "") || path;
}

/**
 * Authoring UI for a `.base` column's typed schema (ADR 0008, TS-5): input type,
 * curated options (value/color/group) for select/status/multiselect, and the
 * relation target base. Renders as a modal so it is never clipped by the table's
 * horizontal scroll; saves the merged schema through the BaseViewer's saveConfig.
 *
 * The option editor is widened and shows a live chip preview so the effect of
 * colors and (for status) groups/stages is obvious.
 *
 * The property can also be RENAMED here (Base-UX2 follow-up): editing the name
 * hands `newName` to onSave; the BaseViewer then rewrites the config and the
 * frontmatter key in the matching notes.
 */
export function ColumnSchemaEditor({ column, schema, baseFiles, currentBasePath, existingColumns = [], missingCount, onFillMissing, loadBaseConfig, onSave, onDelete, onClose, t }: {
  column: string;
  schema: ColumnSchema;
  baseFiles: string[];
  currentBasePath: string;
  /** All bare property names of this base (collision check for renames). */
  existingColumns?: string[];
  /** In how many of the currently shown notes this property is NOT set. */
  missingCount?: number;
  /** Explicit bulk materialization (decision F1): write the property (empty)
   * into every shown note that lacks it — never done implicitly. */
  onFillMissing?: () => void;
  /** Loads a `.base` config (prop-injected so the editor stays testable);
   * powers the "show on target" pre-fill + name validation. */
  loadBaseConfig?: (path: string) => Promise<any>;
  /** `newName` is set when the user renamed the property (already validated);
   * `reverseIntent` when the "show on target" checkbox changed vs the target file. */
  onSave: (s: ColumnSchema, newName?: string, reverseIntent?: ReverseIntent) => void;
  /** Opens the host's delete-property confirmation (plan Base-Neu P11). */
  onDelete?: () => void;
  onClose: () => void;
  t: TFn;
}) {
  const [input, setInput] = useState<string>(schema.input || "text");
  const [options, setOptions] = useState<CuratedOption[]>(schema.options ? schema.options.map((o) => ({ ...o })) : []);
  const [relationBase, setRelationBase] = useState<string>(schema.relationBase || "");
  const [relationLimit, setRelationLimit] = useState<string>(schema.relationLimit === "one" ? "one" : "");
  const [name, setName] = useState<string>(column);
  // "Auf Ziel anzeigen" (Notion "Show on related database"): checkbox + name of
  // the reverse column in the TARGET base, pre-filled from the target's config.
  const [showOnTarget, setShowOnTarget] = useState(false);
  const [reverseName, setReverseName] = useState<string>(baseStem(currentBasePath));
  const [existingReverse, setExistingReverse] = useState<string | null>(null);
  const [targetConfig, setTargetConfig] = useState<any | null>(null);
  const typeBtnRef = useRef<HTMLButtonElement>(null);

  const isOptionType = input === "select" || input === "status" || input === "multiselect";
  const isStatus = input === "status";
  const isRelation = input === "relation";
  // Computed reverse column: type/options/target are derived, only renaming applies.
  const isReverse = !!schema.reverseOf;
  // OKF system fields (P7, parity with the markdown panel): name, field type
  // and delete are fixed — `type`/`okf_version` must never lose their meaning.
  const isOkfSystem = column === "type" || column === "okf_version";
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);

  // Load the target base's config whenever the relation target changes: pre-fills
  // the checkbox/name from an existing reverse column and validates new names.
  useEffect(() => {
    let alive = true;
    setTargetConfig(null);
    setExistingReverse(null);
    if (!isRelation || !relationBase || !loadBaseConfig) return;
    loadBaseConfig(relationBase)
      .then((cfg) => {
        if (!alive) return;
        setTargetConfig(cfg);
        const existing = findReverseColumn(cfg, currentBasePath, column);
        setExistingReverse(existing);
        setShowOnTarget(existing != null);
        setReverseName(existing ?? baseStem(currentBasePath));
      })
      .catch(() => { if (alive) setTargetConfig(null); });
    return () => { alive = false; };
  }, [isRelation, relationBase, loadBaseConfig, currentBasePath, column]);

  // Rename state: unchanged names save as before; a changed name must be valid
  // (non-empty, no reserved prefix, no collision) before Save is enabled.
  const trimmedName = name.trim();
  const renamed = trimmedName !== column;
  const renameValid = !renamed || isValidNewPropertyName(trimmedName, existingColumns.filter((c) => c !== column), column);

  // A NEW reverse column needs a valid, free name in the target base.
  const reverseNameValid =
    !isRelation || !showOnTarget || existingReverse != null ||
    (targetConfig != null && isValidReverseColumnName(reverseName.trim(), targetConfig));

  const save = () => {
    if (!renameValid || !reverseNameValid) return;
    if (isOkfSystem) {
      // Locked meta: nothing to change here — keep the schema exactly as-is.
      onSave({ ...schema });
      onClose();
      return;
    }
    if (isReverse) {
      // Keep the derived schema untouched — only the name can change here.
      onSave({ reverseOf: schema.reverseOf }, renamed ? trimmedName : undefined);
      onClose();
      return;
    }
    const s: ColumnSchema = { input };
    if (isOptionType) s.options = options.filter((o) => o.value.trim() !== "");
    if (isRelation && relationBase) s.relationBase = relationBase;
    if (isRelation && relationLimit === "one") s.relationLimit = "one";
    let reverseIntent: ReverseIntent | undefined;
    if (isRelation && relationBase && loadBaseConfig) {
      if (showOnTarget && existingReverse == null) reverseIntent = { action: "create", name: reverseName.trim() };
      else if (!showOnTarget && existingReverse != null) reverseIntent = { action: "remove", name: existingReverse };
    }
    onSave(s, renamed ? trimmedName : undefined, reverseIntent);
    onClose();
  };

  const setOpt = (i: number, patch: Partial<CuratedOption>) => setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOpt = () => setOptions((prev) => [...prev, { value: "" }]);
  const removeOpt = (i: number) => setOptions((prev) => prev.filter((_, idx) => idx !== i));
  const moveOpt = (from: number, to: number) => setOptions((prev) => {
    const next = [...prev];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
  // Pointer-drag reorder of the option rows — chips, dropdowns and board
  // columns follow this order (plan UI-UX-Paket P2).
  const optDrag = useRowDrag(moveOpt);

  const colorOptions: SelectOption[] = [
    { value: "", label: t("properties.colorAuto") },
    ...PALETTE_NAMES.map((c) => ({ value: c, label: t(`properties.color_${c}`, c), swatch: PALETTE_SWATCH[c] })),
  ];
  // The own base is a valid target ("Diese Datenbank" — self-relations, e.g.
  // parent/sub-items); it is listed first, right after the unscoped option.
  const baseOptions: SelectOption[] = [
    { value: "", label: t("properties.relationAnyNote") },
    ...(baseFiles.includes(currentBasePath) ? [{ value: currentBasePath, label: t("properties.relationSelf", { defaultValue: "Diese Datenbank" }) }] : []),
    ...baseFiles.filter((b) => b !== currentBasePath).map((b) => ({ value: b, label: baseStem(b) })),
  ];
  const limitOptions: SelectOption[] = [
    { value: "", label: t("properties.relationLimitMany", { defaultValue: "Keine Begrenzung" }) },
    { value: "one", label: t("properties.relationLimitOne", { defaultValue: "Genau 1" }) },
  ];

  // One-line explanation of the selected type.
  const typeHint =
    isStatus ? t("properties.typeHintStatus")
      : input === "select" ? t("properties.typeHintSelect")
        : input === "multiselect" ? t("properties.typeHintMultiselect")
          : isRelation ? t("properties.typeHintRelation")
            : "";

  const validOptions = options.filter((o) => o.value.trim() !== "");

  return (
    <Modal
      onClose={onClose}
      title={t("properties.editColumn", { column })}
      size="md"
      footer={
        <>
          {onDelete && !column.startsWith("file.") && !isOkfSystem ? (
            <Button variant="danger" onClick={() => { onClose(); onDelete(); }}>
              {t("properties.deleteProperty", { defaultValue: "Eigenschaft löschen" })}
            </Button>
          ) : null}
          <div style={{ flex: 1 }} />
          <Button onClick={onClose}>{t("common.cancel", { defaultValue: "Abbrechen" })}</Button>
          <Button variant="primary" onClick={save} disabled={!renameValid || !reverseNameValid}>{t("common.save", { defaultValue: "Speichern" })}</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <div className="pv-modal-row">
          <label className="pv-modal-label">{t("properties.fieldName", { defaultValue: "Name" })}</label>
          <input
            className="pv-input"
            style={{ flex: 1, minWidth: 0, maxWidth: 280, boxSizing: "border-box" }}
            value={name}
            disabled={isOkfSystem}
            title={isOkfSystem ? t("properties.okfLockedHint") : undefined}
            aria-label={t("properties.fieldName", { defaultValue: "Name" })}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
          {isOkfSystem && <Lock size={12} style={{ color: "var(--text-faint)", flexShrink: 0 }} aria-hidden="true" />}
        </div>
        {isOkfSystem && <div className="pv-modal-hint">{t("properties.okfLockedHint")}</div>}
        {renamed && !renameValid && <div className="pv-modal-hint" style={{ color: "var(--error-text)" }}>{t("properties.renameInvalid", { defaultValue: "Name ist leer, vergeben oder reserviert (file./note./formula.)." })}</div>}
        {renamed && renameValid && <div className="pv-modal-hint">{t("properties.renameHint", { defaultValue: "Beim Speichern wird die Eigenschaft in allen passenden Notizen umbenannt." })}</div>}

        {isReverse ? (
          <>
            <div className="pv-modal-hint">
              {t("properties.reverseInfo", {
                property: schema.reverseOf?.property,
                base: baseStem(schema.reverseOf?.base ?? ""),
                defaultValue: "Rückrelation zu „{{property}}“ in „{{base}}“.",
              })}
            </div>
            <div className="pv-modal-hint">{t("properties.reverseHint", { defaultValue: "Die Werte werden aus den verlinkenden Notizen berechnet und lassen sich direkt in der Spalte bearbeiten." })}</div>
          </>
        ) : (
          <>
            <div className="pv-modal-row">
              <label className="pv-modal-label">{t("properties.fieldType")}</label>
              {/* Same grouped picker as the markdown properties panel (P7) —
                  the base vocabulary swaps the generic link for relation. */}
              <div style={{ position: "relative", flex: 1, minWidth: 0, maxWidth: 280 }}>
                <button
                  ref={typeBtnRef}
                  type="button"
                  className="pv-input"
                  disabled={isOkfSystem}
                  aria-haspopup="menu"
                  aria-expanded={typeMenuOpen}
                  aria-label={t("properties.fieldType")}
                  title={isOkfSystem ? t("properties.okfLockedHint") : t("properties.changeType")}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, cursor: isOkfSystem ? "default" : "pointer", opacity: isOkfSystem ? 0.6 : 1, boxSizing: "border-box" }}
                  onClick={() => { if (!isOkfSystem) setTypeMenuOpen((o) => !o); }}
                >
                  {(() => { const Ic = TYPE_ICONS[input as MenuPropertyType] ?? Type; return <Ic size={14} style={{ flexShrink: 0 }} />; })()}
                  <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {TYPE_ICONS[input as MenuPropertyType] ? typeLabel(t, input as MenuPropertyType) : input}
                  </span>
                  {isOkfSystem ? <Lock size={12} style={{ flexShrink: 0 }} /> : <ChevronDown size={14} style={{ flexShrink: 0 }} />}
                </button>
                {typeMenuOpen && (
                  <TypeMenu<MenuPropertyType>
                    anchorRef={typeBtnRef}
                    groups={BASE_TYPE_GROUPS}
                    current={input as MenuPropertyType}
                    onPick={(ty) => { setInput(ty); setTypeMenuOpen(false); }}
                    onClose={() => setTypeMenuOpen(false)}
                    t={t}
                  />
                )}
              </div>
            </div>
            {typeHint && <div className="pv-modal-hint">{typeHint}</div>}
          </>
        )}

        {!isReverse && isOptionType && (
          <div className="pv-modal-section">
            <div className="pv-modal-label">{t("properties.options")}</div>

            {/* Column captions so the (value / group / color) fields are self-explanatory.
                Grid columns (grip / value / [group] / color / delete) keep the inputs
                usable at any dialog width — the old flex-basis-0 rows collapsed. */}
            {options.length > 0 && (
              <div className={`pv-opt-row pv-opt-head${isStatus ? " pv-opt-status" : ""}`} aria-hidden="true">
                <span />
                <span>{t("properties.optionValue")}</span>
                {isStatus && <span>{t("properties.group")}</span>}
                <span>{t("properties.color")}</span>
                <span />
              </div>
            )}

            {options.map((o, i) => (
              <div
                key={i}
                ref={optDrag.rowRef(i)}
                className={`pv-opt-row${isStatus ? " pv-opt-status" : ""}${optDrag.overIdx === i && optDrag.dragIdx !== null && optDrag.dragIdx !== i ? " pv-opt-drop" : ""}`}
                style={{ opacity: optDrag.dragIdx === i ? 0.5 : 1 }}
              >
                <span
                  className="pv-opt-grip"
                  role="button"
                  aria-label={t("properties.reorderOption")}
                  title={t("properties.reorderOption")}
                  {...optDrag.gripProps(i)}
                >
                  <GripVertical size={12} />
                </span>
                <input className="pv-input" value={o.value} placeholder={t("properties.optionValue")} onChange={(e) => setOpt(i, { value: e.target.value })} />
                {isStatus && (
                  <input className="pv-input" value={o.group || ""} placeholder={t("properties.groupPlaceholder")} onChange={(e) => setOpt(i, { group: e.target.value || undefined })} />
                )}
                <Select value={o.color || ""} options={colorOptions} onChange={(c) => setOpt(i, { color: c || undefined })} ariaLabel={t("properties.color")} minWidth={120} align="right" />
                <button type="button" className="pv-icon-btn" aria-label={t("properties.removeItem")} onClick={() => removeOpt(i)}><Trash2 size={14} /></button>
              </div>
            ))}
            <button type="button" className="pv-add-btn" onClick={addOpt}><Plus size={14} /> {t("properties.addOption")}</button>
            {isStatus && <div className="pv-modal-hint">{t("properties.statusGroupHint")}</div>}

            {validOptions.length > 0 && (
              <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <div className="pv-modal-label">{t("properties.preview")}</div>
                {isStatus ? (
                  groupOptions(validOptions).map((g, gi) => (
                    <div key={gi} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", minWidth: 90, fontStyle: g.group ? undefined : "italic" }}>
                        {g.group || t("properties.statusNoGroup")}
                      </span>
                      <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {g.options.map((o, oi) => <span key={oi} className={chipClass(o.value, o.color)}>{o.label ?? o.value}</span>)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {validOptions.map((o, oi) => <span key={oi} className={chipClass(o.value, o.color)}>{o.label ?? o.value}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!isReverse && isRelation && (
          <>
            <div className="pv-modal-row">
              <label className="pv-modal-label">{t("properties.relationTarget")}</label>
              <Select value={relationBase} options={baseOptions} onChange={setRelationBase} ariaLabel={t("properties.relationTarget")} minWidth={200} />
            </div>
            <div className="pv-modal-hint">{t("properties.relationTargetHint")}</div>
            <div className="pv-modal-row">
              <label className="pv-modal-label">{t("properties.relationLimit", { defaultValue: "Kardinalität" })}</label>
              <Select value={relationLimit} options={limitOptions} onChange={setRelationLimit} ariaLabel={t("properties.relationLimit", { defaultValue: "Kardinalität" })} minWidth={200} />
            </div>
            {relationBase && loadBaseConfig && (
              <div className="pv-modal-section">
                <label className="pv-modal-check">
                  <input
                    type="checkbox"
                    checked={showOnTarget}
                    onChange={(e) => setShowOnTarget(e.target.checked)}
                  />
                  <span>{t("properties.relationShowOnTarget", { base: relationBase === currentBasePath ? t("properties.relationSelf", { defaultValue: "Diese Datenbank" }) : baseStem(relationBase), defaultValue: "Auf „{{base}}“ anzeigen" })}</span>
                </label>
                {showOnTarget && (
                  <>
                    <div className="pv-modal-row">
                      <label className="pv-modal-label">{t("properties.relationReverseName", { defaultValue: "Name der Rückrelation" })}</label>
                      <input
                        className="pv-input"
                        style={{ width: 200, boxSizing: "border-box" }}
                        value={reverseName}
                        disabled={existingReverse != null}
                        aria-label={t("properties.relationReverseName", { defaultValue: "Name der Rückrelation" })}
                        onChange={(e) => setReverseName(e.target.value)}
                      />
                    </div>
                    {existingReverse != null && <div className="pv-modal-hint">{t("properties.relationReverseExists", { defaultValue: "Die Rückrelation existiert bereits; umbenennen geht über deren Spalten-Editor." })}</div>}
                    {!reverseNameValid && <div className="pv-modal-hint" style={{ color: "var(--error-text)" }}>{t("properties.reverseNameInvalid", { defaultValue: "Name ist leer, in der Ziel-Datenbank vergeben oder reserviert." })}</div>}
                    {existingReverse == null && reverseNameValid && <div className="pv-modal-hint">{t("properties.relationShowOnTargetHint", { defaultValue: "Legt in der Ziel-Datenbank eine berechnete Spalte an, die die Verknüpfungen rückwärts zeigt." })}</div>}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {!isReverse && onFillMissing != null && (missingCount ?? 0) > 0 && (
          <div className="pv-modal-section">
            <div className="pv-modal-label">{t("properties.fillMissingTitle", { defaultValue: "Fehlende Werte" })}</div>
            <div className="pv-modal-hint">{t("properties.fillMissingHint", { count: missingCount, defaultValue: "Diese Eigenschaft fehlt in {{count}} der angezeigten Notizen. Das Eintragen schreibt sie (leer) in deren Frontmatter." })}</div>
            <button type="button" className="pv-add-btn" onClick={onFillMissing}>{t("properties.fillMissing", { count: missingCount, defaultValue: "In {{count}} Quelldateien eintragen" })}</button>
          </div>
        )}

      </div>
    </Modal>
  );
}

/**
 * Confirmation for deleting a property from a base (plan Base-Neu P11/P12).
 * The checkbox (default ON, maintainer decision 2026-07-03) additionally
 * removes the frontmatter key from the notes of the base's source. Computed
 * reverse columns skip the checkbox — their values live in the counterpart
 * notes' owning property and stay untouched.
 */
export function DeletePropertyDialog({ column, affected, isReverse, reverseInTarget, onConfirm, onCancel, t }: {
  column: string;
  /** Notes of the source scope that currently carry the property. */
  affected: number;
  isReverse: boolean;
  /** Reverse column in the relation's target base that will be removed along. */
  reverseInTarget: { base: string; name: string } | null;
  onConfirm: (cleanupFrontmatter: boolean) => void;
  onCancel: () => void;
  t: TFn;
}) {
  const [cleanup, setCleanup] = useState(true);
  const withCleanup = !isReverse && affected > 0;
  return (
    <Modal
      onClose={onCancel}
      title={t("properties.deleteProperty", { defaultValue: "Eigenschaft löschen" })}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel", { defaultValue: "Abbrechen" })}</Button>
          <Button variant="danger" onClick={() => onConfirm(withCleanup && cleanup)}>{t("common.delete", { defaultValue: "Löschen" })}</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div className="pv-dialog-body">
          <AlertTriangle size={20} className="pv-dialog-ic pv-dialog-ic--danger" aria-hidden />
          <div className="pv-modal-hint" style={{ color: "var(--text-main)" }}>
            {t("properties.deletePropertyConfirm", { column, defaultValue: "Die Eigenschaft „{{column}}“ wird aus dieser Datenbank entfernt (Spalte, Schema, Filter und Sortierungen)." })}
          </div>
        </div>
        {isReverse && (
          <div className="pv-modal-hint">
            {t("properties.deleteReverseHint", { defaultValue: "Dies ist eine berechnete Rückrelations-Spalte – die Verknüpfungen in den Notizen bleiben unverändert." })}
          </div>
        )}
        {reverseInTarget && (
          <div className="pv-modal-hint">
            {t("properties.deleteRemovesReverse", { name: reverseInTarget.name, base: baseStem(reverseInTarget.base), defaultValue: "Die Rückrelations-Spalte „{{name}}“ in „{{base}}“ wird ebenfalls entfernt." })}
          </div>
        )}
        {withCleanup && (
          <label className="pv-modal-check">
            <input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} />
            <span>{t("properties.deleteFromNotes", { count: affected, defaultValue: "Auch aus dem Frontmatter der Notizen entfernen ({{count}} Dateien)" })}</span>
          </label>
        )}
      </div>
    </Modal>
  );
}
