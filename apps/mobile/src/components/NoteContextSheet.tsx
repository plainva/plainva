import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code, FileText, History, ListTree, Lock, Plus, Search } from "lucide-react";
import { inferType, parseHeadings, type Heading } from "@plainva/ui";
import { mPrompt } from "../services/mobileDialogs";
import { commitCellValue } from "../services/baseOps";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { CellEditSheet, type CellEditTarget } from "../screens/base/CellEditSheet";
import { ContextGraph } from "./ContextGraph";

type Tab = "props" | "backlinks" | "outline" | "graph";

/** OKF system fields stay read-only everywhere (desktop parity). */
const LOCKED = new Set(["type", "okf_version"]);

/**
 * Note context sheet (M3E package C1): the mobile counterpart of the desktop
 * right sidebar — one sheet with segments. Properties are EDITABLE here
 * (previously display-only): each row opens the shared .base cell editor and
 * commits through the same frontmatter updater; backlinks dedupe with an ×N
 * badge like the desktop panel; the outline jumps the editor to a heading.
 * The graph segment (package F) renders the shared context scene with
 * suggestion cards; version history opens through the action row (G).
 */
export function NoteContextSheet({
  vault,
  path,
  sourceMode,
  onClose,
  onOpenNote,
  onJumpToLine,
  onToggleSource,
  onFind,
  onVersions,
}: {
  vault: MobileVault;
  path: string;
  /** C4: current editor mode — the action row shows the mode it switches TO. */
  sourceMode: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onJumpToLine: (line: number) => void;
  onToggleSource: () => void;
  onFind: () => void;
  /** Opens the version history sheet (package G). */
  onVersions: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("props");
  const [props, setProps] = useState<Array<[string, unknown]>>([]);
  const [backlinks, setBacklinks] = useState<Array<{ path: string; title: string; count: number }>>([]);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [edit, setEdit] = useState<CellEditTarget | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stale = false;
    void (async () => {
      const q = vault.queryService;
      if (q) {
        const raw = await q.getFileProperties(path);
        const rows = Object.entries(raw) as Array<[string, unknown]>;
        const links = await q.getBacklinks(path);
        const bySource = new Map<string, number>();
        for (const l of links) bySource.set(l.source_path, (bySource.get(l.source_path) ?? 0) + 1);
        const bl = [...bySource.entries()].map(([p, count]) => ({
          path: p,
          title: p.split("/").pop()!.replace(/\.md$/i, ""),
          count,
        }));
        if (!stale) {
          setProps(rows);
          setBacklinks(bl);
        }
      }
      const text = await vaultOps.read(vault, path).catch(() => "");
      if (!stale) setHeadings(parseHeadings(text));
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
    void mPrompt({ title: t("editor.addProperty"), message: t("editor.key") }).then(({ value, cancelled }) => {
      const key = value?.trim();
      if (cancelled || !key || LOCKED.has(key)) return;
      setEdit({ notePath: path, col: key, input: "text", value: "", options: [] });
    });
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}>
        <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="m-sheet-grip" />
          <p className="m-sheet-title">{path.split("/").pop()!.replace(/\.md$/i, "")}</p>
          <div className="m-viewpills">
            {(
              [
                ["props", t("rightPanel.properties")],
                ["backlinks", t("rightPanel.backlinks")],
                ["outline", t("rightPanel.outline")],
                ["graph", t("rightPanel.graph")],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                className={tab === id ? "m-viewpill is-active" : "m-viewpill"}
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

          {/* Note actions (C4): mode toggle + in-note search, tab-independent. */}
          <p className="m-sectionlabel m-sectionlabel--inset">{t("mobile.noteInfo")}</p>
          <button
            className="m-row"
            onClick={() => {
              onClose();
              onToggleSource();
            }}
          >
            <Code className="m-accent" size={18} />
            <span>{sourceMode ? t("editor.livePreview") : t("editor.sourceMode")}</span>
          </button>
          <button
            className="m-row"
            onClick={() => {
              onClose();
              onFind();
            }}
          >
            <Search className="m-accent" size={18} />
            <span>{t("search.find")}</span>
          </button>
          <button
            className="m-row"
            onClick={() => {
              onClose();
              onVersions();
            }}
          >
            <History className="m-accent" size={18} />
            <span>{t("versions.title")}</span>
          </button>
        </div>
      </div>
      {edit && (
        <CellEditSheet
          onClose={() => setEdit(null)}
          onCommit={(value) => {
            const target = edit;
            setEdit(null);
            void commitCellValue(vault, target.notePath, target.col, value).then(() => setTick((n) => n + 1));
          }}
          rows={[]}
          target={edit}
          vault={vault}
        />
      )}
    </>
  );
}
