import { useEffect, useState } from "react";
import { useVault } from "../contexts/VaultContext";
import type { IndexReading } from "@plainva/core";

export interface DocTitleEntry {
  /** Frontmatter `title` or, by default, the file name (may still carry an
   *  extension — the caller strips it via stripNoteExtension, like the tree). */
  title: string;
  /** Index mode; an "attachment" keeps its extension in the UI. */
  mode: string;
}

const EMPTY: Map<string, DocTitleEntry> = new Map();

// Shared load cache, mirroring useDocumentIcons: keyed by (vaultPath,
// fileTreeVersion) + indexView identity so a reopened vault (fresh service,
// version reset to 0) recomputes and concurrent consumers share ONE query per
// index bump.
let cacheKey = "";
let cacheService: unknown = null;
let cachePromise: Promise<Map<string, DocTitleEntry>> | null = null;

function loadDocumentTitles(
  indexView: IndexReading,
  vaultPath: string | null,
  version: number
): Promise<Map<string, DocTitleEntry>> {
  const key = `${vaultPath ?? ""}::${version}`;
  if (key === cacheKey && cacheService === indexView && cachePromise) return cachePromise;
  cacheKey = key;
  cacheService = indexView;
  cachePromise = (async () => {
    try {
      return await indexView.getDocumentTitles();
    } catch (e) {
      console.warn("[useDocumentTitles] loading titles failed", e);
      return new Map<string, DocTitleEntry>();
    }
  })();
  return cachePromise;
}

/**
 * Path -> { title, mode } map from the index, refreshed whenever the index
 * changes (fileTreeVersion bumps on tree-relevant metadata changes). The
 * bookmarks list uses it to show the same display name as the file tree — a
 * bookmark only stores the path, not the frontmatter title. All concurrent
 * instances share ONE query per (vault, index version) via the module cache.
 */
export function useDocumentTitles(): Map<string, DocTitleEntry> {
  const { indexView, fileTreeVersion, vaultPath } = useVault();
  const [titles, setTitles] = useState<Map<string, DocTitleEntry>>(EMPTY);

  useEffect(() => {
    let alive = true;
    if (!indexView) {
      setTitles(EMPTY);
      return;
    }
    loadDocumentTitles(indexView, vaultPath, fileTreeVersion)
      .then((map) => {
        if (alive) setTitles(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [indexView, fileTreeVersion, vaultPath]);

  return titles;
}
