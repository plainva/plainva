import { useEffect, useState } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { FileText, ListTree, Lock, Plus } from "lucide-react";
import { inferType, parseHeadings, type Heading } from "@plainva/ui";
import { extractFrontmatter, parseMarkdownAst } from "@plainva/core";
import { mPrompt, mSelect } from "../services/mobileDialogs";
import { commitCellValue } from "../services/baseOps";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { CellEditSheet, type CellEditTarget } from "../screens/base/CellEditSheet";
import { ContextGraph } from "./ContextGraph";
import { VersionsPanel } from "./VersionsPanel";

export type ContextTab = "props" | "backlinks" | "outline" | "graph" | "history";

/** OKF system fields stay read-only everywhere (desktop parity). */
const LOCKED = new Set(["type", "okf_version"]);

/** plainva:-namespace fields (icon, stripe color) are edited from the note ⋮
 * menu — they are presentation, not user properties. */
/** Authoring vocabulary for new note properties (base sheet parity). */
const PROP_TYPES = [
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "select",
  "multiselect",
  "list",
  "tags",
  "url",
  "email",
  "phone",
] as const;

const isHiddenProp = (key: string) => key === "plainva" || key.startsWith("plainva.") || key.startsWith("plainva:");

/**
 * Note context sheet (M3E package C1 + mockup 4): the mobile counterpart of
 * the desktop right sidebar — ONE sheet with a segmented control:
 * Eigenschaften · Backlinks · Gliederung · Graph · Verlauf. Properties are
 * EDITABLE (shared .base cell editor + frontmatter updater); backlinks dedupe
 * with an ×N badge; the outline jumps the editor to a heading; the graph
 * segment renders the shared context scene with suggestion cards; history
 * embeds the versions panel (no stacked second sheet). File ACTIONS live in
 * the note's ⋮ menu, not here.
 */
export function NoteContextSheet({
  vault,
  path,
  initialTab = "props",
  onClose,
  onOpenNote,
  onJumpToLine,
  onRestored,
  onMutated,
}: {
  vault: MobileVault;
  path: string;
  initialTab?: ContextTab;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onJumpToLine: (line: number) => void;
  /** Reloads the editor after a version restore (package G). */
  onRestored: () => void;
  /** Called after a property write so the open editor reloads from disk —
   * otherwise its stale buffer overwrites the new frontmatter on save. */
  onMutated: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ContextTab>(initialTab);
  const [props, setProps] = useState<Array<[string, unknown]>>([]);
  const [backlinks, setBacklinks] = useState<Array<{ path: string; title: string; count: number }>>([]);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [edit, setEdit] = useState<CellEditTarget | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stale = false;
    void (async () => {
      // Properties come STRAIGHT from the file, not the index: after a commit
      // the index can lag a tick, and the panel must show the new key at once
      // (maintainer: the added property stayed invisible). Backlinks still
      // need the index — they span other notes.
      const text = await vaultOps.read(vault, path).catch(() => "");
      if (!stale) setHeadings(parseHeadings(text));
      const fm = extractFrontmatter(parseMarkdownAst(text));
      const raw = (fm.success && fm.data ? fm.data : {}) as Record<string, unknown>;
      const rows = (Object.entries(raw) as Array<[string, unknown]>).filter(([k]) => !isHiddenProp(k));
      if (!stale) setProps(rows);
      const q = vault.queryService;
      if (q) {
        const links = await q.getBacklinks(path);
        const bySource = new Map<string, number>();
        for (const l of links) bySource.set(l.source_path, (bySource.get(l.source_path) ?? 0) + 1);
        const bl = [...bySource.entries()].map(([p, count]) => ({
          path: p,
          title: p.split("/").pop()!.replace(/\.md$/i, ""),
          count,
        }));
        if (!stale) setBacklinks(bl);
      }
    })();
    return () => {
      stale = true;
    };
  }, [vault, path, tick]);

  const valueText = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

  const editProp = (key: string, value: unknown) => {
    setEdit({
      notePath: path,
      col: key,
      input: inferType(value, key),
      value,
      options: [],
    });
  };

  const addProp = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({ title: t("editor.addProperty"), message: t("editor.key") });
      const key = value?.trim();
      if (cancelled || !key || LOCKED.has(key)) return;
      // Field type first (maintainer feedback) — the cell editor then opens
      // with the matching input (date picker, checkbox, list, …).
      const type = await mSelect({
        title: t("properties.fieldType"),
        options: PROP_TYPES.map((x) => ({ value: x, label: t(`properties.type_${x}`, { defaultValue: x }) })),
        value: "text",
      });
      if (type === null) return;
      setEdit({ notePath: path, col: key, input: type, value: "", options: [] });
    })();
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}>
        <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
          <SheetGrip onClose={onClose} />
          <p className="m-sheet-title">{path.split("/").pop()!.replace(/\.md$/i, "")}</p>
          <div className="m-seg">
            {(
              [
                ["props", t("rightPanel.properties")],
                ["backlinks", t("rightPanel.backlinks")],
                ["outline", t("rightPanel.outline")],
                ["graph", t("rightPanel.graph")],
                ["history", t("mobile.segHistory")],
              ] as Array<[ContextTab, string]>
            ).map(([id, label]) => (
              <button
                className={tab === id ? "m-seg-item is-on" : "m-seg-item"}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "props" && (
            <>
              {props.map(([k, v]) =>
                LOCKED.has(k) ? (
                  <div className="m-row m-row--static" key={k}>
                    <Lock className="m-chevron" size={14} />
                    <span className="m-prop-key">{k}</span>
                    <span className="m-prop-val">{valueText(v)}</span>
                  </div>
                ) : (
                  <button className="m-row" key={k} onClick={() => editProp(k, v)}>
                    <span className="m-prop-key">{k}</span>
                    <span className="m-prop-val">{valueText(v)}</span>
                  </button>
                ),
              )}
              <button className="m-row" onClick={addProp}>
                <Plus className="m-accent" size={18} />
                <span>{t("editor.addProperty")}</span>
              </button>
            </>
          )}

          {tab === "backlinks" &&
            (backlinks.length === 0 ? (
              <p className="m-hint m-hint--inset">{t("mobile.noBacklinks")}</p>
            ) : (
              backlinks.map((b) => (
                <button
                  className="m-row"
                  key={b.path}
                  onClick={() => {
                    onClose();
                    onOpenNote(b.path);
                  }}
                >
                  <FileText size={18} />
                  <span>{b.title}</span>
                  {b.count > 1 && <span className="m-soon">×{b.count}</span>}
                </button>
              ))
            ))}

          {tab === "outline" &&
            (headings.length === 0 ? (
              <p className="m-hint m-hint--inset">{t("rightPanel.outlineEmpty")}</p>
            ) : (
              headings.map((h, i) => (
                <button
                  className="m-row"
                  key={`${h.line}-${i}`}
                  onClick={() => {
                    onClose();
                    onJumpToLine(h.line);
                  }}
                  style={{ paddingLeft: 16 + (h.level - 1) * 14 }}
                >
                  <ListTree className="m-accent" size={16} style={{ flexShrink: 0 }} />
                  <span>{h.text}</span>
                </button>
              ))
            ))}

          {tab === "graph" && <ContextGraph onOpenNote={onOpenNote} path={path} vault={vault} />}

          {tab === "history" && (
            <VersionsPanel onDone={onClose} onRestored={onRestored} path={path} vault={vault} />
          )}
        </div>
      </div>
      {edit && (
        <CellEditSheet
          onClose={() => setEdit(null)}
          onCommit={(value) => {
            const target = edit;
            setEdit(null);
            void commitCellValue(vault, target.notePath, target.col, value).then(() => {
              setTick((n) => n + 1);
              onMutated();
            });
          }}
          rows={[]}
          target={edit}
          vault={vault}
        />
      )}
    </>
  );
}
