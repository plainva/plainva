import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FileText, Hash, Pencil } from "lucide-react";
import { isValidTagName, renameTagInText } from "@plainva/core";
import { DocIcon, EmptyState, ICON, IconButton, normalizeRenameTarget, renameTagAcrossVault, toast } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { useLongPress } from "./lib/useLongPress";
import { mPrompt } from "./services/mobileDialogs";
import { RowActionSheet } from "./components/RowActionSheet";
import { vaultOps, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";

/**
 * Tags (P3; hierarchical in package I): index-backed tag list with counts.
 * The overview groups by the first segment; a root row aggregates its nested
 * tags and expands them indented (desktop tag-tree parity, touch sized).
 * Tapping a tag lists its notes; `tag` empty = the overview level.
 */
export function TagsScreen({
  vault,
  tag,
  bump = 0,
  onBack,
  onOpenTag,
  onOpenNote,
  pane = false,
}: {
  vault: MobileVault;
  tag: string;
  bump?: number;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  /** Rendered as a pane INSIDE the navigator: no page wrapper, no own pull. */
  pane?: boolean;
  onOpenTag: (tag: string) => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [files, setFiles] = useState<Array<{ path: string; title: string }>>([]);
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const tagPress = useLongPress<string>((x) => setSheet(x));
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  // Hierarchy (package I): group by the first segment; the root row carries
  // the aggregate count and expands its nested tags.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { total: number; hasSelf: boolean; children: Array<{ tag: string; count: number }> }
    >();
    for (const row of tags) {
      const root = row.tag.split("/")[0];
      let g = map.get(root);
      if (!g) {
        g = { total: 0, hasSelf: false, children: [] };
        map.set(root, g);
      }
      g.total += row.count;
      if (row.tag === root) g.hasSelf = true;
      else g.children.push(row);
    }
    return [...map.entries()];
  }, [tags]);

  useEffect(() => {
    let stale = false;
    if (!vault.queryService) return;
    if (tag) {
      void vault.queryService.getFilesByTag(tag).then((rows) => {
        if (!stale) setFiles(rows.map((r) => ({ path: r.path, title: r.title })));
      });
      void vault.queryService.getDocumentIcons().then((m) => {
        if (!stale) setDocIcons(m);
      }).catch(() => {});
    } else {
      void vault.queryService.getAllTags().then((rows) => {
        if (!stale) setTags(rows);
      });
    }
    return () => {
      stale = true;
    };
  }, [vault, tag, bump, tick]);

  /**
   * Vault-wide rename (S32). The desktop has had this since B6; the phone had
   * no way to correct a typo in a tag that already sits in forty notes, and
   * doing it by hand on a phone is not a real option.
   *
   * Which notes, what on failure, what to report: all decided by the shared
   * rule, so the two shells cannot answer it differently.
   */
  const renameTag = async (fullTag: string) => {
    const res = await mPrompt({
      title: t("tags.renameTag"),
      message: t("tags.renameMessage", { tag: fullTag }),
      initial: fullTag,
    });
    if (res.cancelled) return;
    const newName = normalizeRenameTarget(res.value, fullTag, isValidTagName);
    if (newName === null) return;
    if (!vault.queryService) return;
    const service = vault.queryService;
    const out = await renameTagAcrossVault(
      {
        findNotesWithTag: (tg) => service.findNotesWithTag(tg),
        readTextFile: (path) => vaultOps.read(vault, path),
        writeTextFile: (path, content) => vaultOps.save(vault, path, content),
        rename: renameTagInText,
      },
      fullTag,
      newName,
    );
    // The helper counts per-note write failures for a reason; reporting only
    // `notes` called a rename in which every write failed a completed rename
    // (S45).
    if (out.failed > 0) toast.warning(t("tags.renamePartial", { old: fullTag, new: newName, notes: out.notes, failed: out.failed }));
    else toast.info(t("tags.renameDone", { old: fullTag, new: newName, notes: out.notes }));
    setTick((x) => x + 1);
  };

  const body = (
    <>
      {onBack && (
        <AppBar onBack={onBack} title={tag ? `#${tag}` : t("mobile.tags")} />
      )}
      {tag ? (
        files.map((f) => (
          <button className="m-row" key={f.path} onClick={() => onOpenNote(f.path)}>
            {docIcons.get(f.path) ? (
              <span className="m-rowicon">
                <DocIcon color={docIcons.get(f.path)!.color} icon={docIcons.get(f.path)!.icon} size={ICON.head} />
              </span>
            ) : (
              <FileText size={ICON.ui} />
            )}
            <span>{f.title}</span>
          </button>
        ))
      ) : tags.length === 0 ? (
        <EmptyState icon={<Hash size={ICON.head} />}>{t("mobile.noTags")}</EmptyState>
      ) : (
        groups.map(([root, g]) => (
          <Fragment key={root}>
            <div className="m-row m-row--split">
              <button
                className="m-row-main"
                onClick={() => { if (tagPress.clicked()) onOpenTag(root); }}
                onContextMenu={(e) => { e.preventDefault(); setSheet(root); }}
                onPointerCancel={tagPress.clear}
                onPointerDown={() => tagPress.start(root)}
                onPointerLeave={tagPress.clear}
                onPointerUp={tagPress.clear}
              >
                <Hash className="m-accent" size={ICON.ui} />
                <span>{root}</span>
                <span className="m-badge-muted">{g.total}</span>
              </button>
              {g.children.length > 0 && (
                <IconButton
                  label={root}
                  aria-expanded={open.has(root)}
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(root)) next.delete(root);
                      else next.add(root);
                      return next;
                    })
                  }
                >
                  {open.has(root) ? (
                    <ChevronDown className="m-chevron" size={ICON.ui} />
                  ) : (
                    <ChevronRight className="m-chevron" size={ICON.ui} />
                  )}
                </IconButton>
              )}
            </div>
            {open.has(root) &&
              g.children.map((row) => (
                <button
                  className="m-row m-row--nested"
                  key={row.tag}
                  onClick={() => { if (tagPress.clicked()) onOpenTag(row.tag); }}
                  onContextMenu={(e) => { e.preventDefault(); setSheet(row.tag); }}
                  onPointerCancel={tagPress.clear}
                  onPointerDown={() => tagPress.start(row.tag)}
                  onPointerLeave={tagPress.clear}
                  onPointerUp={tagPress.clear}
                >
                  <Hash className="m-chevron" size={ICON.meta} />
                  <span>{row.tag.slice(root.length + 1)}</span>
                  <span className="m-badge-muted">{row.count}</span>
                </button>
              ))}
          </Fragment>
        ))
      )}
      {sheet && (
        <RowActionSheet
          title={`#${sheet}`}
          onClose={() => setSheet(null)}
          actions={[
            {
              icon: <Pencil size={ICON.head} />,
              label: t("tags.renameTag"),
              onClick: () => { const tg = sheet; setSheet(null); void renameTag(tg); },
            },
          ]}
        />
      )}
    </>
  );

  if (pane) return body;
  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      {body}
    </div>
  );
}
