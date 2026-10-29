import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Folder, Database, CornerUpLeft } from "lucide-react";
import { GroupCard, ICON, Row, RowList, useStableHandler } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { registerSheet } from "../services/sheetStack";
import { TAB_POOL, type BackStop, type NavEntry, type TabScreenId } from "../navigation";

/** The last part of a path, without the Markdown or database ending. */
function baseName(path: string): string {
  const last = path.split("/").filter(Boolean).pop() ?? path;
  return last.replace(/\.(md|base)$/i, "");
}

/**
 * The long press on Back (F6, S7): the places behind the current screen,
 * the tab's root first, then newest first - like the back menu on iOS. A tap
 * jumps there in one step. Only the phone has it: the desktop has no back
 * button, it has tabs and Ctrl+Alt+Left per tab (parity catalog).
 */
export function BackHistorySheet({
  stops,
  activeTab,
  onPick,
  onClose,
}: {
  stops: BackStop[];
  activeTab: TabScreenId;
  onPick: (stop: BackStop) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const close = useStableHandler(onClose);
  useEffect(() => registerSheet(() => close()), [close]);
  const tab = TAB_POOL.find((d) => d.id === activeTab);
  const label = (entry: NavEntry | null): string => {
    if (!entry) return tab ? t(tab.labelKey) : t("mobile.tabHome");
    const area = TAB_POOL.find((d) => d.id !== undefined && !entry.path && SCREEN_KIND[d.id] === entry.kind);
    if (area) return t(area.labelKey);
    if (entry.path && (entry.kind === "note" || entry.kind === "base" || entry.kind === "folder")) return baseName(entry.path);
    return t("mobile.backPreviousPage");
  };
  const icon = (entry: NavEntry | null) => {
    if (!entry) { const Icon = tab?.icon ?? CornerUpLeft; return <Icon size={ICON.head} />; }
    if (entry.kind === "folder") return <Folder size={ICON.head} />;
    if (entry.kind === "base") return <Database size={ICON.head} />;
    if (entry.kind === "note") return <FileText size={ICON.head} />;
    return <CornerUpLeft size={ICON.head} />;
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="back-history-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("mobile.backHistoryTitle")}</p>
        <GroupCard>
          <RowList>
            {stops.map((stop, i) => (
              <Row
                data-testid="back-history-stop"
                icon={icon(stop.entry)}
                key={i}
                onClick={() => onPick(stop)}
                title={label(stop.entry)}
              />
            ))}
          </RowList>
        </GroupCard>
      </div>
    </div>
  );
}

/** Which entry kind each area's root is (SCREEN_ENTRY, by kind only). */
const SCREEN_KIND: Partial<Record<TabScreenId, string>> = {
  notes: "folder",
  today: "today",
  tasks: "tasks",
  calendar: "pimcalendar",
  mail: "mail",
  graph: "graphmap",
  comments: "comments",
  journal: "journal",
};
