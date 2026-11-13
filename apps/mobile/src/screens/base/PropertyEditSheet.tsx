import { useEffect, useMemo, useState } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { FilePlus2, Pencil, Trash2, X, Sparkles } from "lucide-react";
import { baseStemOf, sayRewriteOutcome, Button, Chip, chipPaletteIndex, type CuratedOption, dateInputSwitch, dateSwitchLosesTime, errorText, ICON, IconButton, isPropertyColumn, isValidNewPropertyName, notesMissingProperty, isValidReverseColumnName, mergeObservedOptions, notesCarryingProperty, PALETTE_NAMES, parseBaseConfig, type PropertyType, renameRefusedText, reverseColumnState, reverseIntentFor, Switch, toast } from "@plainva/ui";
import { mActions, mConfirm, mPrompt, mSelect } from "../../services/mobileDialogs";
import { convertBaseDateColumn, deleteBaseProperty, fillBaseProperty, listBasePaths, renameBaseProperty, writeRelationSchema } from "../../services/baseOps";
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
  columnLabel,
  onMutate,
  onReload,
  onClose,
  fill,
}: {
  /**
   * The assistant can fill this column (plan KI-Harness P5-4): the door to
   * that, named with the column as the database calls it. Absent while the
   * AI is off, and for a column no run takes.
   */
  fill?: { label: string; onStart(): void };
  vault: MobileVault;
  basePath: string;
  config: any;
  column: string;
  rows: any[];
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

  // The column's type. A switch between "Date only" and "Date & time"
  // rewrites the values in the notes (Sammelplan § 3.71 no. 2, the desktop's
  // view settings and column editor do the same): a day gets 12:00, a moment
  // loses its time after a question. The notes are those of the database's
  // sources that carry the property, as for a rename. A declined question
  // changes nothing; a note that could not be written is counted, and the
  // type is set anyway — as on the desktop, the others agree with it.
  const setType = (type: string) => {
    const writeType = () =>
      onMutate((cfg) => {
        if (!cfg.columns || Array.isArray(cfg.columns)) cfg.columns = {};
        if (!cfg.columns[column]) cfg.columns[column] = {};
        cfg.columns[column].input = type;
      });
    const to = dateInputSwitch(schema.input, type);
    if (!to) {
      writeType();
      return;
    }
    void (async () => {
      if (dateSwitchLosesTime(to) && !(await mConfirm({ title: t("common.confirm"), message: t("database.confirmDropTime") }))) return;
      try {
        const paths = await notesCarryingProperty(vault.queryService, config, column, rows);
        sayRewriteOutcome(await convertBaseDateColumn(vault, paths, column, to), toast);
      } catch (e) {
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
        return;
      }
      writeType();
    })();
  };

  // Writes the property (empty) into the shown notes that lack it — the
  // desktop column editor's "Missing values" (decision F1, Sammelplan § 3.71
  // no. 1). Asked first, never implicit; what failed is counted.
  const missing = !locked && isPropertyColumn(column, schema) && !schema.reverseOf ? notesMissingProperty(rows, column) : [];
  const fillMissing = () => {
    void (async () => {
      const ok = await mConfirm({
        title: t("common.confirm"),
        message: t("database.confirmFillMissing", { column: columnLabel(column), count: missing.length }),
      });
      if (!ok) return;
      try {
        sayRewriteOutcome(await fillBaseProperty(vault, missing, column), toast);
      } catch (e) {
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
        return;
      }
      onReload();
    })();
  };

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
        value: options[idx]?.color ?? "",
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
      // What the rename did is said (finding 2026-10-09; the desktop's twin is
      // `renameColumn` in BaseViewer). A note that cannot take the new name
      // stops it before anything is written, and the sheet stays open on the
      // property as it is. A write that failed during the run is counted. And
      // an error of the database itself no longer leaves as an unhandled
      // rejection. The notes are the desktop's: every note of the database's
      // sources that carries the property — the view's rows stood here, which
      // left the notes its filters hide behind and asked notes that do not
      // carry the property at all (finding 2026-10-21).
      try {
        const paths = await notesCarryingProperty(vault.queryService, config, column, rows);
        const outcome = await renameBaseProperty(vault, basePath, config, column, name, paths);
        if (outcome.status === "refused") {
          toast.error(renameRefusedText(column, outcome.refused));
          return;
        }
        // A note that was gone when its turn came is skipped, not failed (decision E20).
        if (outcome.status === "renamed") sayRewriteOutcome(outcome.result, toast);
      } catch (e) {
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
        return;
      }
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
        value: relationBase,
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
        value: schema.relationLimit === "one" ? "one" : "",
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
      // The notes the property is taken out of: see `rename`. Refused, with
      // nothing written, while the index is not whole.
      let paths: string[];
      try {
        paths = await notesCarryingProperty(vault.queryService, config, column, rows);
      } catch (e) {
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
        return;
      }
      const mode = await mActions({
        title: t("properties.deleteProperty"),
        message: t("properties.deletePropertyConfirm", { column: columnLabel(column) }),
        options: [
          { value: "notes", label: t("properties.deleteFromNotes", { count: paths.length }) },
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
      // The notes that could not be cleaned are counted (finding 2026-10-09):
      // each was skipped without a word. The column is gone either way, so
      // the sheet closes on it.
      try {
        const result = await deleteBaseProperty(vault, basePath, config, column, paths, mode === "notes");
        sayRewriteOutcome(result, toast);
      } catch (e) {
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
        return;
      }
      onReload();
      onClose();
    })();
  };

  // Shown for an owning relation as for any other stored column.
  const fillMissingSection = missing.length > 0 && (
    <>
      <p className="m-sectionlabel m-sectionlabel--inset">{t("properties.fillMissingTitle")}</p>
      <p className="m-hint">{t("properties.fillMissingHint", { count: missing.length })}</p>
      <div className="m-config-actions">
        <Button variant="ghost" size="sm" onClick={fillMissing} data-testid="base-property-fill-missing">
          <FilePlus2 size={ICON.meta} /> {t("properties.fillMissing", { count: missing.length })}
        </Button>
      </div>
    </>
  );

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("properties.editColumn", { column: columnLabel(column) })}</p>

        {locked && <p className="m-hint">{t("properties.okfLockedHint")}</p>}
        {!locked && isRelation && !isOwning && (
          // A computed reverse column: its links live in the OTHER base, so
          // there is nothing to decide here — only its name can change, and
          // that belongs to its own column editor over there.
          <>
            <p className="m-hint">
              {t("properties.reverseInfo", {
                property: schema.reverseOf?.property,
                base: baseStemOf(String(schema.reverseOf?.base ?? "")),
              })}
            </p>
            <p className="m-hint">{t("properties.reverseHint")}</p>
          </>
        )}

        {!locked && isOwning && (
          <>
            <p className="m-hint">{t("properties.typeHintRelation")}</p>
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
                <p className="m-hint">
                  {existingReverse != null
                    ? t("properties.relationReverseExists")
                    : t("properties.relationShowOnTargetHint")}
                </p>
              </>
            )}
            {fillMissingSection}
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
                  onClick={() => setType(type)}
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

            {fillMissingSection}

            {fill && (
              // The column's own door to the assistant (plan KI-Harness P5-4): the desktop carries it in the column's
              // head and in its list of properties — here it stands with what else one does to a property.
              <div className="m-config-actions">
                <Button variant="ghost" size="sm" onClick={fill.onStart} data-testid="base-property-fill">
                  <Sparkles size={ICON.meta} /> {t("database.fill.action", { column: fill.label })}
                </Button>
              </div>
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
