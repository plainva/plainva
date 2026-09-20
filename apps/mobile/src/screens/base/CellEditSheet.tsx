import { useCallback, useEffect, useMemo, useState } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { Check, ExternalLink, MessageSquare } from "lucide-react";
import { type CuratedOption, dateTimeEditorValue, getPlatformServices, ICON, IconButton, inlineOptionsFrom, propertyFolder, propertyIndexTypes, usePropertyValues, parseWikiLinkValue, SearchField, splitMultiValue, TextInput } from "@plainva/ui";
import { relationCandidates } from "../../services/baseOps";
import type { MobileVault } from "../../services/vaultService";

/**
 * Typed cell editor (R4.3, desktop useBaseCells contract): the sheet renders
 * per input type — text/number free input, date/datetime native pickers,
 * select/status single-tap options, multiselect/tags/list toggling chips,
 * relation a target-base picker (single or multi per relationLimit). The
 * committed value shape matches the desktop (scalar vs. YAML array,
 * [[wiki links]] for relations).
 */

export interface CellEditTarget {
  notePath: string;
  col: string;
  input: string;
  value: unknown;
  options: CuratedOption[];
  /** Distinguishes a declared empty vocabulary from no schema. */
  curated?: boolean;
  relationBase?: string;
  relationLimit?: "one";
}

const toArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (v === undefined || v === null || v === "") return [];
  return splitMultiValue(String(v));
};

export function CellEditSheet({
  vault,
  target,
  rows,
  onCommit,
  onClose,
  onCommentProperty,
}: {
  vault: MobileVault;
  target: CellEditTarget;
  rows: any[];
  onCommit: (value: unknown) => void;
  onClose: () => void;
  /**
   * Remark on this property instead of changing it (finding 2026-09-04). The
   * phone has no right-click, and this sheet is where a cell already leads -
   * so the second thing one wants to do with a cell lives at its foot, below
   * the editor, where it cannot be hit by accident while typing a value.
   * Absent when this device may not comment on the entry.
   */
  onCommentProperty?: () => void;
}) {
  const { t } = useTranslation();
  const { input, col, value } = target;
  const isMulti = input === "multiselect" || input === "tags" || input === "list";
  const isSelect = input === "select" || input === "status";
  const isRelation = input === "relation" || input === "link";
  const isDate = input === "date" || input === "datetime";

  const [text, setText] = useState(() => {
    const raw = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    // A bare day in a datetime column: the native picker only takes a full
    // moment, so it starts at 00:00 — which stands for "no time" and is written
    // back as the day alone (dateTimeEditorValue; the desktop's picker agrees).
    return input === "datetime" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw;
  });
  const [multi, setMulti] = useState<string[]>(() => toArray(value));
  const [free, setFree] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Array<{ path: string; title: string }>>([]);

  const usingCurated = target.curated ?? target.options.length > 0;
  const loadSuggestions = useCallback(async (key: string, all = false) => vault.queryService
    ? vault.queryService.getDistinctPropertyValues(key.replace(/^note\./, ""), all ? undefined : propertyFolder(target.notePath), propertyIndexTypes(input)) : [],
  [vault, target.notePath, input]);
  const suggestions = usePropertyValues(!usingCurated && !isRelation && !isDate, col, loadSuggestions);
  const options = useMemo<CuratedOption[]>(() => usingCurated ? target.options
    : vault.queryService ? suggestions.values.map((v) => ({ value: v.value })) : inlineOptionsFrom([], rows, col),
  [usingCurated, target.options, vault.queryService, suggestions.values, rows, col]);
  const needle = (isMulti || isSelect ? free : text).trim().toLocaleLowerCase();
  const matches = options.filter((o) => !needle || (o.label ?? o.value).toLocaleLowerCase().includes(needle));

  useEffect(() => {
    if (!isRelation) return;
    let stale = false;
    void relationCandidates(vault, target.relationBase).then((c) => {
      if (!stale) setCandidates(c);
    });
    return () => {
      stale = true;
    };
  }, [vault, target.relationBase, isRelation]);

  const commitMulti = (next: string[]) => onCommit(next);

  const selectedTargets = useMemo(() => {
    const set = new Set<string>();
    for (const v of toArray(value)) {
      const parsed = parseWikiLinkValue(v);
      set.add((parsed?.target ?? v).toLowerCase());
    }
    return set;
  }, [value]);

  const relationToggle = (title: string) => {
    const link = `[[${title}]]`;
    if (target.relationLimit === "one") {
      onCommit(link);
      return;
    }
    const current = toArray(value);
    const key = title.toLowerCase();
    const exists = current.some((v) => (parseWikiLinkValue(v)?.target ?? v).toLowerCase() === key);
    const next = exists
      ? current.filter((v) => (parseWikiLinkValue(v)?.target ?? v).toLowerCase() !== key)
      : [...current, link];
    onCommit(next);
  };

  const filteredCandidates = query.trim()
    ? candidates.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : candidates;

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{col}</p>

        {isSelect && (
          <>
            {matches.map((o) => (
              <button className="m-row" key={o.value} onClick={() => onCommit(o.value)}>
                <span>{o.label ?? o.value}</span>
                {String(value ?? "") === o.value && <Check className="m-accent" size={ICON.head} />}
              </button>
            ))}
            <div className="m-sheet-inputrow">
              <TextInput
                onChange={(e) => setFree(e.target.value)}
                placeholder={t("database.addValueFree")}
                value={free}
              />
              <IconButton
                label={t("common.ok", { defaultValue: "OK" })}
                disabled={!free.trim()}
                onClick={() => onCommit(free.trim())}
              >
                <Check size={ICON.head} />
              </IconButton>
            </div>
            <button className="m-row m-danger" onClick={() => onCommit("")}>
              <span>{t("database.opEmpty")}</span>
            </button>
          </>
        )}

        {isMulti && (
          <>
            {[...new Set([...matches.map((o) => o.value), ...multi])].map((val) => {
              const on = multi.includes(val);
              return (
                <button
                  className="m-row"
                  key={val}
                  onClick={() =>
                    setMulti((m) => (on ? m.filter((x) => x !== val) : [...m, val]))
                  }
                >
                  <span>{val}</span>
                  <span className={`m-slotmark${on ? " is-on" : ""}`} />
                </button>
              );
            })}
            <div className="m-sheet-inputrow">
              <TextInput
                onChange={(e) => setFree(e.target.value)}
                placeholder={t("database.addValueFree")}
                value={free}
              />
              <IconButton
                label={t("common.ok", { defaultValue: "OK" })}
                disabled={!free.trim()}
                onClick={() => {
                  const v = free.trim();
                  setFree("");
                  setMulti((m) => (m.includes(v) ? m : [...m, v]));
                }}
              >
                <Check size={ICON.head} />
              </IconButton>
            </div>
            <button className="m-cell-commit" onClick={() => commitMulti(multi)}>
              {t("common.ok")}
            </button>
          </>
        )}

        {isRelation && (
          <>
            <div className="m-sheet-inputrow">
              <SearchField
                clearLabel={t("sidebar.clearSearch")}
                onValueChange={setQuery}
                placeholder={t("database.selectValue")}
                value={query}
              />
            </div>
            {filteredCandidates.slice(0, 60).map((c) => {
              const on = selectedTargets.has(c.title.toLowerCase());
              return (
                <button className="m-row" key={c.path} onClick={() => relationToggle(c.title)}>
                  <span>{c.title}</span>
                  {target.relationLimit === "one" ? (
                    on && <Check className="m-accent" size={ICON.head} />
                  ) : (
                    <span className={`m-slotmark${on ? " is-on" : ""}`} />
                  )}
                </button>
              );
            })}
            {target.relationLimit !== "one" && (
              <button className="m-cell-commit" onClick={onClose}>
                {t("common.ok")}
              </button>
            )}
          </>
        )}

        {input === "checkbox" && <button className="m-row" onClick={() => onCommit(value !== true)}>
          <span>{col}</span><span className={`m-slotmark${value === true ? " is-on" : ""}`} /></button>}
        {isDate && (
          <div className="m-sheet-inputrow">
            <TextInput
              onChange={(e) => setText(e.target.value)}
              type={input === "datetime" ? "datetime-local" : "date"}
              value={text}
            />
            <IconButton
              label={t("common.ok", { defaultValue: "OK" })}
              onClick={() => onCommit(input === "datetime" && text.includes("T") ? dateTimeEditorValue(text.slice(0, 10), text.slice(11)) : text)}
            >
              <Check size={ICON.head} />
            </IconButton>
          </div>
        )}

        {!isSelect && !isMulti && !isRelation && !isDate && input !== "checkbox" && (
          <>
            <div className="m-sheet-inputrow">
              <TextInput
                inputMode={
                  input === "number"
                    ? "decimal"
                    : input === "url"
                      ? "url"
                      : input === "email"
                        ? "email"
                        : input === "phone"
                          ? "tel"
                          : undefined
                }
                onChange={(e) => setText(e.target.value)}
                placeholder={col}
                type={input === "number" ? "number" : "text"}
                value={text}
              />
              <IconButton
                label={t("common.ok", { defaultValue: "OK" })}
                onClick={() =>
                  onCommit(input === "number" && text.trim() !== "" ? Number(text) : text)
                }
              >
                <Check size={ICON.head} />
              </IconButton>
            </div>
            {matches.filter((o) => o.value !== text).map((o) => <button className="m-row" key={o.value}
              onClick={() => setText(o.value)}>{o.label ?? o.value}</button>)}
            {/* Contact types open externally (E3 parity to the desktop cells). */}
            {(input === "url" || input === "email" || input === "phone") && text.trim() !== "" && (
              <button
                className="m-row"
                onClick={() => {
                  const raw = text.trim();
                  const href =
                    input === "email"
                      ? `mailto:${raw}`
                      : input === "phone"
                        ? `tel:${raw}`
                        : /^[a-z][a-z0-9+.-]*:/i.test(raw)
                          ? raw
                          : `https://${raw}`;
                  void getPlatformServices().openExternal(href);
                }}
              >
                <ExternalLink size={ICON.head} />
                <span>{t("properties.openLink")}</span>
              </button>
            )}
          </>
        )}

        {!isRelation && !isDate && input !== "checkbox" && !usingCurated && !suggestions.wholeVault && (
          <button className="m-row" onClick={suggestions.expand}>{t("properties.searchWholeVault")}</button>
        )}
        {onCommentProperty && (
          <button className="m-row" onClick={onCommentProperty} data-testid="base-comment-property">
            <MessageSquare size={ICON.head} />
            <span>{t("comments.commentOnProperty")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
