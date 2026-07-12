import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ExternalLink, Search } from "lucide-react";
import {
  getPlatformServices,
  inlineOptionsFrom,
  parseWikiLinkValue,
  splitMultiValue,
  type CuratedOption,
} from "@plainva/ui";
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
}: {
  vault: MobileVault;
  target: CellEditTarget;
  rows: any[];
  onCommit: (value: unknown) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { input, col, value } = target;
  const isMulti = input === "multiselect" || input === "tags" || input === "list";
  const isSelect = input === "select" || input === "status";
  const isRelation = input === "relation" || input === "link";
  const isDate = input === "date" || input === "datetime";

  const [text, setText] = useState(() =>
    Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value),
  );
  const [multi, setMulti] = useState<string[]>(() => toArray(value));
  const [free, setFree] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Array<{ path: string; title: string }>>([]);

  const options = useMemo(
    () => inlineOptionsFrom(target.options, rows, col),
    [target.options, rows, col],
  );

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
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{col}</p>

        {isSelect && (
          <>
            {options.map((o) => (
              <button className="m-row" key={o.value} onClick={() => onCommit(o.value)}>
                <span>{o.label ?? o.value}</span>
                {String(value ?? "") === o.value && <Check className="m-accent" size={18} />}
              </button>
            ))}
            <div className="m-sheet-inputrow">
              <input
                className="m-searchfield"
                onChange={(e) => setFree(e.target.value)}
                placeholder={t("database.addValueFree")}
                value={free}
              />
              <button
                className="m-iconbtn"
                disabled={!free.trim()}
                onClick={() => onCommit(free.trim())}
              >
                <Check size={20} />
              </button>
            </div>
            <button className="m-row m-danger" onClick={() => onCommit("")}>
              <span>{t("database.opEmpty")}</span>
            </button>
          </>
        )}

        {isMulti && (
          <>
            {[...new Set([...options.map((o) => o.value), ...multi])].map((val) => {
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
              <input
                className="m-searchfield"
                onChange={(e) => setFree(e.target.value)}
                placeholder={t("database.addValueFree")}
                value={free}
              />
              <button
                className="m-iconbtn"
                disabled={!free.trim()}
                onClick={() => {
                  const v = free.trim();
                  setFree("");
                  setMulti((m) => (m.includes(v) ? m : [...m, v]));
                }}
              >
                <Check size={20} />
              </button>
            </div>
            <button className="m-cell-commit" onClick={() => commitMulti(multi)}>
              {t("common.ok")}
            </button>
          </>
        )}

        {isRelation && (
          <>
            <div className="m-sheet-inputrow">
              <Search className="m-chevron" size={18} />
              <input
                className="m-searchfield"
                onChange={(e) => setQuery(e.target.value)}
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
                    on && <Check className="m-accent" size={18} />
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

        {isDate && (
          <div className="m-sheet-inputrow">
            <input
              className="m-searchfield"
              onChange={(e) => setText(e.target.value)}
              type={input === "datetime" ? "datetime-local" : "date"}
              value={text}
            />
            <button className="m-iconbtn" onClick={() => onCommit(text)}>
              <Check size={20} />
            </button>
          </div>
        )}

        {!isSelect && !isMulti && !isRelation && !isDate && (
          <>
            <div className="m-sheet-inputrow">
              <input
                className="m-searchfield"
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
              <button
                className="m-iconbtn"
                onClick={() =>
                  onCommit(input === "number" && text.trim() !== "" ? Number(text) : text)
                }
              >
                <Check size={20} />
              </button>
            </div>
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
                <ExternalLink size={18} />
                <span>{t("properties.openLink")}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
