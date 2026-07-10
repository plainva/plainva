import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Copy, Eye, FilePlus2, Link2, Pencil, Pin, PinOff, SquareSplitHorizontal, Trash2 } from "lucide-react";
import type { VaultQueryService, IVaultAdapter } from "@plainva/core";
import { MenuItem, MenuLabel, MenuSeparator, MenuSurface } from "@plainva/ui";
import { appendWikiLink } from "../../services/graphActions";
import { findRelationOptions, loadRelationCatalog, writeRelationLink, type RelationOption } from "../../services/graphRelationTargets";
import { appConfirm } from "../../services/appDialogs";
import { toast } from "../../services/toastStore";

/**
 * Context menus + the connect-gesture popover of the vault map (P6). All
 * menus are MenuSurface instances at the pointer position — the one themed
 * menu look of the design language.
 */

export interface NodeMenuState {
  path: string;
  x: number;
  y: number;
  pinned: boolean;
}

export function GraphNodeMenu(props: {
  state: NodeMenuState;
  onClose: () => void;
  onOpen: () => void;
  onPeek: () => void;
  onOpenInSplit?: () => void;
  onNewTab: () => void;
  onNewConnectedNote: () => void;
  onRename: () => void;
  onToggleBookmark?: () => void;
  onUnpin: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { state } = props;
  return (
    <MenuSurface open onClose={props.onClose} at={{ x: state.x, y: state.y }} minWidth={230} ariaLabel={t("graph.nodeMenu", { defaultValue: "Notiz-Aktionen" })}>
      <MenuItem icon={<Eye size={15} />} onSelect={props.onPeek}>{t("graph.menuPeek", { defaultValue: "Peek" })}</MenuItem>
      <MenuItem icon={<Copy size={15} />} onSelect={props.onOpen}>{t("graph.menuOpen", { defaultValue: "Öffnen" })}</MenuItem>
      {props.onOpenInSplit && (
        <MenuItem icon={<SquareSplitHorizontal size={15} />} onSelect={props.onOpenInSplit}>{t("graph.menuOpenSplit", { defaultValue: "Im Split öffnen" })}</MenuItem>
      )}
      <MenuItem icon={<Copy size={15} />} onSelect={props.onNewTab}>{t("graph.menuNewTab", { defaultValue: "In neuem Tab öffnen" })}</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<FilePlus2 size={15} />} onSelect={props.onNewConnectedNote}>{t("graph.menuNewConnected", { defaultValue: "Neue verbundene Notiz…" })}</MenuItem>
      <MenuItem icon={<Pencil size={15} />} onSelect={props.onRename}>{t("graph.menuRename", { defaultValue: "Umbenennen…" })}</MenuItem>
      {props.onToggleBookmark && (
        <MenuItem icon={<Bookmark size={15} />} onSelect={props.onToggleBookmark}>{t("graph.menuBookmark", { defaultValue: "Lesezeichen umschalten" })}</MenuItem>
      )}
      {state.pinned && (
        <MenuItem icon={<PinOff size={15} />} onSelect={props.onUnpin}>{t("graph.menuUnpin", { defaultValue: "Pin lösen" })}</MenuItem>
      )}
      <MenuSeparator />
      <MenuItem danger icon={<Trash2 size={15} />} onSelect={props.onDelete}>{t("graph.menuDelete", { defaultValue: "Löschen…" })}</MenuItem>
    </MenuSurface>
  );
}

export interface FolderMenuState {
  folder: string;
  x: number;
  y: number;
  expanded: boolean;
}

/** Folder bubble context menu (report #6: more than "collapse all"). */
export function GraphFolderMenu(props: {
  state: FolderMenuState;
  onClose: () => void;
  onToggleExpand: () => void;
  onExpandOnlyThis: () => void;
  onFocusFolder: () => void;
  onCollapseAll: () => void;
}) {
  const { t } = useTranslation();
  const { state } = props;
  return (
    <MenuSurface open onClose={props.onClose} at={{ x: state.x, y: state.y }} minWidth={230} ariaLabel={t("graph.folderMenu", { defaultValue: "Ordner-Aktionen" })}>
      <MenuItem onSelect={props.onToggleExpand}>
        {state.expanded
          ? t("graph.menuCollapseFolder", { defaultValue: "Ordner einklappen" })
          : t("graph.menuExpandFolder", { defaultValue: "Ordner entfalten" })}
      </MenuItem>
      <MenuItem onSelect={props.onExpandOnlyThis}>{t("graph.menuExpandOnly", { defaultValue: "Nur diesen Ordner entfalten" })}</MenuItem>
      <MenuItem icon={<Link2 size={15} />} onSelect={props.onFocusFolder}>{t("graph.menuFocusFolder", { defaultValue: "Fokus auf diesen Ordner" })}</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onCollapseAll}>{t("graph.collapseAll", { defaultValue: "Alle Ordner einklappen" })}</MenuItem>
    </MenuSurface>
  );
}

export interface EdgeMenuState {
  edgeId: string;
  x: number;
  y: number;
  entries: { source: string; target: string; kind: string; propertyKey: string | null; count: number }[];
}

/** Edge context menu (report #5: edges must DO something). */
export function GraphEdgeMenu(props: {
  state: EdgeMenuState;
  titleOf: (path: string) => string;
  onClose: () => void;
  onOpen: (path: string) => void;
  onRemoveTextLinks: (source: string, target: string) => void;
  onRemoveRelation: (source: string, target: string, propertyKey: string) => void;
}) {
  const { t } = useTranslation();
  const { state } = props;
  const shown = state.entries.slice(0, 5);
  return (
    <MenuSurface open onClose={props.onClose} at={{ x: state.x, y: state.y }} minWidth={260} ariaLabel={t("graph.edgeMenu", { defaultValue: "Verknüpfungs-Aktionen" })}>
      {shown.map((entry, i) => (
        <div key={`${entry.source}-${entry.target}-${entry.propertyKey ?? entry.kind}-${i}`}>
          {i > 0 && <MenuSeparator />}
          <MenuLabel>
            {props.titleOf(entry.source)} → {props.titleOf(entry.target)}
            {entry.propertyKey ? ` · ${entry.propertyKey}` : ""}
          </MenuLabel>
          <MenuItem onSelect={() => props.onOpen(entry.source)}>{t("graph.edgeOpenSource", { defaultValue: "Quelle öffnen" })}</MenuItem>
          <MenuItem onSelect={() => props.onOpen(entry.target)}>{t("graph.edgeOpenTarget", { defaultValue: "Ziel öffnen" })}</MenuItem>
          {entry.propertyKey ? (
            <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => props.onRemoveRelation(entry.source, entry.target, entry.propertyKey!)}>
              {t("graph.edgeRemoveRelation", { defaultValue: "Relation entfernen" })}
            </MenuItem>
          ) : (
            <MenuItem danger icon={<Trash2 size={15} />} onSelect={() => props.onRemoveTextLinks(entry.source, entry.target)}>
              {t("graph.edgeRemoveLinks", { defaultValue: "Text-Link(s) entfernen" })}
            </MenuItem>
          )}
        </div>
      ))}
      {state.entries.length > shown.length && (
        <MenuLabel>{t("graph.edgeMore", { defaultValue: "+{{n}} weitere", n: state.entries.length - shown.length })}</MenuLabel>
      )}
    </MenuSurface>
  );
}

export interface CanvasMenuState {
  x: number;
  y: number;
}

export function GraphCanvasMenu(props: {
  state: CanvasMenuState;
  onClose: () => void;
  onNewNote: () => void;
  onResetLayout: () => void;
  onZoomFit: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MenuSurface open onClose={props.onClose} at={{ x: props.state.x, y: props.state.y }} minWidth={230} ariaLabel={t("graph.canvasMenu", { defaultValue: "Karten-Aktionen" })}>
      <MenuItem icon={<FilePlus2 size={15} />} onSelect={props.onNewNote}>{t("graph.menuNewNote", { defaultValue: "Neue Notiz…" })}</MenuItem>
      <MenuItem icon={<Pin size={15} />} onSelect={props.onResetLayout}>{t("graph.menuResetLayout", { defaultValue: "Layout zurücksetzen" })}</MenuItem>
      <MenuItem onSelect={props.onZoomFit}>{t("graph.zoomFit", { defaultValue: "Alles einpassen" })}</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={props.onExportPng}>{t("graph.exportPng", { defaultValue: "Als PNG exportieren…" })}</MenuItem>
      <MenuItem onSelect={props.onExportSvg}>{t("graph.exportSvg", { defaultValue: "Als SVG exportieren…" })}</MenuItem>
    </MenuSurface>
  );
}

export interface ConnectDropState {
  source: string;
  target: string;
  x: number;
  y: number;
}

/**
 * Connect gesture result menu: plain text link always; every applicable
 * `.base` relation as an additional option (limit-one relations replace
 * after confirmation).
 */
export function GraphConnectMenu(props: {
  state: ConnectDropState;
  adapter: IVaultAdapter;
  queryService: VaultQueryService;
  titleOf: (path: string) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { state, adapter, queryService } = props;
  const [options, setOptions] = useState<RelationOption[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadRelationCatalog(adapter, queryService)
      .then((catalog) => {
        if (alive) setOptions(findRelationOptions(catalog, state.source, state.target));
      })
      .catch(() => {
        if (alive) setOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [adapter, queryService, state.source, state.target]);

  const finish = (message: string) => {
    toast.success(message);
    props.onDone();
    props.onClose();
  };

  const linkAsText = async () => {
    try {
      await appendWikiLink(adapter, queryService, state.source, state.target);
      finish(t("graph.connectDone", { defaultValue: "Link erstellt." }));
    } catch {
      toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      props.onClose();
    }
  };

  const linkAsRelation = async (option: RelationOption) => {
    try {
      if (option.limitOne) {
        const ok = await appConfirm({
          title: t("graph.connectLimitTitle", { defaultValue: "Relation ersetzen?" }),
          message: t("graph.connectLimitMsg", {
            defaultValue: "„{{property}}“ erlaubt genau einen Eintrag — der bisherige Wert wird ersetzt.",
            property: option.propertyKey,
          }),
          kind: "warning",
        });
        if (!ok) return;
      }
      await writeRelationLink(adapter, queryService, state.source, state.target, option.propertyKey, option.limitOne);
      finish(t("graph.connectDone", { defaultValue: "Link erstellt." }));
    } catch {
      toast.error(t("graph.cleanupActionFailed", { defaultValue: "Aktion fehlgeschlagen." }));
      props.onClose();
    }
  };

  return (
    <MenuSurface open onClose={props.onClose} at={{ x: state.x, y: state.y }} minWidth={260} ariaLabel={t("graph.connectMenu", { defaultValue: "Verlinken" })}>
      <MenuLabel>
        {t("graph.connectTitle", { defaultValue: "{{source}} → {{target}}", source: props.titleOf(state.source), target: props.titleOf(state.target) })}
      </MenuLabel>
      <MenuItem icon={<Link2 size={15} />} onSelect={() => void linkAsText()} data-testid="graph-connect-text">
        {t("graph.connectAsText", { defaultValue: "Als Text-Link (ans Notizende)" })}
      </MenuItem>
      {options === null && <MenuLabel>{t("graph.connectLoading", { defaultValue: "Suche Relationen…" })}</MenuLabel>}
      {options && options.length > 0 && <MenuSeparator />}
      {options?.map((o) => (
        <MenuItem key={`${o.baseName}-${o.propertyKey}`} icon={<Link2 size={15} />} onSelect={() => void linkAsRelation(o)}>
          {t("graph.connectAsRelation", { defaultValue: "Relation „{{property}}“ ({{base}})", property: o.propertyKey, base: o.baseName })}
          {o.limitOne ? " ¹" : ""}
        </MenuItem>
      ))}
    </MenuSurface>
  );
}
