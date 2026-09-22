import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkMappedBreaks as remarkBreaks } from './markdownReaderModel';
import { resolveVaultRelative, readAnchorRegions, rehypeReadAnchors, imageCandidates, rehypeReaderSource, resolveNoteEmbed, Button, imageBasename, isImageTarget, parseWikiImageTarget, type AnchorHighlight } from '@plainva/ui';
import { prepareReaderSource, selectNoteFragment } from '@plainva/core';
import { loadImageBlob, imageMimeType } from '@plainva/ui';
import { openContextMenu } from '../services/contextMenuStore';
import { toast } from '@plainva/ui';
import { parseHeadings, requestAnchorJump, slugify, splitLinkAnchor } from '@plainva/ui';
import { isWikiTargetResolved, planRelativeLinkOpen } from '@plainva/ui';
import { useWikiResolver } from '../hooks/useWikiResolver';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Folder, FileText } from 'lucide-react';
import { useVault } from '../contexts/VaultContext';
import { calloutColor, calloutColorKey, calloutLine, calloutTint, calloutIconPath, parseCalloutMarker } from '@plainva/ui';
import { CodeBlock } from './CodeBlock';
import { MermaidDiagram } from './MermaidDiagram';
import { BaseViewer } from './BaseViewer';
import { formatRelativeDate } from '@plainva/ui';
import { isDoneTaskItem, remarkStripHtmlComments, remarkBrToBreak, remarkHtmlCheckbox, remarkStripHighlightMarks, remarkTagPills, remarkTaskStates, resolveRelativeTarget, type RelativeTarget } from './markdownReaderModel';
import { DocIcon, isRenderableDocIcon } from '@plainva/ui';
import type { DocIconEntry } from '../hooks/useDocumentIcons';
import { ICON } from "@plainva/ui";

interface MarkdownReaderProps {
  content: string;
  onOpenPath?: (path: string, newTab: boolean) => void;
  embedDepth?: number;
  /** When true, use the full pane width instead of the centered readable column. */
  fullWidth?: boolean;
  /** Vault path of the rendered file — resolves its relative markdown links. */
  sourcePath?: string;
  /** Path -> document icon; drawn in front of listing links (managed index.md). */
  docIcons?: Map<string, DocIconEntry>;
  /** Show file/folder icons in front of resolved relative links. */
  showLinkIcons?: boolean;
  /**
   * Makes task checkboxes clickable (P3.1): called with the 0-based document
   * order of the toggled checkbox. Absent = read-only rendering (embeds,
   * managed index.md).
   */
  onToggleTask?: (index: number, checked: boolean) => void;
  /**
   * Ticks an `<input type="checkbox">` written as HTML — the only way to put
   * a box in a table cell (finding 2026-09-22). Its own ordinal space: these
   * boxes carry no task metadata and no recurrence. Absent = read-only, which
   * is right for a card or a preview.
   */
  onToggleHtmlBox?: (index: number, checked: boolean) => void;
  /**
   * Open comment anchors of this note, in source offsets (Sammelplan C28):
   * the read view tints, frames and marks them exactly as the editor does.
   * Absent = nothing to draw (embeds, managed index.md).
   */
  anchors?: readonly AnchorHighlight[];
  /** A click on a tint, frame or region opens that comment's card. */
  onActivateAnchor?: (commentId: string) => void;
}

/**
 * Vault image in read mode, loaded as a BLOB URL through the adapter (P5.11)
 * — the asset protocol (and its filesystem-wide scope) is disabled. The URL
 * is revoked on unmount/path change.
 */
/** The regions a comment marked on a picture, laid over it (C28). */
const AnchorRegions: React.FC<{ regions: string | undefined; onActivate?: (commentId: string) => void }> = ({ regions, onActivate }) => {
  const list = readAnchorRegions(regions);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((r, i) => (
        <span
          key={i}
          className={r.active ? 'pv-read-anchor-region pv-read-anchor-region--active' : 'pv-read-anchor-region'}
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          data-comment-id={r.commentId}
          onClick={(e) => { e.stopPropagation(); onActivate?.(r.commentId); }}
        />
      ))}
    </>
  );
};

const VaultImage: React.FC<{
  path: string;
  /** Further vault-relative paths to try when `path` does not load (P3). */
  fallbacks?: string[];
  /** The bare file name for the index lookup — Obsidian's way of naming attachments. */
  basename?: string | null;
  /** Obsidian's `|300`: a display width in CSS pixels. */
  width?: number | null;
  alt: string;
  frameClass?: string;
  regions?: string;
  commentId?: string;
  onActivate?: (commentId: string) => void;
  onOpenPath?: (path: string, newTab: boolean) => void;
}> = ({ path, fallbacks, basename, width, alt, frameClass, regions, commentId, onActivate, onOpenPath }) => {
  const { vaultAdapter, queryService } = useVault();
  const { t } = useTranslation();
  const [url, setUrl] = React.useState<string | null>(null);
  const [loadedPath, setLoadedPath] = React.useState(path);
  const [failed, setFailed] = React.useState(false);
  const fallbackKey = (fallbacks ?? []).join('\n');

  React.useEffect(() => {
    if (!vaultAdapter) return;
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    void (async () => {
      const candidates = [path, ...(fallbackKey ? fallbackKey.split('\n') : [])];
      // The index answers last: it is the only candidate that costs a query.
      if (basename && queryService) {
        const indexed = await queryService.findByFileName(basename, path).catch(() => null);
        if (indexed && !candidates.includes(indexed)) candidates.push(indexed);
      }
      for (const candidate of candidates) {
        try {
          const blob = await loadImageBlob(vaultAdapter, candidate);
          if (!alive) return;
          objectUrl = URL.createObjectURL(blob);
          setLoadedPath(candidate);
          setUrl(objectUrl);
          return;
        } catch {
          /* try the next candidate */
        }
      }
      if (alive) setFailed(true);
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vaultAdapter, queryService, path, fallbackKey, basename]);

  if (failed) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{alt || path}</span>;
  if (!url) return <span aria-hidden="true" />;
  const img = (
    <img
      src={url}
      alt={alt}
      className={frameClass}
      onClick={commentId ? () => onActivate?.(commentId) : undefined}
      onContextMenu={(e) => {
        if (!vaultAdapter) return;
        e.preventDefault();
        e.stopPropagation();
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          selection: "",
          editable: null,
          image: { open: () => onOpenPath?.(loadedPath, false), loadBytes: () => vaultAdapter.readBinaryFile(loadedPath), filename: loadedPath.split(/[/\\]/).pop() ?? "image", mime: imageMimeType(loadedPath) },
        });
      }}
      style={{ maxWidth: '100%', borderRadius: 'var(--radius-xs)', ...(width ? { width: `${width}px` } : {}) }}
    />
  );
  return (
    <span className="pv-image-embed">
      <span className="pv-read-anchor-host pv-image-frame">
        {img}
        {frameClass && <AnchorRegions regions={regions} onActivate={onActivate} />}
      </span>
      {onOpenPath && <Button variant="ghost" size="sm" className="pv-image-open" onClick={() => onOpenPath(loadedPath, false)}>{t("contextMenu.openImage")}</Button>}
    </span>
  );
};

export const EmbeddedNote: React.FC<{ target: string; depth: number; onOpenPath?: (path: string, newTab: boolean) => void; hostPath?: string }> = ({ target, depth, onOpenPath, hostPath }) => {
  const { vaultAdapter, queryService, fileTreeVersion } = useVault();
  const { t } = useTranslation();
  const [result, setResult] = React.useState<{ path?: string; anchor?: string | null; content?: string; error?: string } | null>(null);
  React.useEffect(() => {
    let alive = true;
    setResult(null);
    if (depth >= 3) { setResult({ error: t("noteEmbed.depth") }); return; }
    if (!vaultAdapter) return;
    void (async () => {
      const resolved = await resolveNoteEmbed(target, hostPath, { exists: (path) => vaultAdapter.exists(path), db: queryService?.db });
      if (!alive) return;
      if (resolved.status !== "found") { setResult({ error: t("noteEmbed." + resolved.status, { target }) }); return; }
      if (resolved.path.toLowerCase().endsWith(".base")) { setResult(resolved); return; }
      const text = await vaultAdapter.readTextFile(resolved.path);
      if (!alive) return;
      const fragment = selectNoteFragment(text, resolved.anchor);
      setResult(fragment.status === "found" ? { ...resolved, content: fragment.text } : { ...resolved, error: t("noteEmbed." + fragment.status, { target }) });
    })().catch(() => { if (alive) setResult({ error: t("noteEmbed.unreadable", { target }) }); });
    return () => { alive = false; };
  }, [target, hostPath, depth, vaultAdapter, queryService, fileTreeVersion, t]);
  const open = () => {
    if (!result?.path) return;
    onOpenPath?.(result.path, false);
    if (result.anchor && !result.error) requestAnchorJump(result.path, result.anchor);
  };
  if (!result) return <div className="embedded-note">{t("editor.loading")}</div>;
  const base = result.path?.toLowerCase().endsWith(".base");
  return <div className={base ? "embedded-note embedded-note--base" : "embedded-note"}>
    {result.error ? <p role="status">{result.error}</p> : base && result.path
      ? <BaseViewer activePath={result.path} onOpenPath={onOpenPath} embedded hostPath={hostPath} />
      : <MarkdownReader content={result.content ?? ""} onOpenPath={onOpenPath} embedDepth={depth + 1} sourcePath={result.path} />}
    {result.path && <Button variant="ghost" size="sm" onClick={open}>{t("noteEmbed.openSource")}: {target}</Button>}
  </div>;
};

/** A list nested in an item - rendered by our own ul/ol, which still carries its hast node. */
function isNestedList(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) return false;
  const tag = (child.props as { node?: { tagName?: string } } | null)?.node?.tagName;
  return tag === "ul" || tag === "ol";
}

// Concatenate all text within a hast node (soft breaks come through as "\n").
function hastText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (Array.isArray(node.children)) return node.children.map(hastText).join("");
  return "";
}

// Remove the leading "[!type] title" header line from the first text node so the
// callout body does not repeat the title shown in the callout header.
function stripCalloutHeader(children: React.ReactNode): React.ReactNode {
  let done = false;
  const walk = (node: React.ReactNode): React.ReactNode => {
    if (done) return node;
    if (typeof node === "string") {
      const replaced = node.replace(/^\s*\[![^\]]+\][+-]?[^\n]*\n?/, "");
      if (replaced !== node) done = true;
      return replaced;
    }
    if (Array.isArray(node)) {
      const out: React.ReactNode[] = [];
      for (let i = 0; i < node.length; i++) {
        const wasDone = done;
        out.push(<React.Fragment key={i}>{walk(node[i])}</React.Fragment>);
        // The header line ends in a line break of its own; with the line gone
        // it would stand as an empty first line of the card (finding 2026-09-19).
        const next = node[i + 1];
        if (!wasDone && done && React.isValidElement(next) && next.type === "br") i++;
      }
      return out;
    }
    if (React.isValidElement(node)) {
      const el = node as React.ReactElement<{ children?: React.ReactNode }>;
      if (el.props && el.props.children != null) {
        return React.cloneElement(el, { ...el.props, children: walk(el.props.children) });
      }
    }
    return node;
  };
  return walk(children);
}

/**
 * Read-mode task-checkbox ordinal, computed at CLICK time from the DOM so it
 * exactly matches the visual order. The previous render-time counter drifted
 * under React.StrictMode's double render — clicking the first box toggled the
 * second. Scoped to the checkbox's OWN reader, so an embedded note's nested
 * `.markdown-reader` checkboxes never shift the outer note's count.
 */
export function taskCheckboxOrdinal(box: HTMLInputElement): number {
  const root = box.closest(".markdown-reader");
  if (!root) return 0;
  let ord = 0;
  for (const el of root.querySelectorAll('input[type="checkbox"]:not([data-html-box])')) {
    if (el === box) return ord;
    if (el.closest(".markdown-reader") === root) ord++;
  }
  return ord;
}

export const MarkdownReader: React.FC<MarkdownReaderProps> = ({ content, onOpenPath, embedDepth = 0, fullWidth = false, sourcePath, docIcons, showLinkIcons = false, onToggleTask, onToggleHtmlBox, anchors, onActivateAnchor }) => {
  const { vaultAdapter, queryService } = useVault();
  const { t, i18n } = useTranslation();
  const source = useMemo(() => prepareReaderSource(content, {
    formatDate: (date) => formatRelativeDate(date, new Date(), (i18n.language || "de").slice(0, 2)),
    isImage: (target) => isImageTarget(parseWikiImageTarget(target).target),
  }), [content, i18n.language]);
  const anchorPlugin = useMemo(() => {
    if (!anchors?.length) return null;
    return rehypeReadAnchors(anchors.map((a) => ({ ...a, from: source.toRendered(a.from), to: source.toRendered(a.to, "end") })));
  }, [anchors, source]);
  const sourcePlugin = useMemo(() => rehypeReaderSource(source, content), [source, content]);
  // Unresolved-link styling in read mode (maintainer 2026-07-18): same resolver
  // set as the editor, so a link to a not-yet-created note reads as muted here too.
  const wikiResolver = useWikiResolver();

  // Task checkboxes are matched back to the source by DOCUMENT ORDER; the
  // ordinal is read from the DOM at click time (taskCheckboxOrdinal) rather
  // than from a render-time counter, which drifted under StrictMode.

  // LaTeX math (P3.4): remark-math/rehype-katex/KaTeX CSS load lazily and
  // only when the note actually contains math syntax — the bundle stays out
  // of every math-free session. Until loaded, $…$ renders as plain text for
  // one frame.
  const hasMath = /\$\$[\s\S]+?\$\$|(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/.test(content);
  const [mathPlugins, setMathPlugins] = React.useState<{ remark: unknown; rehype: unknown } | null>(null);
  React.useEffect(() => {
    if (!hasMath || mathPlugins) return;
    let alive = true;
    void Promise.all([
      import("remark-math"),
      import("rehype-katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([rm, rk]) => {
      if (alive) setMathPlugins({ remark: rm.default, rehype: rk.default });
    }).catch((e) => console.warn("[MarkdownReader] loading KaTeX failed", e));
    return () => {
      alive = false;
    };
  }, [hasMath, mathPlugins]);

  // Relative/bundle-absolute markdown links (generated index.md listings!) open
  // in-app: folder links prefer the subfolder's index.md, otherwise they reveal
  // the folder in the tree. Without interception the webview would navigate and
  // reload the whole vault.
  const handleRelativeLinkClick = async (target: RelativeTarget, newTab: boolean) => {
    // The decision itself lives in `planRelativeLinkOpen` since issue #61 — the
    // editor needed the identical rule, and this view keeping its behaviour is
    // what proves that sharing it changed nothing.
    const outcome = vaultAdapter
      ? await planRelativeLinkOpen(target, (p) => vaultAdapter.exists(p))
      : { action: "notFound" as const, path: target.path };
    if (outcome.action === "open") {
      onOpenPath?.(outcome.path, newTab);
      if (target.anchor) requestAnchorJump(outcome.path, target.anchor);
      return;
    }
    if (outcome.action === "revealFolder") {
      window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: outcome.path } }));
      return;
    }
    toast.warning(t("dialogs.linkNotFoundMsg", { target: outcome.path }));
  };

  const linkIconFor = (target: RelativeTarget): React.ReactNode => {
    if (!showLinkIcons) return null;
    if (target.kind === "folder") return <Folder size={ICON.ui} style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true" />;
    const entry = docIcons?.get(target.path);
    if (entry && isRenderableDocIcon(entry.icon)) {
      return (
        <span aria-hidden="true" style={{ display: "inline-flex", width: 16, justifyContent: "center", flexShrink: 0 }}>
          <DocIcon icon={entry.icon} color={entry.color} size={ICON.ui} />
        </span>
      );
    }
    return <FileText size={ICON.ui} style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true" />;
  };



  const handleWikiLinkClick = async (rawTarget: string, newTab: boolean) => {
    if (!queryService || !onOpenPath) return;

    // The anchor (issue #92) rides along; `[[#Heading]]` is a place in THIS note.
    const { target: searchTarget, anchor } = splitLinkAnchor(rawTarget);
    if (!searchTarget) {
      if (anchor && sourcePath) requestAnchorJump(sourcePath, anchor);
      return;
    }

    const sql = `
      SELECT path FROM files
      WHERE title = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
      LIMIT 1
    `;
    const rows = await queryService.db.query(sql, [searchTarget, searchTarget, searchTarget + ".md"]);
    if (rows && rows.length > 0) {
      onOpenPath(rows[0].path, newTab);
      if (anchor) requestAnchorJump(rows[0].path, anchor);
    } else {
      // Not created yet — create the note (Obsidian parity, maintainer 2026-07-18).
      window.dispatchEvent(new CustomEvent("plainva-create-note-from-link", { detail: { target: searchTarget, hostPath: sourcePath, newTab } }));
    }
  };

  const processedContent = source.text;

  // The reading view's heading ids are the outline's slugs, looked up by the
  // heading's source line (issue #92): the second "Heading" is `heading-1`
  // here as it is there. By LINE, not by a counter — React may render one
  // heading component more than once, and a counter would drift.
  const headingIdByLine = new Map(parseHeadings(content).map((h) => [h.line, h.slug] as const));
  const headingId = (node: any): string => headingIdByLine.get(node?.properties?.dataSourceLine) ?? slugify(hastText(node));
  return (
    <div
      className="markdown-reader"
      // A tag pill (finding 2026-09-19) opens the notes with the tag - the same
      // event the live editor raises, so the shell has one way in.
      onClick={(e) => {
        const tag = (e.target as HTMLElement).closest?.('.pv-tag-pill')?.getAttribute('data-tag');
        if (tag) window.dispatchEvent(new CustomEvent('plainva-open-tag', { detail: { tag } }));
      }}
      style={{ padding: '2rem', maxWidth: fullWidth ? 'none' : '800px', margin: '0 auto', fontSize: 'var(--content-font-size, 16px)', lineHeight: '1.6', color: 'var(--text-main)', fontFamily: 'var(--font-content)' }}>
      <ReactMarkdown
        remarkPlugins={mathPlugins
          ? [remarkGfm, remarkTaskStates, remarkBreaks, remarkStripHtmlComments, remarkBrToBreak, remarkHtmlCheckbox, remarkStripHighlightMarks, remarkTagPills, mathPlugins.remark as never]
          : [remarkGfm, remarkTaskStates, remarkBreaks, remarkStripHtmlComments, remarkBrToBreak, remarkHtmlCheckbox, remarkStripHighlightMarks, remarkTagPills]}
        rehypePlugins={[sourcePlugin as never, ...(mathPlugins ? [mathPlugins.rehype as never] : []), ...(anchorPlugin ? [anchorPlugin as never] : [])]}
        urlTransform={(url) => url}
        components={{
          // A tinted run of text (C28): the click opens the comment it belongs to.
          mark: ({ node, ...props }) => {
            const id = (node as { properties?: { dataCommentId?: unknown } } | undefined)?.properties?.dataCommentId;
            return <mark {...props} onClick={typeof id === 'string' ? () => onActivateAnchor?.(id) : undefined} />;
          },
          // A proposal standing at its place (K5) opens its card the same way
          // (finding 2026-09-03) - an insertion has no struck passage to click.
          ins: ({ node, ...props }) => {
            const id = (node as { properties?: { dataCommentId?: unknown } } | undefined)?.properties?.dataCommentId;
            return <ins {...props} onClick={typeof id === 'string' ? () => onActivateAnchor?.(id) : undefined} />;
          },
          a: ({ node: _node, href, children, ...props }) => {
            if (href?.startsWith('wiki://')) {
              const target = decodeURIComponent(href.replace('wiki://', ''));
              const unresolved = !isWikiTargetResolved(target, wikiResolver);
              return (
                <a
                  href="#"
                  className={unresolved ? 'is-unresolved' : undefined}
                  data-tip={unresolved ? t('editor.unresolvedLinkTip', "Note doesn't exist yet — click to create") : undefined}
                  onClick={(e) => { e.preventDefault(); handleWikiLinkClick(target, e.ctrlKey || e.metaKey); }}
                  style={unresolved
                    ? { color: 'var(--wiki-link-unresolved-color, var(--text-muted))', textDecoration: 'underline dashed', cursor: 'pointer' }
                    : { color: 'var(--accent-color)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {children}
                </a>
              );
            }
            if (href?.startsWith('http://') || href?.startsWith('https://')) {
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    openUrl(href).catch(console.error);
                  }}
                  style={{ color: 'var(--accent-color)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {children}
                </a>
              );
            }
            // A fragment alone (issue #92, GitHub style): a place in this note —
            // intercepted, so the WebView never touches its location hash.
            if (href?.startsWith('#')) {
              return (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); if (sourcePath) requestAnchorJump(sourcePath, href); }}
                  style={{ color: 'var(--accent-color)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {children}
                </a>
              );
            }
            const rel = href != null && sourcePath != null ? resolveRelativeTarget(sourcePath, href) : null;
            if (rel) {
              const icon = linkIconFor(rel);
              return (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); void handleRelativeLinkClick(rel, e.ctrlKey || e.metaKey); }}
                  style={{
                    color: 'var(--accent-color)',
                    textDecoration: icon ? 'none' : 'underline',
                    cursor: 'pointer',
                    ...(icon ? { display: 'inline-flex', alignItems: 'center', gap: '0.45em' } : null),
                  }}
                >
                  {icon}
                  {children}
                </a>
              );
            }
            return <a href={href} style={{ color: 'var(--accent-color)' }} {...props}>{children}</a>;
          },
          img: ({ node, src, alt, ...props }) => {
            // What applyReadAnchors left on the picture (C28), if anything.
            const anchorProps = (node as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
            const frameClass = Array.isArray(anchorProps.className) ? (anchorProps.className as string[]).join(' ') : typeof anchorProps.className === 'string' ? anchorProps.className : undefined;
            const regions = typeof anchorProps.dataAnchorRegions === 'string' ? anchorProps.dataAnchorRegions : undefined;
            const commentId = typeof anchorProps.dataCommentId === 'string' ? anchorProps.dataCommentId : undefined;
            if (src?.startsWith('wiki-embed://')) {
              const target = decodeURIComponent(src.replace('wiki-embed://', ''));
              return <EmbeddedNote target={target} depth={embedDepth} onOpenPath={onOpenPath} hostPath={sourcePath} />;
            }
            if (src?.startsWith('wiki-image://')) {
              const inner = decodeURIComponent(src.replace('wiki-image://', ''));
              const embed = parseWikiImageTarget(inner);
              // Embed targets come from note content (possibly synced/foreign):
              // every candidate passes the vault guard — absolute paths and
              // escapes never load. Loading goes through a BLOB URL (P5.11) —
              // the filesystem-wide asset protocol is disabled entirely. The
              // candidates are the one image rule (P3): literal, beside the
              // note, then the index by basename, as Obsidian writes them.
              const candidates = imageCandidates(embed.target, { notePath: sourcePath ?? '' });
              if (candidates.length === 0) {
                return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{alt || embed.target}</span>;
              }
              return <VaultImage onOpenPath={onOpenPath} path={candidates[0]} fallbacks={candidates.slice(1)} basename={imageBasename(embed.target)} width={embed.width} alt={embed.alt || alt || embed.target} frameClass={frameClass} regions={regions} commentId={commentId} onActivate={onActivateAnchor} />;
            }
            if (src && !/^(https?:|data:|blob:)/.test(src)) {
              // Plain markdown image with a FILE-relative path (standard MD:
              // relative to the note). Resolve against the note's folder and
              // load from the vault; escaping/absolute targets never load.
              const baseFolder = sourcePath && sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
              const rel = resolveVaultRelative(baseFolder ? `${baseFolder}/${decodeURIComponent(src)}` : decodeURIComponent(src));
              if (!rel) {
                return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{alt || src}</span>;
              }
              return <VaultImage onOpenPath={onOpenPath} path={rel} alt={alt || rel} frameClass={frameClass} regions={regions} commentId={commentId} onActivate={onActivateAnchor} />;
            }
            return <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: "var(--radius-xs)" }} {...props} />;
          },
          h1: ({ node, ...props }) => <h1 id={headingId(node)} style={{ fontSize: '2em', marginTop: '0.67em', marginBottom: '0.4em', color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2em' }} {...props} />,
          h2: ({ node, ...props }) => <h2 id={headingId(node)} style={{ fontSize: '1.5em', marginTop: '0.83em', marginBottom: '0.4em', color: 'var(--text-main)', borderBottom: '1px solid var(--border-color-light)', paddingBottom: '0.2em' }} {...props} />,
          h3: ({ node, ...props }) => <h3 id={headingId(node)} style={{ fontSize: '1.17em', marginTop: '1em', marginBottom: '0.4em', color: 'var(--text-main)' }} {...props} />,
          h4: ({ node, ...props }) => <h4 id={headingId(node)} style={{ fontSize: '1em', marginTop: '1.1em', marginBottom: '0.4em', color: 'var(--text-main)' }} {...props} />,
          h5: ({ node, ...props }) => <h5 id={headingId(node)} style={{ fontSize: '0.9em', marginTop: '1.2em', marginBottom: '0.4em', color: 'var(--text-muted)' }} {...props} />,
          h6: ({ node, ...props }) => <h6 id={headingId(node)} style={{ fontSize: '0.85em', marginTop: '1.2em', marginBottom: '0.4em', color: 'var(--text-muted)' }} {...props} />,
          p: ({ node, ...props }) => {
            const hasEmbed = node?.children.some((child) => child.type === "element" && child.tagName === "img" && String(child.properties.src ?? "").startsWith("wiki-embed://"));
            return hasEmbed ? <div {...props} /> : <p style={{ margin: '0.6em 0', color: 'var(--text-main)' }} {...props} />;
          },
          hr: ({ node: _node, ...props }) => <hr style={{ border: 'none', borderTop: '2px solid var(--border-color)', margin: '1.5em 0' }} {...props} />,
          ul: ({ node: _node, ...props }) => <ul style={{ paddingLeft: '1.5em', margin: '0.5em 0' }} {...props} />,
          ol: ({ node: _node, ...props }) => <ol style={{ paddingLeft: '1.5em', margin: '0.5em 0' }} {...props} />,
          li: ({ node, className, children, ...props }) => {
            const isTask = className?.includes('task-list-item');
            // A done task reads like one (finding 2026-09-19): muted and struck
            // through, as in the live editor. Only the item's OWN text - a
            // text-decoration cannot be undone further down, so a list nested
            // under a done task stays outside the struck box.
            if (isTask && isDoneTaskItem(node)) {
              const all = React.Children.toArray(children);
              const nested = all.filter(isNestedList);
              return (
                <li className={className} style={{ listStyleType: 'none', marginLeft: '-1.2em' }} {...props}>
                  <div className="pv-reader-task-done">{all.filter((child) => !isNestedList(child))}</div>
                  {nested}
                </li>
              );
            }
            // `[/]` in progress: the native "indeterminate" dash. It is a property,
            // not an attribute, so it is set on the box once the item is in the DOM.
            if (isTask && (props as Record<string, unknown>)['data-task-state'] === 'progress') {
              return (
                <li
                  className={className}
                  style={{ listStyleType: 'none', marginLeft: '-1.2em' }}
                  {...props}
                  ref={(el: HTMLLIElement | null) => {
                    const box = el?.querySelector<HTMLInputElement>(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
                    if (box) box.indeterminate = true;
                  }}
                >
                  {children}
                </li>
              );
            }
            return (
              <li className={className} style={isTask ? { listStyleType: 'none', marginLeft: '-1.2em' } : undefined} {...props}>
                {children}
              </li>
            );
          },
          input: ({ node: _node, ...props }) => {
            if (props.type === "checkbox") {
              // A box written as HTML (the only way to put one in a table
              // cell) has its own ordinal space and its own writer; a GFM box
              // keeps the task one, with its dates and its recurrence.
              const htmlBox = (props as { "data-html-box"?: string })["data-html-box"];
              const toggle = htmlBox === undefined ? onToggleTask : onToggleHtmlBox;
              const ordinalOf = (el: HTMLInputElement) => (htmlBox === undefined ? taskCheckboxOrdinal(el) : Number(htmlBox));
              return (
                <input
                  {...props}
                  // remark-gfm renders task checkboxes disabled; with a toggle
                  // handler they become the real thing and write [x] back.
                  disabled={!toggle}
                  onChange={toggle ? (e) => toggle(ordinalOf(e.currentTarget), e.currentTarget.checked) : undefined}
                  style={{ marginRight: '0.5em', verticalAlign: 'middle', accentColor: 'var(--accent-color)', cursor: toggle ? 'pointer' : undefined }}
                />
              );
            }
            return <input style={{ marginRight: '0.5em', verticalAlign: 'middle', accentColor: 'var(--accent-color)' }} {...props} />;
          },
          blockquote: ({ node, children, ...props }: any) => {
            // .trim() first: the hast blockquote text starts with a "\n"
            // (whitespace before the inner paragraph), which previously made the
            // first line empty so callouts never rendered in read mode.
            const firstLine = hastText(node).trim().split("\n")[0] || "";
            const parsed = parseCalloutMarker(firstLine);
            if (parsed) {
              const color = calloutColor(parsed.type);
              const colorKey = calloutColorKey(parsed.type);
              // ONE card, the same in both modes (finding 2026-09-19): a fine
              // line in the callout's colour, its tint, no bar. The live
              // editor builds the same silhouette from its lines.
              return (
                <div {...props} className="pv-reader-callout" style={{ border: `1px solid ${calloutLine(colorKey)}`, background: calloutTint(colorKey), borderRadius: "var(--radius-md)", padding: "0.5em 0.8em", margin: "0.8em 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4em", fontWeight: 600, color, marginBottom: "0.3em" }}>
                    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" style={{ flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: calloutIconPath(parsed.type) }} />
                    <span style={parsed.title ? undefined : { textTransform: "capitalize" }}>{parsed.title || parsed.type}</span>
                  </div>
                  <div style={{ color: "var(--text-main)" }}>{stripCalloutHeader(children)}</div>
                </div>
              );
            }
            return <blockquote {...props} style={{ borderLeft: '4px solid var(--quote-border)', margin: '0.6em 0', paddingLeft: '16px', color: 'var(--text-muted)' }}>{children}</blockquote>;
          },
          // A wide table scrolls inside its own box; the page never scrolls
          // sideways (feedback round 2026-09-01, T2 — same rule as the editor).
          table: ({ node: _node, ...props }) => (
            <div className="pv-reader-table-wrap">
              <table style={{ borderCollapse: 'collapse', width: 'auto' }} {...props} />
            </div>
          ),
          thead: ({ node: _node, ...props }) => <thead style={{ background: 'var(--bg-secondary)' }} {...props} />,
          // A commented cell carries the frame class from applyReadAnchors (C28)
          // and opens its comment on click.
          th: ({ node, ...props }) => { const id = (node as { properties?: { dataCommentId?: unknown } } | undefined)?.properties?.dataCommentId; return <th style={{ border: '1px solid var(--border-color)', padding: 'var(--pad-cell)', minWidth: '90px', lineHeight: 1.6, textAlign: 'left', verticalAlign: 'top', color: 'var(--text-main)' }} onClick={typeof id === 'string' ? () => onActivateAnchor?.(id) : undefined} {...props} />; },
          td: ({ node, ...props }) => { const id = (node as { properties?: { dataCommentId?: unknown } } | undefined)?.properties?.dataCommentId; return <td style={{ border: '1px solid var(--border-color)', padding: 'var(--pad-cell)', minWidth: '90px', lineHeight: 1.6, verticalAlign: 'top', color: 'var(--text-main)' }} onClick={typeof id === 'string' ? () => onActivateAnchor?.(id) : undefined} {...props} />; },
          code: ({ node: _node, className, children, ...props }) => {
            const text = Array.isArray(children) ? children.join("") : String(children ?? "");
            const isBlock = !!className || text.includes("\n");
            if (isBlock) {
              const lang = className?.match(/language-([\w-]+)/)?.[1];
              // ```mermaid renders as a diagram (P3.5); the mermaid bundle
              // loads lazily inside the component.
              if (lang === "mermaid") {
                return <MermaidDiagram code={text.replace(/\n$/, "")} />;
              }
              return <CodeBlock code={text.replace(/\n$/, "")} lang={lang} />;
            }
            return <code style={{
              background: 'var(--code-bg)',
              padding: '2px 4px',
              borderRadius: "var(--radius-xs)",
              fontFamily: 'monospace',
              fontSize: '0.9em',
              color: 'var(--text-main)',
            }} {...props}>{children}</code>;
          },
          // The CodeBlock component renders its own <pre>; unwrap react-markdown's.
          pre: ({ node, children }) => <div data-source-from={node?.properties.dataSourceFrom} data-source-to={node?.properties.dataSourceTo} data-source-line={node?.properties.dataSourceLine}>{children}</div>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
