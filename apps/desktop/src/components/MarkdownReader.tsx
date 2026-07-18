import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { resolveVaultRelative } from '@plainva/ui';
import { loadImageBlob } from '@plainva/ui';
import { toast } from '@plainva/ui';
import { isWikiTargetResolved } from '@plainva/ui';
import { useWikiResolver } from '../hooks/useWikiResolver';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Folder, FileText } from 'lucide-react';
import { useVault } from '../contexts/VaultContext';
import { calloutColor, calloutColorKey, calloutTint, calloutIconPath, parseCalloutMarker } from '@plainva/ui';
import { slugify } from '../services/outline';
import { CodeBlock } from './CodeBlock';
import { MermaidDiagram } from './MermaidDiagram';
import { BaseViewer } from './BaseViewer';
import { formatRelativeDate, DATE_TOKEN_RE } from '@plainva/ui';
import { remarkStripHtmlComments, remarkBrToBreak, remarkStripHighlightMarks, resolveRelativeTarget, encodeWikiTarget, type RelativeTarget } from './markdownReaderModel';
import { DocIcon, isRenderableDocIcon } from '@plainva/ui';
import type { DocIconEntry } from '../hooks/useDocumentIcons';

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
}

/**
 * Vault image in read mode, loaded as a BLOB URL through the adapter (P5.11)
 * — the asset protocol (and its filesystem-wide scope) is disabled. The URL
 * is revoked on unmount/path change.
 */
const VaultImage: React.FC<{ path: string; alt: string }> = ({ path, alt }) => {
  const { vaultAdapter } = useVault();
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!vaultAdapter) return;
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    void loadImageBlob(vaultAdapter, path)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [vaultAdapter, path]);

  if (failed) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{alt || path}</span>;
  if (!url) return <span aria-hidden="true" />;
  return <img src={url} alt={alt} style={{ maxWidth: '100%', borderRadius: 'var(--radius-xs)' }} />;
};

const EmbeddedNote: React.FC<{ target: string; depth: number; onOpenPath?: (path: string, newTab: boolean) => void; hostPath?: string }> = ({ target, depth, onOpenPath, hostPath }) => {
  const { vaultAdapter, vaultPath, queryService, fileTreeVersion } = useVault();
  const { t } = useTranslation();
  const [content, setContent] = React.useState<string | null>(null);
  const [targetPath, setTargetPath] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // A `.base` target renders as an embedded database viewer; everything else is
  // read as markdown and transcluded. Previously read-mode base embeds fell
  // through to the markdown branch and showed the raw .base YAML (#1).
  const isBase = target.split("#")[0].trim().toLowerCase().endsWith(".base");

  React.useEffect(() => {
    if (!queryService || !vaultPath || !vaultAdapter) return;
    const searchTarget = target.trim().split("#")[0];

    const sql = `
      SELECT path FROM files
      WHERE title = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
      LIMIT 1
    `;
    queryService.db.query(sql, [searchTarget, searchTarget, searchTarget + ".md"])
      .then(rows => {
        if (rows && rows.length > 0) {
          const relativePath = rows[0].path;
          setTargetPath(relativePath);
          // A base is rendered by BaseViewer from its path; no markdown read.
          if (relativePath.toLowerCase().endsWith(".base")) return;
          vaultAdapter.readTextFile(relativePath)
            .then(setContent)
            .catch(e => setError(String(e)));
        } else {
          setError(t("editor.fileNotFound", { defaultValue: "Datei nicht gefunden" }));
        }
      })
      .catch(e => setError(String(e)));
  }, [target, queryService, vaultPath, vaultAdapter, fileTreeVersion, t]);

  const loading = <div style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>{t("editor.loading", { defaultValue: "Laden..." })}</div>;

  if (error) return <div style={{ color: 'var(--error-text)', padding: '0.5rem', borderLeft: '2px solid var(--error-text)', margin: '1rem 0' }}>{error}</div>;

  if (isBase) {
    if (!targetPath) return loading;
    return (
      <div className="embedded-note embedded-note--base">
        <BaseViewer activePath={targetPath} onOpenPath={onOpenPath} embedded hostPath={hostPath} />
      </div>
    );
  }

  if (content === null) return loading;

  return (
    <div className="embedded-note">
      <MarkdownReader content={content} onOpenPath={onOpenPath} embedDepth={depth + 1} sourcePath={targetPath ?? undefined} />
    </div>
  );
};

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
    if (Array.isArray(node)) return node.map((c, i) => <React.Fragment key={i}>{walk(c)}</React.Fragment>);
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
  for (const el of root.querySelectorAll('input[type="checkbox"]')) {
    if (el === box) return ord;
    if (el.closest(".markdown-reader") === root) ord++;
  }
  return ord;
}

export const MarkdownReader: React.FC<MarkdownReaderProps> = ({ content, onOpenPath, embedDepth = 0, fullWidth = false, sourcePath, docIcons, showLinkIcons = false, onToggleTask }) => {
  const { vaultAdapter, queryService } = useVault();
  const { t, i18n } = useTranslation();
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
    if (target.kind === "folder") {
      const indexPath = target.path ? `${target.path}/index.md` : "index.md";
      try {
        if (vaultAdapter && await vaultAdapter.exists(indexPath)) {
          onOpenPath?.(indexPath, newTab);
          return;
        }
      } catch { /* fall through to reveal */ }
      window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: target.path } }));
      return;
    }
    try {
      if (vaultAdapter && await vaultAdapter.exists(target.path)) {
        onOpenPath?.(target.path, newTab);
        return;
      }
    } catch { /* treated as not found */ }
    toast.warning(t("dialogs.linkNotFoundMsg", { target: target.path }));
  };

  const linkIconFor = (target: RelativeTarget): React.ReactNode => {
    if (!showLinkIcons) return null;
    if (target.kind === "folder") return <Folder size={14} style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true" />;
    const entry = docIcons?.get(target.path);
    if (entry && isRenderableDocIcon(entry.icon)) {
      return (
        <span aria-hidden="true" style={{ display: "inline-flex", width: 16, justifyContent: "center", flexShrink: 0 }}>
          <DocIcon icon={entry.icon} color={entry.color} size={14} />
        </span>
      );
    }
    return <FileText size={14} style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true" />;
  };



  const handleWikiLinkClick = async (target: string, newTab: boolean) => {
    if (!queryService || !onOpenPath) return;

    let searchTarget = target.trim();
    searchTarget = searchTarget.split("#")[0];

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
    } else {
      // Not created yet — create the note (Obsidian parity, maintainer 2026-07-18).
      window.dispatchEvent(new CustomEvent("plainva-create-note-from-link", { detail: { target: searchTarget, hostPath: sourcePath, newTab } }));
    }
  };

  // Preprocess content: convert [[link]] to [link](wiki://link) and ![[img]] to
  // ![img](wiki-image://img). (==highlight== markers are stripped AST-side by
  // remarkStripHighlightMarks so they never render — or get copied — literally.)
  const processedContent = useMemo(() => {
    if (embedDepth > 2) return content;
    let result = content;
    
    // Strip frontmatter
    if (result.startsWith("---")) {
      const parts = result.split("\n");
      let endLine = -1;
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].trim() === "---") {
          endLine = i;
          break;
        }
      }
      if (endLine > 0) {
        result = parts.slice(endLine + 1).join("\n");
      }
    }

    // Replace images ![[...]] — encodeWikiTarget (not bare encodeURIComponent):
    // a raw paren in the target breaks the generated markdown destination.
    result = result.replace(/!\[\[(.*?)\]\]/g, (_match, p1) => {
      const isImg = p1.match(/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i);
      if (isImg) {
        return `![img](wiki-image://${encodeWikiTarget(p1)})`;
      } else {
        return `![embed](wiki-embed://${encodeWikiTarget(p1)})`;
      }
    });
    // Replace links [[...]]
    result = result.replace(/\[\[(.*?)\]\]/g, (_match, p1) => {
      let target = p1;
      let display = p1;
      if (p1.includes("|")) {
        const parts = p1.split("|");
        target = parts[0];
        display = parts[1];
      }
      target = target.split("#")[0]; // ignore headers for the file path
      return `[${display}](wiki://${encodeWikiTarget(target)})`;
    });
    // Dynamic date tokens @YYYY-MM-DD -> relative word (Heute/Morgen/… or date).
    const locale = (i18n.language || "de").slice(0, 2);
    result = result.replace(DATE_TOKEN_RE, (_m, y, mo, d) => formatRelativeDate(`${y}-${mo}-${d}`, new Date(), locale));
    return result;
  }, [content, embedDepth, i18n.language]);

  if (embedDepth > 2) return <div style={{ color: 'var(--text-muted)', padding: '0.5rem' }}>Max embed depth reached</div>;

  return (
    <div className="markdown-reader" style={{ padding: '2rem', maxWidth: fullWidth ? 'none' : '800px', margin: '0 auto', fontSize: 'var(--content-font-size, 16px)', lineHeight: '1.6', color: 'var(--text-main)', fontFamily: 'var(--font-content)' }}>
      <ReactMarkdown
        remarkPlugins={mathPlugins
          ? [remarkGfm, remarkBreaks, remarkStripHtmlComments, remarkBrToBreak, remarkStripHighlightMarks, mathPlugins.remark as never]
          : [remarkGfm, remarkBreaks, remarkStripHtmlComments, remarkBrToBreak, remarkStripHighlightMarks]}
        rehypePlugins={mathPlugins ? [mathPlugins.rehype as never] : undefined}
        urlTransform={(url) => url}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            if (href?.startsWith('wiki://')) {
              const target = decodeURIComponent(href.replace('wiki://', ''));
              const unresolved = !isWikiTargetResolved(target, wikiResolver);
              return (
                <a
                  href="#"
                  className={unresolved ? 'is-unresolved' : undefined}
                  title={unresolved ? t('editor.unresolvedLinkTip', "Note doesn't exist yet — click to create") : undefined}
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
          img: ({ node: _node, src, alt, ...props }) => {
            if (src?.startsWith('wiki-embed://')) {
              const target = decodeURIComponent(src.replace('wiki-embed://', ''));
              return <EmbeddedNote target={target} depth={embedDepth} onOpenPath={onOpenPath} hostPath={sourcePath} />;
            }
            if (src?.startsWith('wiki-image://')) {
              const target = decodeURIComponent(src.replace('wiki-image://', ''));
              // Embed targets come from note content (possibly synced/foreign):
              // resolve them lexically and refuse anything that is absolute or
              // escapes the vault. Loading goes through a BLOB URL (P5.11) —
              // the filesystem-wide asset protocol is disabled entirely.
              const rel = resolveVaultRelative(target);
              if (!rel) {
                return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{alt || target}</span>;
              }
              return <VaultImage path={rel} alt={alt || target} />;
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
              return <VaultImage path={rel} alt={alt || rel} />;
            }
            return <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: "var(--radius-xs)" }} {...props} />;
          },
          h1: ({ node, ...props }) => <h1 id={slugify(hastText(node))} style={{ fontSize: '2em', marginTop: '0.67em', marginBottom: '0.4em', color: 'var(--text-main)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.2em' }} {...props} />,
          h2: ({ node, ...props }) => <h2 id={slugify(hastText(node))} style={{ fontSize: '1.5em', marginTop: '0.83em', marginBottom: '0.4em', color: 'var(--text-main)', borderBottom: '1px solid var(--border-color-light)', paddingBottom: '0.2em' }} {...props} />,
          h3: ({ node, ...props }) => <h3 id={slugify(hastText(node))} style={{ fontSize: '1.17em', marginTop: '1em', marginBottom: '0.4em', color: 'var(--text-main)' }} {...props} />,
          h4: ({ node, ...props }) => <h4 id={slugify(hastText(node))} style={{ fontSize: '1em', marginTop: '1.1em', marginBottom: '0.4em', color: 'var(--text-main)' }} {...props} />,
          h5: ({ node, ...props }) => <h5 id={slugify(hastText(node))} style={{ fontSize: '0.9em', marginTop: '1.2em', marginBottom: '0.4em', color: 'var(--text-muted)' }} {...props} />,
          h6: ({ node, ...props }) => <h6 id={slugify(hastText(node))} style={{ fontSize: '0.85em', marginTop: '1.2em', marginBottom: '0.4em', color: 'var(--text-muted)' }} {...props} />,
          p: ({ node: _node, ...props }) => <p style={{ margin: '0.6em 0', color: 'var(--text-main)' }} {...props} />,
          hr: ({ node: _node, ...props }) => <hr style={{ border: 'none', borderTop: '2px solid var(--border-color)', margin: '1.5em 0' }} {...props} />,
          ul: ({ node: _node, ...props }) => <ul style={{ paddingLeft: '1.5em', margin: '0.5em 0' }} {...props} />,
          ol: ({ node: _node, ...props }) => <ol style={{ paddingLeft: '1.5em', margin: '0.5em 0' }} {...props} />,
          li: ({ node: _node, className, ...props }) => (
            <li
              className={className}
              style={className?.includes('task-list-item') ? { listStyleType: 'none', marginLeft: '-1.2em' } : undefined}
              {...props}
            />
          ),
          input: ({ node: _node, ...props }) => {
            if (props.type === "checkbox") {
              const toggle = onToggleTask;
              return (
                <input
                  {...props}
                  // remark-gfm renders task checkboxes disabled; with a toggle
                  // handler they become the real thing and write [x] back.
                  disabled={!toggle}
                  onChange={toggle ? (e) => toggle(taskCheckboxOrdinal(e.currentTarget), e.currentTarget.checked) : undefined}
                  style={{ marginRight: '0.5em', verticalAlign: 'middle', accentColor: 'var(--accent-color)', cursor: toggle ? 'pointer' : undefined }}
                />
              );
            }
            return <input style={{ marginRight: '0.5em', verticalAlign: 'middle', accentColor: 'var(--accent-color)' }} {...props} />;
          },
          blockquote: ({ node, children }: any) => {
            // .trim() first: the hast blockquote text starts with a "\n"
            // (whitespace before the inner paragraph), which previously made the
            // first line empty so callouts never rendered in read mode.
            const firstLine = hastText(node).trim().split("\n")[0] || "";
            const parsed = parseCalloutMarker(firstLine);
            if (parsed) {
              const color = calloutColor(parsed.type);
              return (
                <div style={{ borderLeft: `4px solid ${color}`, background: calloutTint(calloutColorKey(parsed.type)), borderRadius: "var(--radius-sm)", padding: "0.6em 1em", margin: "0.8em 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4em", fontWeight: 600, color, marginBottom: "0.3em" }}>
                    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" style={{ flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: calloutIconPath(parsed.type) }} />
                    <span style={parsed.title ? undefined : { textTransform: "capitalize" }}>{parsed.title || parsed.type}</span>
                  </div>
                  <div style={{ color: "var(--text-main)" }}>{stripCalloutHeader(children)}</div>
                </div>
              );
            }
            return <blockquote style={{ borderLeft: '4px solid var(--quote-border)', margin: '0.6em 0', paddingLeft: '16px', color: 'var(--text-muted)' }}>{children}</blockquote>;
          },
          table: ({ node: _node, ...props }) => <table style={{ borderCollapse: 'collapse', width: 'auto', margin: '0.8em 0' }} {...props} />,
          thead: ({ node: _node, ...props }) => <thead style={{ background: 'var(--bg-secondary)' }} {...props} />,
          th: ({ node: _node, ...props }) => <th style={{ border: '1px solid var(--border-color)', padding: 'var(--pad-cell)', minWidth: '90px', lineHeight: 1.6, textAlign: 'left', verticalAlign: 'top', color: 'var(--text-main)' }} {...props} />,
          td: ({ node: _node, ...props }) => <td style={{ border: '1px solid var(--border-color)', padding: 'var(--pad-cell)', minWidth: '90px', lineHeight: 1.6, verticalAlign: 'top', color: 'var(--text-main)' }} {...props} />,
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
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
