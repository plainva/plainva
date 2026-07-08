import { useEffect, useState } from "react";
import { useVault } from "../contexts/VaultContext";
import { parseBaseConfig } from "../services/baseFormat";
import type { VaultQueryService, IVaultAdapter } from "@plainva/core";

export interface DocIconEntry {
  icon: string;
  color?: string;
}

/** Icon every `.base` shows in the file tree and the tab strips (Base-UX2 P7). */
export const BASE_DOC_ICON = "lucide:database";

const EMPTY: Map<string, DocIconEntry> = new Map();

// Shared load cache. useDocumentIcons is mounted by 3-4 components at once
// (Editor, FileTree, tab strips, TitleBar); without this each instance would
// run getDocumentIcons() AND re-read every `.base` from disk on every index
// bump — 3-4x the work. Keyed by (vaultPath, fileTreeVersion) + queryService
// identity so a reopened vault (fresh service, version reset to 0) recomputes.
let cacheKey = "";
let cacheService: unknown = null;
let cachePromise: Promise<Map<string, DocIconEntry>> | null = null;

function loadDocumentIcons(
  queryService: VaultQueryService,
  vaultAdapter: IVaultAdapter | null,
  vaultPath: string | null,
  version: number
): Promise<Map<string, DocIconEntry>> {
  const key = `${vaultPath ?? ""}::${version}`;
  if (key === cacheKey && cacheService === queryService && cachePromise) return cachePromise;
  cacheKey = key;
  cacheService = queryService;
  cachePromise = (async () => {
    let map: Map<string, DocIconEntry>;
    try {
      map = new Map(await queryService.getDocumentIcons());
    } catch (e) {
      console.warn("[useDocumentIcons] loading icons failed", e);
      map = new Map();
    }
    if (vaultAdapter) {
      try {
        const basePaths = await queryService.listBaseFilePaths();
        await Promise.all(
          basePaths.map(async (p) => {
            let color: string | undefined;
            try {
              const cfg = parseBaseConfig(await vaultAdapter.readTextFile(p));
              if (typeof cfg.iconColor === "string") color = cfg.iconColor;
            } catch {
              /* unreadable/invalid .base — untinted database icon */
            }
            map.set(p, { icon: BASE_DOC_ICON, color });
          })
        );
      } catch (e) {
        console.warn("[useDocumentIcons] loading base icons failed", e);
      }
    }
    return map;
  })();
  return cachePromise;
}

/**
 * Path -> document icon map, refreshed whenever the index changes
 * (fileTreeVersion bumps when tree-relevant metadata changes). Used by the tab
 * strips and the file tree. Two sources:
 *  - `.md`: the `plainva.icon`/`.icon_color` frontmatter (via the SQLite index),
 *  - `.base`: always the database icon, tinted by `views[i].plainva.fileIconColor`
 *    (P7).
 *
 * All concurrent instances share ONE load per (vault, index version) via the
 * module cache above, so the `.base` disk reads happen once per bump.
 */
export function useDocumentIcons(): Map<string, DocIconEntry> {
  const { queryService, vaultAdapter, fileTreeVersion, vaultPath } = useVault();
  const [icons, setIcons] = useState<Map<string, DocIconEntry>>(EMPTY);

  useEffect(() => {
    let alive = true;
    if (!queryService) {
      setIcons(EMPTY);
      return;
    }
    loadDocumentIcons(queryService, vaultAdapter, vaultPath, fileTreeVersion)
      .then((map) => {
        if (alive) setIcons(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [queryService, vaultAdapter, fileTreeVersion, vaultPath]);

  return icons;
}
