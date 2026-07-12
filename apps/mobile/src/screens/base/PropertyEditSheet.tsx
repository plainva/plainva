import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, X } from "lucide-react";
import {
  chipPaletteIndex,
  isValidNewPropertyName,
  mergeObservedOptions,
  PALETTE_NAMES,
  toast,
  type CuratedOption,
  type PropertyType,
} from "@plainva/ui";
import { mConfirm, mPrompt, mSelect } from "../../services/mobileDialogs";
import { deleteBaseProperty, renameBaseProperty } from "../../services/baseOps";
import type { MobileVault } from "../../services/vaultService";

/**
 * Light schema authoring for one .base property (M3E package E3): field type,
 * curated options with palette colors, rename (config + frontmatter sweep via
 * the shared renamePropertyInConfig contract) and delete (optionally cleaning
 * the notes). OKF system fields stay locked; relation schema editing —
 * targets, cardinality, reverse columns — remains a desktop task, so relation
 * and reverse columns only explain themselves here.
 */

const LOCKED = new Set(["type", "okf_version"]);
/** Mobile authoring vocabulary — BASE_TYPE_GROUPS minus relation (desktop). */
const MOBILE_TYPES: PropertyType[] = [
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "select",
  "status",
  "multiselect",
  "list",
  "tags",
  "url",
  "email",
  "phone",
];

export function PropertyEditSheet({
  vault,
  basePath,
  config,
  column,
  rows,
  rowPaths,
  columnLabel,
  onMutate,
  onReload,
  onClose,
}: {
  vault: MobileVault;
  basePath: string;
  config: any;
  column: string;
  rows: any[];
  rowPaths: string[];
  columnLabel: (col: string) => string;
  /** Clone-mutate-save for schema edits (type, options). */
  onMutate: (mutate: (cfg: any) => void) => void;
  /** Rename/delete write through the service; the screen reloads + closes. */
  onReload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const schema = config?.columns?.[column] ?? {};
  const locked = LOCKED.has(column);
  const isRelation = schema.input === "relation" || schema.input === "link" || !!schema.reverseOf;
  const currentType: string = typeof schema.input === "string" ? schema.input : "text";
  const hasOptions =
    currentType === "select" || currentType === "status" || currentType === "multiselect";

  const options: CuratedOption[] = useMemo(
    () =>
      hasOptions
        ? mergeObservedOptions(Array.isArray(schema.options) ? schema.options : [], rows, column)
        : [],
    [hasOptions, schema.options, rows, column],
  );

  const writeOptions = (next: CuratedOption[]) =>
    onMutate((cfg) => {
      if (!cfg.columns || Array.isArray(cfg.columns)) cfg.columns = {};
      if (!cfg.columns[column]) cfg.columns[column] = {};
      cfg.columns[column].options = next;
    });

  const pickColor = (idx: number) => {
    void (async () => {
      const picked = await mSelect({
        title: t("properties.color"),
        options: [
          { value: "", label: t("properties.colorAuto") },
          ...PALETTE_NAMES.map((n) => ({ value: n, label: t(`properties.color_${n}`) })),
        ],
      });
      if (picked === null) return;
      const next = options.map((o) => ({ ...o }));
      if (picked === "") delete next[idx].color;
      else next[idx].color = picked;
      writeOptions(next);
    })();
  };

  const addOption = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("properties.addOption"),
        message: t("properties.optionValue"),
      });
      const v = value?.trim();
      if (cancelled || !v || options.some((o) => o.value === v)) return;
      writeOptions([...options.map((o) => ({ ...o })), { value: v }]);
    })();
  };

  const rename = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("properties.fieldName"),
        message: t("properties.renameHint"),
        initial: column,
      });
      const name = value?.trim();
      if (cancelled || !name || name === column) return;
      const existing = Object.keys(config?.columns ?? {});
      if (!isValidNewPropertyName(name, existing, column)) {
        toast.error(t("properties.renameInvalid"));
        return;
      }
      await renameBaseProperty(vault, basePath, config, column, name, rowPaths);
      onReload();
      onClose();
    })();
  };

  const remove = () => {
    void (async () => {
      const mode = await mSelect({
        title: t("properties.deleteProperty"),
        message: t("properties.deletePropertyConfirm", { column: columnLabel(column) }),
        options: [
          { value: "notes", label: t("properties.deleteFromNotes", { count: rowPaths.length }) },
          { value: "config", label: t("properties.deleteProperty") },
        ],
      });
      if (mode === null) return;
      const ok = await mConfirm({
        title: t("properties.deleteProperty"),
        message: columnLabel(column),
        danger: true,
        confirmLabel: t("common.delete"),
      });
      if (!ok) return;
      await deleteBaseProperty(vault, basePath, config, column, rowPaths, mode === "notes");
      onReload();
      onClose();
    })();
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{t("properties.editColumn", { column: columnLabel(column) })}</p>

        {locked && <p className="m-hint m-hint--inset">{t("properties.okfLockedHint")}</p>}
        {!locked && isRelation && (
          <p className="m-hint m-hint--inset">{t("properties.typeHintRelation")}</p>
        )}

        {!locked && !isRelation && (
          <>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("properties.fieldType")}</p>
            <div className="m-turninto">
              {MOBILE_TYPES.map((type) => (
                <button
                  className={`m-chip${currentType === type ? " is-on" : ""}`}
                  key={type}
                  onClick={() =>
                    onMutate((cfg) => {
                      if (!cfg.columns || Array.isArray(cfg.columns)) cfg.columns = {};
                      if (!cfg.columns[column]) cfg.columns[column] = {};
                      cfg.columns[column].input = type;
                    })
                  }
                >
                  {t(`properties.type_${type}`)}
                </button>
              ))}
            </div>

            {hasOptions && (
              <>
                <p className="m-sectionlabel m-sectionlabel--inset">{t("properties.options")}</p>
                {options.map((o, idx) => (
                  <div className="m-row m-row--split" key={o.value}>
                    <button className="m-row-main" onClick={() => pickColor(idx)}>
                      {/* Palette slot is registry DATA (same tokens the chips use). */}
                      <span
                        aria-hidden
                        className="m-optiondot"
                        style={{ background: `var(--chip-${chipPaletteIndex(o.value, o.color)}-bg)` }}
                      />
                      <span>{o.label ?? o.value}</span>
                    </button>
                    <button
                      aria-label={t("common.delete")}
                      className="m-iconbtn"
                      onClick={() => writeOptions(options.filter((_, i) => i !== idx))}
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
                <div className="m-config-actions">
                  <button className="m-chip" onClick={addOption}>
                    + {t("properties.addOption")}
                  </button>
                </div>
              </>
            )}

            <p className="m-sectionlabel m-sectionlabel--inset">{t("properties.fieldName")}</p>
            <div className="m-config-actions">
              <button className="m-chip" onClick={rename}>
                <Pencil size={14} /> {t("common.rename")}
              </button>
              <button className="m-chip m-danger" onClick={remove}>
                <Trash2 size={14} /> {t("properties.deleteProperty")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
