import { useEffect, useState } from "react";
import { SheetGrip } from "../components/SheetGrip";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileText, ListTree, Lock, Plus } from "lucide-react";
import {
  errorText,
  formatActor,
  formatStampDate,
  generatedAtOf,
  getPlatformServices,
  type Heading,
  ICON,
  inferType,
  parseHeadings,
  Segmented,
  toast,
  TRUST_LEVEL_I18N,
  trustLevelOf,
} from "@plainva/ui";
import { extractFrontmatter, OKF_STATUS_VALUES, type OkfStatus, parseMarkdownAst, parseOkfTrustSignals } from "@plainva/core";
import { mPrompt, mSelect } from "../services/mobileDialogs";
import { commitCellValue } from "../services/baseOps";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { CellEditSheet, type CellEditTarget } from "../screens/base/CellEditSheet";
import { NoteDatabasesSection } from "./NoteDatabasesSection";
import { ContextGraph } from "./ContextGraph";
import { VersionsPanel } from "./VersionsPanel";

export type ContextTab = "props" | "backlinks" | "outline" | "databases" | "graph" | "history";

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
 * Eigenschaften · Backlinks · Gliederung · Datenbanken · Graph · Verlauf.
 * Properties are
 * EDITABLE (shared .base cell editor + frontmatter updater); backlinks dedupe
 * with an ×N badge; the outline jumps the editor to a heading; the graph
 * segment renders the shared context scene with suggestion cards; history
 * embeds the versions panel (no stacked second sheet). File ACTIONS live in
 * the note's ⋮ menu, not here.
 *
 * From the expanded window class it is DOCKED as the third column (S14, M3
 * supporting pane) — the same six sections, the same code, without the
 * backdrop, the grip and the dismiss. That is the desktop's right sidebar: on
 * a phone it arrives over the work, on a wide window it stands beside it.
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
  canWrite = true,
  docked = false,
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
  /** False while the workspace grants no `content.write` (read-only or
   * comment-only membership). Offering an editor that cannot save is worse
   * than showing the value: the write fails at the vault adapter, not here. */
  canWrite?: boolean;
  /** Third column instead of a sheet: no backdrop, no grip, no dismiss. */
  docked?: boolean;
}) {
  const { t, i18n } = useTranslation();
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

  // OKF 0.2 trust signals (plan P3a) — the same shared derivation as the
  // desktop panel: a foreign-shaped `status` (a task database's `Offen`) keeps
  // its generic row and gets no lifecycle UI; the provenance families render
  // read-only, the two lifecycle keys stay editable.
  const trust = parseOkfTrustSignals(Object.fromEntries(props));
  const claimed = new Set(trust.claimedKeys);
  const showStatusRow = !trust.statusForeign;
  const showStaleRow = !props.some(([k]) => k === "stale_after") || trust.staleAfter !== null;
  const genericProps = props.filter(([k]) => {
    if (claimed.has(k) && (k === "generated" || k === "verified" || k === "sources")) return false;
    if (k === "status" && showStatusRow) return false;
    if (k === "stale_after" && showStaleRow) return false;
    return true;
  });
  const trustLevel = trustLevelOf(trust);
  const generatedAt = generatedAtOf(trust);
  const actorWords = { person: t("trust.person"), process: t("trust.process") };
  const locale = i18n.language;
  const levelClass = trustLevel === "human-reviewed" ? " is-on" : trustLevel === "unverified" ? " pv-chip--muted" : "";
  const statusLabel = (s: OkfStatus) =>
    s === "draft" ? t("docHeader.statusDraft") : s === "deprecated" ? t("docHeader.statusDeprecated") : t("trust.statusStable");

  const writeTrust = (col: string, value: unknown) => {
    // An empty value deletes the key (delete-on-empty of the shared writer):
    // an empty `status:` is not "stable", it is noise.
    void commitCellValue(vault, path, col, value)
      .then(() => {
        setTick((n) => n + 1);
        onMutated();
      })
      .catch((e) => {
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
      });
  };

  const pickStatus = () => {
    void (async () => {
      const value = await mSelect({
        title: t("trust.status"),
        options: [
          { value: "", label: t("trust.statusNone") },
          ...OKF_STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(s) })),
        ],
        value: trust.status ?? "",
      });
      if (value === null) return;
      writeTrust("status", value);
    })();
  };

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
      <div
        className={docked ? "m-col m-col--context" : "m-sheet-backdrop"}
        onClick={docked ? undefined : onClose}
      >
        <div
          className={docked ? "m-context-panel" : "pv-sheet m-sheet"}
          onClick={docked ? undefined : (e) => e.stopPropagation()}
        >
          {!docked && <SheetGrip onClose={onClose} />}
          <p className="m-sheet-title">{path.split("/").pop()!.replace(/\.md$/i, "")}</p>
          <Segmented
            ariaLabel={t("mobile.noteContext")}
            options={[
              { value: "props", label: t("rightPanel.properties") },
              { value: "backlinks", label: t("rightPanel.backlinks") },
              { value: "outline", label: t("rightPanel.outline") },
              { value: "databases", label: t("rightPanel.databases") },
              { value: "graph", label: t("rightPanel.graph") },
              { value: "history", label: t("mobile.segHistory") },
            ]}
            value={tab}
            onChange={(v) => setTab(v as ContextTab)}
          />

          {tab === "props" && (
            <>
              {genericProps.map(([k, v]) =>
                LOCKED.has(k) || !canWrite ? (
                  <div className="m-row m-row--static" key={k}>
                    <Lock className="m-chevron" size={ICON.meta} />
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
              <div className="m-row m-row--static" data-testid="okf-trust-section">
                <span className="m-prop-key">{t("trust.title")}</span>
                <span className="m-prop-val">
                  <span className={`pv-chip pv-chip--sm${levelClass}`} data-testid="okf-trust-level" data-level={trustLevel}>
                    {t(TRUST_LEVEL_I18N[trustLevel])}
                  </span>
                </span>
              </div>
              {generatedAt && (
                <div className="m-row m-row--static">
                  <span className="m-prop-key">{t("trust.generated")}</span>
                  <span className="m-prop-val">
                    {trust.generated ? `${formatActor(trust.generated.by, actorWords)} · ` : ""}
                    {formatStampDate(generatedAt, locale)}
                  </span>
                </div>
              )}
              {trust.verified.map((v, i) => (
                <div className="m-row m-row--static" key={`${v.by}-${v.at}-${i}`}>
                  <span className="m-prop-key">{i === 0 ? t("trust.verified") : ""}</span>
                  <span className="m-prop-val">
                    {formatActor(v.by, actorWords)} · {formatStampDate(v.at, locale)}
                  </span>
                </div>
              ))}
              {trust.sources.map((s, i) => {
                const label = s.title ?? s.resource;
                return /^https?:\/\//i.test(s.resource) ? (
                  <button
                    className="m-row"
                    key={`${s.resource}-${i}`}
                    onClick={() => {
                      void getPlatformServices().openExternal(s.resource);
                    }}
                  >
                    <span className="m-prop-key">{i === 0 ? t("trust.sources") : ""}</span>
                    <span className="m-prop-val">{label}</span>
                    <ExternalLink className="m-chevron" size={ICON.meta} />
                  </button>
                ) : (
                  <div className="m-row m-row--static" key={`${s.resource}-${i}`}>
                    <span className="m-prop-key">{i === 0 ? t("trust.sources") : ""}</span>
                    <span className="m-prop-val">{label}</span>
                  </div>
                );
              })}
              {showStatusRow &&
                (canWrite ? (
                  <button className="m-row" data-testid="okf-status-row" onClick={pickStatus}>
                    <span className="m-prop-key">{t("trust.status")}</span>
                    <span className="m-prop-val">{trust.status ? statusLabel(trust.status) : t("trust.statusNone")}</span>
                  </button>
                ) : (
                  <div className="m-row m-row--static">
                    <Lock className="m-chevron" size={ICON.meta} />
                    <span className="m-prop-key">{t("trust.status")}</span>
                    <span className="m-prop-val">{trust.status ? statusLabel(trust.status) : t("trust.statusNone")}</span>
                  </div>
                ))}
              {showStaleRow &&
                (canWrite ? (
                  <button
                    className="m-row"
                    data-testid="okf-stale-row"
                    onClick={() => setEdit({ notePath: path, col: "stale_after", input: "date", value: trust.staleAfter ?? "", options: [] })}
                  >
                    <span className="m-prop-key">{t("trust.staleAfter")}</span>
                    <span className="m-prop-val">{trust.staleAfter ? formatStampDate(trust.staleAfter, locale) : t("trust.noDate")}</span>
                  </button>
                ) : (
                  <div className="m-row m-row--static">
                    <Lock className="m-chevron" size={ICON.meta} />
                    <span className="m-prop-key">{t("trust.staleAfter")}</span>
                    <span className="m-prop-val">{trust.staleAfter ? formatStampDate(trust.staleAfter, locale) : t("trust.noDate")}</span>
                  </div>
                ))}
              {canWrite && (
                <button className="m-row" onClick={addProp}>
                  <Plus className="m-accent" size={ICON.head} />
                  <span>{t("editor.addProperty")}</span>
                </button>
              )}
            </>
          )}

          {tab === "backlinks" &&
            (backlinks.length === 0 ? (
              <p className="m-hint">{t("mobile.noBacklinks")}</p>
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
                  <FileText size={ICON.head} />
                  <span>{b.title}</span>
                  {b.count > 1 && <span className="m-badge-muted">×{b.count}</span>}
                </button>
              ))
            ))}

          {tab === "outline" &&
            (headings.length === 0 ? (
              <p className="m-hint">{t("rightPanel.outlineEmpty")}</p>
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
                  <ListTree className="m-accent" size={ICON.ui} style={{ flexShrink: 0 }} />
                  <span>{h.text}</span>
                </button>
              ))
            ))}

          {tab === "databases" && (
            <NoteDatabasesSection
              onOpenBase={(p) => {
                onClose();
                onOpenNote(p);
              }}
              onOpenNote={(p) => {
                onClose();
                onOpenNote(p);
              }}
              path={path}
              vault={vault}
            />
          )}

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
            // S20: this had no `.catch`. A failed write (read-only membership,
            // a locked file, a full disk) closed the sheet and left the old
            // value on screen — the user believed the change had landed.
            void commitCellValue(vault, target.notePath, target.col, value)
              .then(() => {
                setTick((n) => n + 1);
                onMutated();
              })
              .catch((e) => {
                toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
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
