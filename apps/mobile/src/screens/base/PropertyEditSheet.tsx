import { useEffect, useMemo, useState } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, X } from "lucide-react";
import { baseStemOf, Button, Chip, chipPaletteIndex, type CuratedOption, ICON, IconButton, isValidNewPropertyName, isValidReverseColumnName, mergeObservedOptions, PALETTE_NAMES, parseBaseConfig, type PropertyType, reverseColumnState, reverseIntentFor, Switch, toast } from "@plainva/ui";
import { mConfirm, mPrompt, mSelect } from "../../services/mobileDialogs";
import { deleteBaseProperty, listBasePaths, renameBaseProperty, writeRelationSchema } from "../../services/baseOps";
import { vaultOps } from "../../services/vaultService";
import type { MobileVault } from "../../services/vaultService";

/**
 * Light schema authoring for one .base property (M3E package E3): field type,
 * curated options with palette colors, rename (config + frontmatter sweep via
 * the shared renamePropertyInConfig contract) and delete (optionally cleaning
 * the notes). OKF system fields stay locked. Relations are edited here too
 * since S21 — target, cardinality and the computed reverse column in the other
 * base — through the SHARED write, because a relation touches two files and
 * both shells have to produce the same pair. A derived reverse column stays
 * read-only: it lives in the base it points back from.
 */

const LOCKED = new Set(["type", "okf_version"]);
/**
 * The authoring vocabulary — the desktop's BASE_TYPE_GROUPS flattened. Since
 * S21 that includes `relation`: turning a text column into a relation is the
 * usual way one comes into being, and leaving it out meant the phone could
 * only ever edit relations somebody else had created.
 */
const MOBILE_TYPES: Array<PropertyType | "relation"> = [
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
  "relation",
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

  // ── Relation editing (S21) ────────────────────────────────────────────────
  // The desktop had this behind a modal with three controls; the phone had a
  // sentence saying it was a desktop task. The controls are the same three
  // decisions, so they are the same three controls — target, cardinality, and
  // whether the target base shows the links back.
  const [bases, setBases] = useState<Array<{ path: string; title: string }>>([]);
  const [targetCfg, setTargetCfg] = useState<any>(null);
  const [existingReverse, setExistingReverse] = useState<string | null>(null);
  const [showOnTarget, setShowOnTarget] = useState(false);
  const relationBase: string = typeof schema.relationBase === "string" ? schema.relationBase : "";
  const isOwning = isRelation && !schema.reverseOf;

  useEffect(() => {
    if (!isOwning) return;
    let alive = true;
    void listBasePaths(vault).then((b) => {
      if (alive) setBases(b);
    });
    return () => {
      alive = false;
    };
  }, [isOwning, vault]);

  // The target's config decides whether a reverse column is already there — and
  // therefore whether the switch starts on and its name is fixed.
  useEffect(() => {
    let alive = true;
    setTargetCfg(null);
    setExistingReverse(null);
    setShowOnTarget(false);
    if (!isOwning || !relationBase) return;
    void vaultOps
      .read(vault, relationBase)
      .then((raw) => {
        if (!alive) return;
        const cfg = parseBaseConfig(raw);
        setTargetCfg(cfg);
        const { existing } = reverseColumnState(cfg, basePath, column);
        setExistingReverse(existing);
        setShowOnTarget(existing != null);
      })
      .catch(() => {
        /* an unreadable target simply offers no reverse column */
      });
    return () => {
      alive = false;
    };
  }, [isOwning, relationBase, vault, basePath, column]);

  const writeRelation = (next: { relationBase?: string; relationLimit?: "one" }, wanted: boolean) => {
    void (async () => {
      const intent = reverseIntentFor(wanted, existingReverse, baseStemOf(basePath));
      // A NEW reverse column needs a free, valid name in the target base.
      if (intent?.action === "create" && (!targetCfg || !isValidReverseColumnName(intent.name, targetCfg))) {
        toast.error(t("properties.renameInvalid"));
        return;
      }
      const ok = await writeRelationSchema(vault, basePath, config, column, next, intent);
      if (!ok) toast.warning(t("properties.relationReverseExists"));
      onReload();
    })();
  };

  const pickTarget = () => {
    void (async () => {
      const picked = await mSelect({
        title: t("properties.relationTarget"),
        options: [
          { value: "", label: t("properties.relationAnyNote") },
          ...bases.map((b) => ({
            value: b.path,
            label: b.path === basePath ? t("properties.relationSelf") : b.title,
          })),
        ],
      });
      if (picked === null) return;
      writeRelation({ relationBase: picked || undefined, relationLimit: schema.relationLimit }, false);
    })();
  };

  const pickLimit = () => {
    void (async () => {
      const picked = await mSelect({
        title: t("properties.relationLimit"),
        options: [
          { value: "", label: t("properties.relationLimitMany") },
          { value: "one", label: t("properties.relationLimitOne") },
        ],
      });
      if (picked === null) return;
      writeRelation(
        { relationBase: relationBase || undefined, relationLimit: picked === "one" ? "one" : undefined },
        showOnTarget,
      );
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
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("properties.editColumn", { column: columnLabel(column) })}</p>

        {locked && <p className="m-hint m-hint--inset">{t("properties.okfLockedHint")}</p>}
        {!locked && isRelation && !isOwning && (
          // A computed reverse column: its links live in the OTHER base, so
          // there is nothing to decide here — only its name can change, and
          // that belongs to its own column editor over there.
          <>
            <p className="m-hint m-hint--inset">
              {t("properties.reverseInfo", {
                property: schema.reverseOf?.property,
                base: baseStemOf(String(schema.reverseOf?.base ?? "")),
              })}
            </p>
            <p className="m-hint m-hint--inset">{t("properties.reverseHint")}</p>
          </>
        )}

        {!locked && isOwning && (
          <>
            <p className="m-hint m-hint--inset">{t("properties.typeHintRelation")}</p>
            <button className="m-row m-row--split" onClick={pickTarget}>
              <span className="m-peeklabel">{t("properties.relationTarget")}</span>
              <span className="m-peekvalue">
                {relationBase === basePath
                  ? t("properties.relationSelf")
                  : relationBase
                    ? baseStemOf(relationBase)
                    : t("properties.relationAnyNote")}
              </span>
            </button>
            <button className="m-row m-row--split" onClick={pickLimit}>
              <span className="m-peeklabel">{t("properties.relationLimit")}</span>
              <span className="m-peekvalue">
                {schema.relationLimit === "one"
                  ? t("properties.relationLimitOne")
                  : t("properties.relationLimitMany")}
              </span>
            </button>
            {relationBase && (
              <>
                <div className="m-row m-row--split">
                  <span className="m-peeklabel">
                    {t("properties.relationShowOnTarget", {
                      base: relationBase === basePath ? t("properties.relationSelf") : baseStemOf(relationBase),
                    })}
                  </span>
                  <Switch
                    label={t("properties.relationShowOnTarget", {
                      base: relationBase === basePath ? t("properties.relationSelf") : baseStemOf(relationBase),
                    })}
                    checked={showOnTarget}
                    onChange={(v) =>
                      writeRelation({ relationBase, relationLimit: schema.relationLimit }, v)
                    }
                  />
                </div>
                <p className="m-hint m-hint--inset">
                  {existingReverse != null
                    ? t("properties.relationReverseExists")
                    : t("properties.relationShowOnTargetHint")}
                </p>
              </>
            )}
          </>
        )}

        {!locked && !isRelation && (
          <>
            <p className="m-sectionlabel m-sectionlabel--inset">{t("properties.fieldType")}</p>
            <div className="m-turninto">
              {MOBILE_TYPES.map((type) => (
                <Chip
                  selected={currentType === type}
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
                </Chip>
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
                    <IconButton
                      label={t("common.delete")}
                      onClick={() => writeOptions(options.filter((_, i) => i !== idx))}
                    >
                      <X size={ICON.head} />
                    </IconButton>
                  </div>
                ))}
                <div className="m-config-actions">
                  <Button variant="ghost" size="sm" onClick={addOption}>
                    + {t("properties.addOption")}
                  </Button>
                </div>
              </>
            )}

            <p className="m-sectionlabel m-sectionlabel--inset">{t("properties.fieldName")}</p>
            <div className="m-config-actions">
              <Button variant="ghost" size="sm" onClick={rename}>
                <Pencil size={ICON.meta} /> {t("common.rename")}
              </Button>
              <Button variant="danger" size="sm" onClick={remove}>
                <Trash2 size={ICON.meta} /> {t("properties.deleteProperty")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
