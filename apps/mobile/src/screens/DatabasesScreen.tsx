import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Database, Plus, Trash2 } from "lucide-react";
import { Button, EmptyState, GroupCard, ICON, noteDisplayName, Row, RowList, SectionLabel } from "@plainva/ui";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { useLongPress } from "../lib/useLongPress";
import { RowActionSheet } from "../components/RowActionSheet";
import { confirmDeleteFile } from "../lib/deleteFile";
import { type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

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
  pane = false,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  /** Rendered as a pane INSIDE the navigator: no page wrapper, no own pull. */
  pane?: boolean;
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

  const body = (
    <>
      {onBack && (
        <AppBar onBack={onBack} title={t("mobile.tabDatabases")} />
      )}
      {ptrIndicator}
      {bases.length === 0 ? (
        /* The message already told the reader to create a .base file; the way
           to do it sat behind the bar's "+" (N7). */
        <EmptyState
          action={
            onCreate ? (
              <Button data-testid="databases-empty-new" onClick={onCreate} variant="tonal">
                {t("mobile.newDatabase")}
              </Button>
            ) : undefined
          }
          icon={<Database size={ICON.head} />}
        >
          {t("mobile.databasesEmpty")}
        </EmptyState>
      ) : (
        /* The last run of loose rows in the navigator (Z1). N3 converted six
           surfaces and missed this one, and nothing said so: the pinboard
           capture reaches its `.base` by clicking a row HERE, so the surface
           behind it went dark in every theme the moment the navigator's rows
           changed shape — and the first full run is what showed it. */
        folders.map((folder) => (
          <div key={folder || "/"}>
            <SectionLabel>{folder || t("mobile.vaultRoot")}</SectionLabel>
            <GroupCard>
              <RowList>
                {groups.get(folder)!.map((b) => (
                  <Row
                    key={b.path}
                    icon={<Database className="m-accent" size={ICON.ui} />}
                    title={noteDisplayName(b.title)}
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={() => { if (rowPress.clicked()) onOpenBase(b.path); }}
                    onContextMenu={(e) => { e.preventDefault(); setSheet(b); }}
                    onPointerCancel={rowPress.clear}
                    onPointerDown={() => rowPress.start(b)}
                    onPointerLeave={rowPress.clear}
                    onPointerUp={rowPress.clear}
                  />
                ))}
              </RowList>
            </GroupCard>
          </div>
        ))
      )}
      {onCreate && (
        <GroupCard>
          <RowList>
            <Row
              data-testid="databases-new"
              icon={<Plus className="m-accent" size={ICON.ui} />}
              onClick={onCreate}
              title={t("mobile.newDatabase")}
            />
          </RowList>
        </GroupCard>
      )}
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          onClose={() => setSheet(null)}
          actions={[
            { icon: <Database size={ICON.head} />, label: t("mobile.sheetOpen"), onClick: () => { const s = sheet; setSheet(null); onOpenBase(s.path); } },
            { icon: <Trash2 size={ICON.head} />, label: t("common.delete"), danger: true, onClick: () => { const s = sheet; setSheet(null); void confirmDeleteFile(vault, s.path, s.title, t); } },
          ]}
        />
      )}
    </>
  );

  if (pane) return body;
  return (
    <div className="m-page" ref={ptrRef}>
      {body}
    </div>
  );
}
