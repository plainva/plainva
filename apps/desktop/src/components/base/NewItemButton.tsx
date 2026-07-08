import React, { useEffect, useRef, useState } from "react";
import { useFixedPopover } from "../ui/useFixedPopover";
import { Plus, ChevronDown, Check, Star, FolderCog, FilePlus2, FolderOpen } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import type { TemplateItem } from "../../services/newItemFlow";

type TFn = (key: string, opts?: any) => string;

/**
 * Header "Neu" split button of the BaseViewer (plan Base-Neu P3/P5, Notion
 * model): the main button creates a new item with the base's default template;
 * the chevron opens a dropdown with the vault templates ("use once" per row,
 * star = set as the base's default), "create template" and the storage-folder
 * setting. All persistence goes through the host's callbacks.
 */
export function NewItemButton({
  t,
  disabled,
  busy,
  currentFolder,
  defaultTemplate,
  loadTemplates,
  onCreate,
  onSetDefaultTemplate,
  onCreateTemplate,
  onChangeFolder,
  onOpenTemplatesFolder,
}: {
  t: TFn;
  disabled?: boolean;
  busy?: boolean;
  /** Resolved storage folder (shown in the menu), or null when not decided yet. */
  currentFolder: string | null;
  /** Vault-relative path of the base's default template, or null. */
  defaultTemplate: string | null;
  loadTemplates: () => Promise<{ folder: string; items: TemplateItem[] }>;
  onCreate: (templatePath: string | null) => void;
  onSetDefaultTemplate: (path: string | null) => void;
  onCreateTemplate: () => void;
  onChangeFolder: () => void;
  /** Reveal the template folder in the file tree (manage: edit/rename/delete there). */
  onOpenTemplatesFolder?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const popRef = useFixedPopover(open, splitRef, { minWidth: 240 });
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateFolder, setTemplateFolder] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadTemplates()
      .then(({ folder, items }) => {
        if (!alive) return;
        setTemplateFolder(folder);
        setTemplates(items);
      })
      .catch(() => { if (alive) setTemplates([]); });
    return () => { alive = false; };
  }, [open, loadTemplates]);

  const itemStyle: React.CSSProperties = {
    width: "100%", display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.45rem 0.5rem",
    background: "transparent", border: "none", color: "var(--text-main)", cursor: "pointer",
    textAlign: "left", borderRadius: "var(--radius-xs)", fontSize: "0.85rem",
  };
  const hover = {
    onMouseOver: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "var(--bg-hover)"; },
    onMouseOut: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; },
  };

  // One row per template choice (null = without template). The check marks the
  // base's current default; the star sets/clears it without creating anything.
  const templateRow = (path: string | null, title: string) => {
    const isDefault = defaultTemplate === path;
    return (
      <div key={path ?? "__none__"} style={{ display: "flex", alignItems: "center" }}>
        <button type="button" style={{ ...itemStyle, flex: 1, minWidth: 0 }} {...hover}
          onClick={() => { setOpen(false); onCreate(path); }}
          title={t("database.createWithTemplate", { title, defaultValue: "Neues Element mit „{{title}}“ anlegen" })}
        >
          <span style={{ width: 14, display: "inline-flex", flexShrink: 0 }}>{isDefault && <Check size={13} aria-hidden="true" />}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </button>
        <button
          type="button"
          className="pv-icon-btn"
          aria-label={isDefault
            ? t("database.isDefaultTemplate", { defaultValue: "Standard-Vorlage" })
            : t("database.setDefaultTemplate", { defaultValue: "Als Standard setzen" })}
          title={isDefault
            ? t("database.isDefaultTemplate", { defaultValue: "Standard-Vorlage" })
            : t("database.setDefaultTemplate", { defaultValue: "Als Standard setzen" })}
          style={{ flexShrink: 0, color: isDefault ? "var(--accent-color)" : "var(--text-muted)" }}
          onClick={() => onSetDefaultTemplate(path)}
        >
          <Star size={13} fill={isDefault ? "currentColor" : "none"} />
        </button>
      </div>
    );
  };

  return (
    <div ref={splitRef} className="pv-splitbtn" style={{ position: "relative" }}>
      <button
        type="button"
        className="pv-btn pv-btn--primary pv-btn--sm"
        onClick={() => onCreate(defaultTemplate)}
        disabled={disabled || busy}
        aria-label={t("database.newItem", { defaultValue: "Eintrag" })}
        title={t("database.newItemTip", { defaultValue: "Neues Element anlegen" })}
      >
        <Plus size={14} /><span className="base-toolbar-label">{t("database.newItem", { defaultValue: "Eintrag" })}</span>
      </button>
      <button
        type="button"
        className="pv-btn pv-btn--primary pv-btn--sm"
        onClick={() => setOpen((s) => !s)}
        disabled={disabled}
        aria-label={t("database.newItemMenu", { defaultValue: "Vorlagen und Ablage-Ordner" })}
        title={t("database.newItemMenu", { defaultValue: "Vorlagen und Ablage-Ordner" })}
        aria-expanded={open}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: "var(--z-popover)" as unknown as number }} onClick={() => setOpen(false)} />
          <div ref={popRef} className="pv-popover pv-popover--fixed" style={{ padding: "0.25rem", maxWidth: 320 }}>
            <div style={{ padding: "0.3rem 0.5rem", fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
              {t("database.templatesSection", { defaultValue: "Vorlagen" })}
            </div>
            {templateRow(null, t("database.noTemplate", { defaultValue: "Ohne Vorlage" }))}
            {templates.map((tpl) => templateRow(tpl.path, tpl.title))}
            {templates.length === 0 && (
              <div style={{ padding: "0.3rem 0.5rem", fontSize: "0.8rem", color: "var(--text-faint)" }}>
                {t("database.noTemplatesFound", { folder: templateFolder, defaultValue: "Keine Vorlagen in „{{folder}}“" })}
              </div>
            )}
            <div style={{ height: 1, background: "var(--border-color)", margin: "0.25rem 0" }} />
            <button type="button" style={itemStyle} {...hover} onClick={() => { setOpen(false); onCreateTemplate(); }}>
              <FilePlus2 size={14} style={{ flexShrink: 0 }} />
              {t("database.createTemplate", { defaultValue: "Neue Vorlage erstellen" })}
            </button>
            {onOpenTemplatesFolder && (
              <button type="button" style={itemStyle} {...hover}
                onClick={() => { setOpen(false); onOpenTemplatesFolder(); }}
                title={t("database.openTemplatesFolder", { defaultValue: "Vorlagen-Ordner im Dateibaum öffnen (bearbeiten, umbenennen, löschen)" })}
              >
                <FolderOpen size={14} style={{ flexShrink: 0 }} />
                {t("database.openTemplatesFolder", { defaultValue: "Vorlagen-Ordner im Dateibaum öffnen (bearbeiten, umbenennen, löschen)" })}
              </button>
            )}
            <div style={{ height: 1, background: "var(--border-color)", margin: "0.25rem 0" }} />
            <button type="button" style={{ ...itemStyle, flexDirection: "column", alignItems: "flex-start", gap: 2 }} {...hover} onClick={() => { setOpen(false); onChangeFolder(); }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <FolderCog size={14} style={{ flexShrink: 0 }} />
                {t("database.changeNewItemFolder", { defaultValue: "Ablage-Ordner ändern…" })}
              </span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", paddingLeft: 22, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                {t("database.currentStorageFolder", {
                  folder: currentFolder ?? t("database.storageFolderUnset", { defaultValue: "nicht festgelegt" }),
                  defaultValue: "Aktuell: {{folder}}",
                })}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Storage-folder dialog of the new-item flow (plan Base-Neu P4). Two modes:
 * "setup" (no folder source yet — free entry with vault-folder suggestions;
 * the folder is created and, unless the base is tag-sourced, added as a
 * source) and "choice" (several folder sources — pick one). The choice is
 * persisted in the .base (`newItemFolder`) and can be changed anytime.
 */
export function NewItemFolderDialog({
  t,
  mode,
  folderSources,
  current,
  hasTagSources,
  onConfirm,
  onCancel,
}: {
  t: TFn;
  mode: "setup" | "choice";
  folderSources: string[];
  current: string | null;
  hasTagSources: boolean;
  onConfirm: (folder: string) => void;
  onCancel: () => void;
}) {
  const { queryService } = useVault();
  const [folders, setFolders] = useState<string[]>([]);
  const [value, setValue] = useState<string>(current ?? folderSources[0] ?? "");

  useEffect(() => {
    if (mode !== "setup" || !queryService) return;
    queryService.getAllFolders().then(setFolders).catch(() => setFolders([]));
  }, [mode, queryService]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const clean = value.replace(/^\/+|\/+$/g, "").trim();

  return (
    <div className="pv-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="pv-modal-card" style={{ width: 420 }} role="dialog" aria-label={t("database.newItemFolderTitle", { defaultValue: "Ablage-Ordner für neue Elemente" })}>
        <div className="pv-modal-head">
          <span className="pv-modal-title">{t("database.newItemFolderTitle", { defaultValue: "Ablage-Ordner für neue Elemente" })}</span>
        </div>
        <div className="pv-modal-hint">
          {mode === "setup"
            ? hasTagSources
              ? t("database.newItemFolderSetupTagHint", { defaultValue: "Neue Elemente erhalten automatisch die Tag-Quelle dieser Datenbank. Lege fest, in welchem Ordner sie gespeichert werden." })
              : t("database.newItemFolderSetupHint", { defaultValue: "Diese Datenbank hat noch keinen Ordner als Quelle. Lege fest, wo neue Elemente gespeichert werden – der Ordner wird angelegt und als Quelle eingetragen." })
            : t("database.newItemFolderChoiceHint", { defaultValue: "Diese Datenbank hat mehrere Ordner-Quellen. Wähle, wo neue Elemente gespeichert werden. Die Wahl wird in der Datenbank gespeichert und ist jederzeit änderbar." })}
        </div>
        {mode === "choice" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", margin: "0.4rem 0" }}>
            {folderSources.map((f) => (
              <label key={f} className="pv-modal-check" style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="pv-newitem-folder"
                  checked={value === f}
                  onChange={() => setValue(f)}
                />
                <span style={{ overflowWrap: "anywhere" }}>{f}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="pv-modal-row" style={{ margin: "0.4rem 0" }}>
            <input
              autoFocus
              className="pv-input"
              style={{ flex: 1, boxSizing: "border-box" }}
              list="pv-newitem-folder-list"
              placeholder={t("database.newItemFolderPlaceholder", { defaultValue: "Ordner (z. B. Projekte/Aktiv)" })}
              value={value}
              aria-label={t("database.newItemFolderTitle", { defaultValue: "Ablage-Ordner für neue Elemente" })}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && clean) onConfirm(clean); }}
            />
            <datalist id="pv-newitem-folder-list">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
        )}
        <div className="pv-modal-actions">
          <button type="button" className="pv-btn-secondary" onClick={onCancel}>{t("common.cancel", { defaultValue: "Abbrechen" })}</button>
          <button
            type="button"
            className="pv-btn-primary"
            disabled={!clean}
            style={clean ? undefined : { opacity: 0.5, cursor: "default" }}
            onClick={() => { if (clean) onConfirm(clean); }}
          >
            {t("database.chooseFolder", { defaultValue: "Festlegen" })}
          </button>
        </div>
      </div>
    </div>
  );
}
