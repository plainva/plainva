import React from 'react';
import { createRoot } from 'react-dom/client';
import { buildNoteEmbedCoreExtension } from '@plainva/ui';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { VaultContext } from '../contexts/VaultContext';
import { MarkdownReader } from './MarkdownReader';
import { BaseViewer } from './BaseViewer';

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

/**
 * The desktop `![[...]]` live embed, on the shared core (C12/S20).
 *
 * The CodeMirror mechanics — line scanning, the caret-aware syntax reveal, the
 * widget lifecycle, skipping images so their own plugin keeps them — used to
 * exist twice, once here and once in `buildNoteEmbedCoreExtension`, which was
 * written from this file and then had no caller at all. What is genuinely
 * desktop-specific is only the preview itself: a React root that can reach the
 * vault context, i18n, and the `.base` viewer. So that is all that is left
 * here; everything else comes from the core.
 */
export function noteEmbedPlugin(contextProps: any, hideSyntax: boolean) {
  return buildNoteEmbedCoreExtension(
    {
      render(container, target) {
        const root = createRoot(container);
        root.render(
          <I18nextProvider i18n={contextProps.i18n}>
            <VaultContext.Provider value={contextProps.vaultContext}>
              <EmbeddedNoteLoader
                target={target}
                onOpenPath={contextProps.onOpenPath}
                hostPath={contextProps.hostPath}
              />
            </VaultContext.Provider>
          </I18nextProvider>
        );
        return () => root.unmount();
      },
    },
    hideSyntax
  );
}
