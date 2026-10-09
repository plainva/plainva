import { useCallback, useEffect, useMemo, useState } from "react";
import { SheetGrip } from "../../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { Check, ExternalLink, MessageSquare } from "lucide-react";
import { asSingleLineValue, type CuratedOption, dateTimeEditorValue, GrowingField, getPlatformServices, ICON, IconButton, inlineOptionsFrom, propertyFolder, propertyIndexTypes, usePropertyValues, parseWikiLinkValue, Rating, SearchField, splitMultiValue, TextInput } from "@plainva/ui";
import { relationCandidates } from "../../services/baseOps";
import type { MobileVault } from "../../services/vaultService";
import { ChoiceMark, useChoiceBeat } from "../../components/ChoiceMark";
import { buildWikiTargetSet, wikiLinkTextFor, wikiTargetPath, type WikiTargetSet } from "@plainva/ui";

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
  // One value from a list closes the sheet after the mark has moved (E21):
  // a status picked here used to vanish with the sheet before it showed.
  const beat = useChoiceBeat<string>((picked) => onCommit(picked));

  // Which note a stored link means, and what a pick writes, is the link
  // rule's — as in the desktop's relation editor. A stored value may name its
  // note by file name, path or title; a pick writes the file's name, the title
  // as the link's text where it reads otherwise (`wikiLinkTextFor`). This sheet
  // used to compare and write TITLES: a value the desktop had written with the
  // file's name was not shown as chosen here, and the two shells wrote
  // different text for the same pick (finding 2026-10-08).
  const [links, setLinks] = useState<{ lookup: WikiTargetSet; notePaths: string[] } | null>(null);
  useEffect(() => {
    const qs = vault.queryService;
    if (!isRelation || !qs) return;
    let stale = false;
    void qs.linkTargets().then((files) => {
      if (!stale) setLinks({ lookup: buildWikiTargetSet(files), notePaths: files.filter((f) => f.mode !== "attachment").map((f) => f.path) });
    }).catch(() => {});
    return () => {
      stale = true;
    };
  }, [vault, isRelation]);

  const targetOf = (v: string) => parseWikiLinkValue(v)?.target ?? v;
  /** Whether a stored value links this candidate. By title only until the lookup is there (or where there is no index). */
  const means = (v: string, c: { path: string; title: string }) =>
    links ? wikiTargetPath(targetOf(v), links.lookup, target.notePath) === c.path : targetOf(v).toLowerCase() === c.title.toLowerCase();
  const linkTextOf = (c: { path: string; title: string }) => (links ? wikiLinkTextFor(c.path, c.title, links.notePaths) : `[[${c.title}]]`);

  const relationToggle = (c: { path: string; title: string }) => {
    const link = linkTextOf(c);
    if (target.relationLimit === "one") {
      beat.pick(link);
      return;
    }
    const current = toArray(value);
    const exists = current.some((v) => means(v, c));
    const next = exists ? current.filter((v) => !means(v, c)) : [...current, link];
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
              <button className="m-row" key={o.value} onClick={() => beat.pick(o.value)}>
                <span>{o.label ?? o.value}</span>
                <ChoiceMark on={(beat.picked ? beat.picked.value : String(value ?? "")) === o.value} />
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
                  <ChoiceMark multiple on={on} />
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
            {/* Several at once holds until Done (E21, the mockup case b). */}
            <button className="m-cell-commit" onClick={() => commitMulti(multi)}>
              {t("common.done")}
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
              const on = beat.picked
                ? beat.picked.value === linkTextOf(c)
                : toArray(value).some((v) => means(v, c));
              return (
                <button className="m-row" key={c.path} onClick={() => relationToggle(c)}>
                  <span>{c.title}</span>
                  {/* One note is a ring, several are boxes — it was a tick
                      for one and a ring for several. */}
                  <ChoiceMark multiple={target.relationLimit !== "one"} on={on} />
                </button>
              );
            })}
            {target.relationLimit !== "one" && (
              <button className="m-cell-commit" onClick={onClose}>
                {t("common.done")}
              </button>
            )}
          </>
        )}

        {input === "checkbox" && <button className="m-row" onClick={() => onCommit(value !== true)}>
          <span>{col}</span><ChoiceMark multiple on={value === true} /></button>}
        {/* A rating is pressed, not typed (plan Journal-Erweiterungen, E5): the
            marks are the editor, and the file keeps a plain number. */}
        {input === "rating" && (
          <div className="m-sheet-inputrow">
            <Rating label={col} onChange={(next) => onCommit(next)} value={Number(value) || 0} />
          </div>
        )}
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
              {input === "number" ? (
                <TextInput inputMode="decimal" onChange={(e) => setText(e.target.value)} placeholder={col} type="number" value={text} />
              ) : (
                // As tall as its text (issue 118): a long value stays readable
                // while it is changed. One value — a pasted line break becomes
                // a space, and the keyboard's Enter does not add one.
                <GrowingField
                  enterKeyHint="done"
                  inputMode={input === "url" ? "url" : input === "email" ? "email" : input === "phone" ? "tel" : undefined}
                  onChange={(e) => setText(asSingleLineValue(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                  }}
                  placeholder={col}
                  value={text}
                />
              )}
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
