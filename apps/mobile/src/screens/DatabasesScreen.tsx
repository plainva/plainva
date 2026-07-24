import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Database, Plus, Trash2 } from "lucide-react";
import { EmptyState, noteDisplayName } from "@plainva/ui";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { useLongPress } from "../lib/useLongPress";
import { RowActionSheet } from "../components/RowActionSheet";
import { confirmDeleteFile } from "../lib/deleteFile";
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
  onCreate,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenBase: (path: string) => void;
  /** Opens the shared new-database flow (R2.4: creation lives in the hub too). */
  onCreate?: () => void;
}) {
  const { t } = useTranslation();
  const [bases, setBases] = useState<Array<{ path: string; title: string }>>([]);
  const [sheet, setSheet] = useState<{ path: string; title: string } | null>(null);
  const rowPress = useLongPress<{ path: string; title: string }>((x) => setSheet(x));
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
          <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
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
              <button
                className="m-row"
                key={b.path}
                onClick={() => { if (rowPress.clicked()) onOpenBase(b.path); }}
                onContextMenu={(e) => { e.preventDefault(); setSheet(b); }}
                onPointerCancel={rowPress.clear}
                onPointerDown={() => rowPress.start(b)}
                onPointerLeave={rowPress.clear}
                onPointerUp={rowPress.clear}
              >
                <Database className="m-accent" size={18} />
                <span>{noteDisplayName(b.title)}</span>
                <ChevronRight className="m-chevron" size={18} />
              </button>
            ))}
          </div>
        ))
      )}
      {onCreate && (
        <button className="m-row" onClick={onCreate}>
          <Plus className="m-accent" size={18} />
          <span>{t("mobile.newDatabase")}</span>
        </button>
      )}
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          onClose={() => setSheet(null)}
          actions={[
            { icon: <Database size={18} />, label: t("mobile.sheetOpen"), onClick: () => { const s = sheet; setSheet(null); onOpenBase(s.path); } },
            { icon: <Trash2 size={18} />, label: t("common.delete"), danger: true, onClick: () => { const s = sheet; setSheet(null); void confirmDeleteFile(vault, s.path, s.title, t); } },
          ]}
        />
      )}
    </div>
  );
}
