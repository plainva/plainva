import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Database } from "lucide-react";
import { EmptyState } from "@plainva/ui";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { type MobileVault } from "../services/vaultService";

/**
 * Databases hub (R2.4, answers "what should More → Databases do"): every
 * .base in the vault, grouped by folder; tapping opens the database view.
 */
export function DatabasesScreen({
  vault,
  bump,
  onBack,
  onOpenBase,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenBase: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [bases, setBases] = useState<Array<{ path: string; title: string }>>([]);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  useEffect(() => {
    let stale = false;
    if (!vault.queryService) return;
    void vault.queryService.listBases().then((rows) => {
      if (!stale) setBases(rows);
    });
    return () => {
      stale = true;
    };
  }, [vault, bump]);

  // Group by containing folder; the vault root sorts first.
  const groups = new Map<string, Array<{ path: string; title: string }>>();
  for (const b of bases) {
    const folder = b.path.includes("/") ? b.path.slice(0, b.path.lastIndexOf("/")) : "";
    const list = groups.get(folder) ?? [];
    list.push(b);
    groups.set(folder, list);
  }
  const folders = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{t("mobile.tabDatabases")}</h1>
        </header>
      )}
      {bases.length === 0 ? (
        <EmptyState icon={<Database size={20} />}>{t("mobile.databasesEmpty")}</EmptyState>
      ) : (
        folders.map((folder) => (
          <div key={folder || "/"}>
            <p className="m-sectionlabel">{folder || t("mobile.vaultRoot")}</p>
            {groups.get(folder)!.map((b) => (
              <button className="m-row" key={b.path} onClick={() => onOpenBase(b.path)}>
                <Database className="m-accent" size={18} />
                <span>{b.title}</span>
                <ChevronRight className="m-chevron" size={18} />
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
