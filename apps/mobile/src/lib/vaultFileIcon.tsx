import type { ReactNode } from "react";
import { Database, FileText, Sun } from "lucide-react";
import { DocIcon, ICON } from "@plainva/ui";
import { getMobileSettings } from "../services/mobileSettings";

/**
 * The icon of a note or database in a list of recent or saved files: the
 * note's own icon when it has one, the database glyph for a `.base`, a sun for
 * a daily note, a page for anything else. The home screen's band and the full
 * Recent list draw the same entry with the same icon (plan Rückmeldungen
 * 2026-10-24, E8).
 */
export function vaultFileIcon(path: string, docIcons: Map<string, { icon: string; color?: string }>): ReactNode {
  const custom = docIcons.get(path);
  if (custom) return <DocIcon color={custom.color} icon={custom.icon} size={ICON.ui} />;
  if (/\.base$/i.test(path)) return <Database size={ICON.ui} />;
  const daily = getMobileSettings().dailyFolder;
  if (path.startsWith(`${daily}/`)) return <Sun size={ICON.ui} />;
  return <FileText size={ICON.ui} />;
}
