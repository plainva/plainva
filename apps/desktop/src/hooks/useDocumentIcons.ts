import { useEffect, useState } from "react";
import { useVault } from "../contexts/VaultContext";
import { parseBaseConfig } from "../services/baseFormat";

export interface DocIconEntry {
  icon: string;
  color?: string;
}

/** Icon every `.base` shows in the file tree and the tab strips (Base-UX2 P7). */
export const BASE_DOC_ICON = "lucide:database";

const EMPTY: Map<string, DocIconEntry> = new Map();

/**
 * Path -> document icon map, refreshed whenever the index changes
 * (fileTreeVersion bumps on every save/re-index). Used by the tab strips and
 * the file tree. Two sources:
 *  - `.md`: the `plainva.icon`/`.icon_color` frontmatter (via the SQLite index),
 *  - `.base`: always the database icon, tinted by `views[i].plainva.fileIconColor`
 *    (P7). The handful of `.base` files per vault makes re-reading them on
 *    index bumps cheap.
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
    (async () => {
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
      if (alive) setIcons(map);
    })();
    return () => {
      alive = false;
    };
  }, [queryService, vaultAdapter, fileTreeVersion, vaultPath]);

  return icons;
}
