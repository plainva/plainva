import React, { useState, useEffect, useRef } from "react";
import { useVault } from "../contexts/VaultContext";
import { Search, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON, useFocusTrap } from "@plainva/ui";
import { getTemplateFolder, listTemplates } from "../services/newItemFlow";
import { activeDocument } from "../services/activeDocument";
import { applyTemplateInteractive, withShellContext } from "../services/templateInteractive";
import { makeDailyPathProvider } from "../services/dailyNotes";

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * When set, choosing a template hands its vault-relative path back instead of
   * inserting it (plan Vorlagen-Engine P4, "New note from template…"). The list
   * and its filter are the same either way — only what happens on Enter differs.
   */
  onPick?: (templatePath: string) => void;
  /** Heading for the picking mode; the inserting mode keeps its own wording. */
  title?: string;
}

interface TemplateItem {
  path: string;
  title: string;
}

export function TemplatePickerModal({ isOpen, onClose, onPick, title }: TemplatePickerModalProps) {
  const { t } = useTranslation();
  const { vaultAdapter, vaultPath } = useVault();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TemplateItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap(isOpen);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    const fetchTemplates = async () => {
      if (!vaultAdapter || !vaultPath || !isOpen) return;
      try {
        const tmplFolder = await getTemplateFolder(vaultPath);
        const items: TemplateItem[] = await listTemplates(vaultAdapter, tmplFolder);
        if (active) {
          const filtered = query.trim() ? items.filter(i => i.title.toLowerCase().includes(query.toLowerCase())) : items;
          setResults(filtered.slice(0, 20));
          setSelectedIndex(0);
        }
      } catch (e) {
        console.error("Error fetching templates", e);
      }
    };
    
    fetchTemplates();
    return () => { active = false; };
  }, [query, vaultAdapter, vaultPath, isOpen]);

  if (!isOpen) return null;

  const handleChoose = async (templatePath: string) => {
    if (onPick) {
      onPick(templatePath);
      onClose();
      return;
    }
    if (!vaultAdapter) return;
    try {
      const raw = await vaultAdapter.readTextFile(templatePath);
      // Inserting INTO a note: strip the template's frontmatter (inert
      // mid-document), interpolate against the HOSTING note's name and folder,
      // then ask every question at once and resolve the {{cursor}} caret.
      const activePath = activeDocument.get().path;
      const title = activePath ? (activePath.split("/").pop() ?? "").replace(/\.md$/i, "") : "";
      const folder = activePath ? activePath.split("/").slice(0, -1).join("/") : "";
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
      const now = new Date();
      const result = await applyTemplateInteractive(
        body,
        await withShellContext(body, {
          title,
          now,
          folder,
          dailyPath: vaultPath ? await makeDailyPathProvider(vaultPath, now) : undefined,
          vaultName: (vaultPath ?? "").split(/[/\\]/).filter(Boolean).pop() ?? "",
          hostPath: activePath ?? undefined,
        }),
        t("templatePicker.answersTitle", { defaultValue: "Angaben für die Vorlage" })
      );
      if (!result) return; // cancelled → nothing is inserted
      window.dispatchEvent(
        new CustomEvent("plainva-insert-text", { detail: { text: result.text, cursorOffset: result.cursor ?? undefined } }),
      );
      onClose();
    } catch (e) {
      console.error("Fehler beim Laden des Templates", e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0 && results[selectedIndex]) {
        handleChoose(results[selectedIndex].path);
      }
    }
  };

  return (
    <div
      ref={trapRef}
      className="pv-palette-overlay quick-switcher-overlay"
      onClick={onClose}
    >
      <div
        className="pv-palette quick-switcher-modal"
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="pv-palette-heading">{title}</div>
        )}
        <div className="pv-palette-inputrow">
          <Search size={ICON.head} style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="pv-palette-input"
            placeholder={t("templatePicker.placeholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        
        {results.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: "8px", maxHeight: "300px", overflowY: "auto" }}>
            {results.map((item, i) => (
              <li 
                key={item.path}
                onClick={() => handleChoose(item.path)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  padding: "8px 12px", cursor: "pointer", borderRadius: "var(--radius-xs)",
                  display: "flex", alignItems: "center", gap: "10px",
                  background: i === selectedIndex ? "var(--accent-color)" : "transparent",
                  color: i === selectedIndex ? "var(--accent-on)" : "var(--text-main)"
                }}
              >
                <FileText size={ICON.ui} opacity={0.7} />
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.title}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        
        {results.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>
            {t("templatePicker.noTemplates")}
          </div>
        )}
      </div>
    </div>
  );
}
