import type { LucideIcon } from "lucide-react";
import { CalendarDays, CalendarPlus, Database, FilePlus, FileText, FolderPlus, ListPlus } from "lucide-react";

/**
 * Everything "New …" can make, once (Design-Runde Bedienung 2026-09-04, E4).
 *
 * Before this the offer was spread over four places with four orders: the
 * desktop sidebar's ＋ menu, the ribbon, the palette's "create" group and the
 * phone's FAB — and the phone grouped what the desktop listed flat. Now one
 * catalog says what exists, in which group and in which order; each surface
 * reads it and shows the entries whose handler it has. A surface that offers
 * something the catalog does not know is what the interaction-grammar guard
 * reports.
 *
 * Groups are by WHERE the thing lands: content goes into the vault as a file;
 * a term or a task goes to the calendar or the task database. Both shells show
 * the groups in this order.
 */
export type NewItemId = "note" | "noteFromTemplate" | "daily" | "folder" | "base" | "template" | "event" | "task";
export type NewGroupId = "content" | "pim";

export interface NewItemMeta {
  /** The palette's command id — stable, tests and E2E hang on it. */
  commandId: string;
  icon: LucideIcon;
  titleKey: string;
  titleDefault: string;
  /** Keyboard hint in the palette's "Mod+…" spelling. */
  hint?: string;
}

export const NEW_GROUPS: ReadonlyArray<{ id: NewGroupId; items: readonly NewItemId[] }> = [
  { id: "content", items: ["note", "noteFromTemplate", "daily", "folder", "base", "template"] },
  { id: "pim", items: ["event", "task"] },
];

export const NEW_ITEMS: Record<NewItemId, NewItemMeta> = {
  note: { commandId: "new-note", icon: FilePlus, titleKey: "common.newNote", titleDefault: "Neue Notiz", hint: "Mod+N" },
  noteFromTemplate: { commandId: "new-note-from-template", icon: FileText, titleKey: "fileTree.newFromTemplate", titleDefault: "Neue Notiz aus Vorlage …" },
  daily: { commandId: "daily-note", icon: CalendarDays, titleKey: "sidebar.newDaily", titleDefault: "Tageseintrag", hint: "Mod+Shift+D" },
  folder: { commandId: "new-folder", icon: FolderPlus, titleKey: "common.newFolder", titleDefault: "Neuer Ordner" },
  base: { commandId: "new-base", icon: Database, titleKey: "fileTree.newBaseHere", titleDefault: "Neue Datenbank (.base)" },
  template: { commandId: "template-new", icon: FileText, titleKey: "database.createTemplate", titleDefault: "Neue Vorlage erstellen" },
  event: { commandId: "new-event", icon: CalendarPlus, titleKey: "pim.newEvent", titleDefault: "Neuer Termin" },
  task: { commandId: "new-task", icon: ListPlus, titleKey: "tasks.newDbTask", titleDefault: "Neue Aufgabe" },
};

/** Every id in catalog order — the flat view the palette and the guard use. */
export const NEW_ITEM_ORDER: readonly NewItemId[] = NEW_GROUPS.flatMap((g) => g.items);

/** The handlers a surface has; an entry is built only where one exists. */
export type NewHandlers = Partial<Record<NewItemId, () => void>>;

export interface NewEntry {
  id: NewItemId;
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

export interface NewGroupEntries {
  id: NewGroupId;
  items: NewEntry[];
}

/**
 * The catalog for one surface: its groups, each with the entries the surface
 * can serve, in catalog order. Empty groups are dropped so no surface shows a
 * heading over nothing.
 */
export function newEntries(
  t: (key: string, opts?: Record<string, unknown>) => string,
  handlers: NewHandlers,
): NewGroupEntries[] {
  const groups: NewGroupEntries[] = [];
  for (const g of NEW_GROUPS) {
    const items: NewEntry[] = [];
    for (const id of g.items) {
      const run = handlers[id];
      if (!run) continue;
      const meta = NEW_ITEMS[id];
      items.push({ id, label: t(meta.titleKey, { defaultValue: meta.titleDefault }), icon: meta.icon, hint: meta.hint, run });
    }
    if (items.length > 0) groups.push({ id: g.id, items });
  }
  return groups;
}
