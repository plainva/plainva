import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DocIcon, ICON, noteDisplayName } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import { useDocumentIcons } from "../hooks/useDocumentIcons";

interface Props {
  /** Debounced sidebar filter; matched against the path, like the other tabs. */
  query: string;
  activePath: string | null;
  onOpen: (path: string) => void;
}

/**
 * Databases sidebar tab (parity with the mobile Databases hub): every `.base`
 * in the vault grouped by its containing folder; clicking opens it. Titles come
 * from the index (listBases), icons from the shared document-icon hook (a custom
 * `plainva.icon` or the default database icon). Re-queries on every index bump.
 */
export function DatabasesList({ query, activePath, onOpen }: Props) {
  const { t } = useTranslation();
  const { queryService, fileTreeVersion, vaultPath } = useVault();
  const docIcons = useDocumentIcons();
  const [bases, setBases] = useState<Array<{ path: string; title: string }>>([]);

  useEffect(() => {
    let alive = true;
    if (!queryService) {
      setBases([]);
      return;
    }
    queryService
      .listBases()
      .then((rows) => {
        if (alive) setBases(rows);
      })
      .catch(() => {
        if (alive) setBases([]);
      });
    return () => {
      alive = false;
    };
  }, [queryService, fileTreeVersion, vaultPath]);

  const q = query.toLowerCase();
  const filtered = bases.filter((b) => b.path.toLowerCase().includes(q));

  if (filtered.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", padding: "1rem", textAlign: "center", fontSize: "var(--text-md)" }}>
        {t("sidebar.noDatabases", { defaultValue: "Keine Datenbanken" })}
      </div>
    );
  }

  // Group by containing folder (mobile hub parity): vault root first, then A-Z.
  const groups = new Map<string, Array<{ path: string; title: string }>>();
  for (const b of filtered) {
    const i = b.path.lastIndexOf("/");
    const folder = i < 0 ? "" : b.path.slice(0, i);
    const arr = groups.get(folder);
    if (arr) arr.push(b);
    else groups.set(folder, [b]);
  }
  const folders = [...groups.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

  return (
    <>
      {folders.map((folder) => (
        <div key={folder || "__root__"}>
          <div
            style={{
              fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.5px",
              color: "var(--text-muted)", padding: "0.5rem 0.5rem 0.15rem",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
            data-tip={folder}
          >
            {folder || t("mobile.vaultRoot", { defaultValue: "Vault" })}
          </div>
          {groups.get(folder)!.map((b) => {
            const iconEntry = docIcons.get(b.path);
            return (
              <button
                key={b.path}
                onClick={() => onOpen(b.path)}
                data-tip={b.path}
                style={{
                  width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 6,
                  padding: "0.5rem", border: "none", cursor: "pointer", borderRadius: "var(--radius-xs)",
                  background: activePath === b.path ? "var(--bg-hover)" : "transparent",
                  color: "var(--text-main)",
                }}
              >
                <span aria-hidden="true" style={{ width: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <DocIcon icon={iconEntry?.icon ?? "lucide:database"} color={iconEntry?.color} size={ICON.ui} />
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{noteDisplayName(b.title)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
