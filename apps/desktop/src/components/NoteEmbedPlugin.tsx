import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { VaultContext } from '../contexts/VaultContext';
import { MarkdownReader } from './MarkdownReader';
import { BaseViewer } from './BaseViewer';

class NoteWidget extends WidgetType {
  private root: Root | null = null;
  
  constructor(
    readonly target: string,
    readonly contextProps: any
  ) { super(); }

  eq(other: NoteWidget) {
    return this.target === other.target;
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'cm-note-embed';
    
    this.root = createRoot(container);
    this.root.render(
      <I18nextProvider i18n={this.contextProps.i18n}>
        <VaultContext.Provider value={this.contextProps.vaultContext}>
          {/* Using a lightweight internal component similar to EmbeddedNote, but tailored to CodeMirror */}
          <EmbeddedNoteLoader target={this.target} onOpenPath={this.contextProps.onOpenPath} hostPath={this.contextProps.hostPath} />
        </VaultContext.Provider>
      </I18nextProvider>
    );
    
    return container;
  }

  destroy(_dom: HTMLElement) {
    if (this.root) {
      this.root.unmount();
    }
  }
}

// We need to implement EmbeddedNoteLoader since we can't easily import the internal EmbeddedNote from MarkdownReader.tsx
const EmbeddedNoteLoader: React.FC<{ target: string, onOpenPath?: (path: string, newTab: boolean) => void, hostPath?: string }> = ({ target, onOpenPath, hostPath }) => {
  const vaultContext = React.useContext(VaultContext);
  const vaultAdapter = vaultContext?.vaultAdapter;
  const vaultPath = vaultContext?.vaultPath;
  const fileTreeVersion = vaultContext?.fileTreeVersion;
  const queryService = vaultContext?.queryService;
  const { t } = useTranslation();
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [targetPath, setTargetPath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!queryService || !vaultPath || !vaultAdapter) return;
    let searchTarget = target.trim().split('#')[0];
    
    const sql = `
      SELECT path FROM files
      WHERE title = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
         OR path = ? COLLATE NOCASE
      LIMIT 1
    `;
    queryService.db.query(sql, [searchTarget, searchTarget, searchTarget + '.md'])
      .then((rows: any) => {
        if (rows && rows.length > 0) {
          const relativePath = rows[0].path;
          setTargetPath(relativePath);
          vaultAdapter.readTextFile(relativePath)
            .then((text: string) => setContent(text))
            .catch((e: any) => setError(String(e)));
        } else {
          setError(t('editor.fileNotFound', { defaultValue: 'Datei nicht gefunden' }) + ': ' + target);
        }
      })
      .catch((e: any) => setError(String(e)));
  }, [target, queryService, vaultPath, vaultAdapter, fileTreeVersion, t]);

  if (error) return <div style={{ color: 'var(--error-text)', padding: '0.5rem', borderLeft: '2px solid var(--error-text)', margin: '1rem 0' }}>{error}</div>;
  if (content === null) return <div style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>{t('editor.loading', { defaultValue: 'Laden...' })}</div>;

  const isBaseFile = targetPath && targetPath.toLowerCase().endsWith('.base');

  return (
    <div className={isBaseFile ? "embedded-note embedded-note--base" : "embedded-note"}>
      {isBaseFile ? (
        <BaseViewer activePath={targetPath} onOpenPath={onOpenPath} embedded hostPath={hostPath} />
      ) : (
        <MarkdownReader content={content} onOpenPath={onOpenPath} embedDepth={1} />
      )}
    </div>
  );
};

export function noteEmbedPlugin(contextProps: any, hideSyntax: boolean) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      let needsRebuild = update.docChanged || update.viewportChanged;
      if (!needsRebuild && update.selectionSet) {
        const oldRanges = update.startState.selection.ranges;
        const newRanges = update.state.selection.ranges;
        if (oldRanges.length !== newRanges.length) {
          needsRebuild = true;
        } else {
          for (let i = 0; i < newRanges.length; i++) {
            const oldLine = update.startState.doc.lineAt(oldRanges[i].head).number;
            const newLine = update.state.doc.lineAt(newRanges[i].head).number;
            if (oldLine !== newLine) {
              needsRebuild = true;
              break;
            }
          }
        }
      }
      if (needsRebuild) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const selectionLines = new Set<number>();
      
      for (const range of view.state.selection.ranges) {
        const line = view.state.doc.lineAt(range.head).number;
        selectionLines.add(line);
      }

      for (let { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos < to) {
          const line = view.state.doc.lineAt(pos);
          const isLineSelected = selectionLines.has(line.number);
          
          const regex = /!\[\[(.*?)\]\]/g;
          let match;
          while ((match = regex.exec(line.text)) !== null) {
            const target = match[1];
            // Skip images
            const isImg = target.match(/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i);
            if (isImg) continue;

            const matchFrom = line.from + match.index;
            const matchTo = matchFrom + match[0].length;
            
            if (hideSyntax && !isLineSelected) {
              builder.add(matchFrom, matchTo, Decoration.replace({
                widget: new NoteWidget(target, contextProps)
              }));
            } else {
              builder.add(matchTo, matchTo, Decoration.widget({
                widget: new NoteWidget(target, contextProps),
                side: 1
              }));
            }
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  }, {
    decorations: v => v.decorations
  });
}
