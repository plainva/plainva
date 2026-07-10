import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseYaml } from "yaml";
import { ChevronLeft, Database, FileText } from "lucide-react";
import { EmptyState } from "@plainva/ui";
import { vaultOps, type MobileVault } from "./services/vaultService";

/**
 * Read-only .base rendering for mobile (M4/E8, extended in P6): the shared
 * core query (`queryDatabaseFiles`) evaluates sources (folder AND tag),
 * per-view filters, filter groups and sort rules exactly like the desktop —
 * this view only renders the resulting rows. Table is the default; `list`
 * and `cards` render natively, everything else (board/calendar/timeline/
 * graph) falls back to the table. Editing stays desktop-only; tapping a row
 * opens the note.
 */

interface BaseView {
  name?: string;
  type?: string;
  order?: string[];
  filters?: unknown;
  sort?: unknown;
  plainva?: { render?: string };
}

interface BaseYaml {
  filters?: unknown;
  views?: BaseView[];
}

type Row = Record<string, unknown>;

const MAX_TABLE_COLUMNS = 4;
const MAX_CARD_PROPS = 3;

/** Normalizes a filters value (string | {and}|{or}|{not}) into AND entries. */
function andEntriesOf(f: unknown): unknown[] {
  if (f == null) return [];
  if (typeof f === "string") return [f];
  if (typeof f === "object" && Array.isArray((f as { and?: unknown[] }).and)) {
    return (f as { and: unknown[] }).and;
  }
  return [f]; // an {or}/{not} root stays one nested entry
}

/** Wiki-link display text: `[[target|alias]]` -> alias, `[[target]]` -> target. */
function wikiDisplay(s: string): string {
  const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(s.trim());
  return m ? (m[2] ?? m[1]) : s;
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v === true) return "☑"; // checked box
  if (v === false) return "☐"; // empty box
  if (Array.isArray(v)) return v.map((x) => cellText(x)).join(", ");
  return wikiDisplay(String(v));
}

const columnLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

export function BaseReadView({
  vault,
  path,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.base$/i, "");
  const [cfg, setCfg] = useState<BaseYaml | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [rows, setRows] = useState<Row[] | null>(null);

  // Load and parse the .base once per path.
  useEffect(() => {
    let stale = false;
    setCfg(null);
    setRows(null);
    setViewIndex(0);
    void vaultOps.read(vault, path).then((raw) => {
      if (stale) return;
      try {
        const parsed = parseYaml(raw) as BaseYaml;
        setCfg(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        setCfg({});
      }
    });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  const views = useMemo(() => cfg?.views ?? [], [cfg]);
  const view: BaseView = views[viewIndex] ?? {};

  // Query the active view through the shared core evaluator: base-global
  // source filters AND the view's own filter rules (per-view filters,
  // desktop parity), sorted by the view's sort rules.
  useEffect(() => {
    if (!cfg) return;
    const q = vault.queryService;
    if (!q) {
      setRows([]);
      return;
    }
    let stale = false;
    const viewEntries = andEntriesOf(view.filters);
    const rootFilters = cfg.filters as { or?: unknown[] } | string | undefined;
    const filters =
      viewEntries.length === 0 &&
      rootFilters &&
      typeof rootFilters === "object" &&
      Array.isArray(rootFilters.or)
        ? rootFilters // pure or-root passes through for the SQL pushdown
        : { and: [...andEntriesOf(cfg.filters), ...viewEntries] };
    void q
      .queryDatabaseFiles({ filters, views: [view] })
      .then((result: Row[]) => {
        if (!stale) setRows(result);
      })
      .catch(() => {
        if (!stale) setRows([]);
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, cfg, viewIndex]);

  const columns = useMemo(
    () =>
      (view.order ?? [])
        .map((key) => key.replace(/^note\./, ""))
        .filter((key) => key !== "file.name" && !key.startsWith("file.")),
    [view],
  );

  const render = view.plainva?.render ?? view.type ?? "table";
  const rowTitle = (r: Row) => String(r["file.name"] ?? "");
  const rowPath = (r: Row) => String(r["file.path"] ?? "");

  const renderCards = () => (
    <div className="m-basecards">
      {rows!.map((r) => (
        <button className="m-basecard" key={rowPath(r)} onClick={() => onOpenNote(rowPath(r))}>
          <span className="m-basecard-title">{rowTitle(r)}</span>
          {columns.slice(0, MAX_CARD_PROPS).map((c) =>
            cellText(r[c]) ? (
              <span className="m-basecard-prop" key={c}>
                <span className="m-prop-key">{columnLabel(c)}</span> {cellText(r[c])}
              </span>
            ) : null,
          )}
        </button>
      ))}
    </div>
  );

  const renderList = () => (
    <>
      {rows!.map((r) => (
        <button className="m-row" key={rowPath(r)} onClick={() => onOpenNote(rowPath(r))}>
          <FileText size={16} />
          <span>{rowTitle(r)}</span>
          {columns[0] && cellText(r[columns[0]]) ? (
            <span className="m-soon">{cellText(r[columns[0]])}</span>
          ) : null}
        </button>
      ))}
    </>
  );

  const renderTable = () => {
    const cols = columns.slice(0, MAX_TABLE_COLUMNS);
    return (
      <div className="m-basetable-wrap">
        <table className="m-basetable">
          <thead>
            <tr>
              <th>{t("mobile.baseName")}</th>
              {cols.map((c) => (
                <th key={c}>{columnLabel(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows!.map((r) => (
              <tr key={rowPath(r)} onClick={() => onOpenNote(rowPath(r))}>
                <td>{rowTitle(r)}</td>
                {cols.map((c) => (
                  <td key={c}>{cellText(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{title}</h1>
      </header>
      <p className="m-hint">{t("mobile.baseReadOnly")}</p>
      {views.length > 1 && (
        <div className="m-viewpills">
          {views.map((v, i) => (
            <button
              className={`m-viewpill${i === viewIndex ? " is-active" : ""}`}
              key={`${v.name ?? ""}-${i}`}
              onClick={() => setViewIndex(i)}
            >
              {v.name || v.type || String(i + 1)}
            </button>
          ))}
        </div>
      )}
      {rows === null ? null : !vault.queryService ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.baseEmpty")}</EmptyState>
      ) : render === "cards" || render === "card" || render === "gallery" ? (
        renderCards()
      ) : render === "list" ? (
        renderList()
      ) : (
        renderTable()
      )}
    </div>
  );
}
