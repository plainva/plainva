import React, { useState, useEffect, useRef } from "react";
import { useVault } from "../contexts/VaultContext";
import { Search, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "@plainva/ui";
import { applyTemplatePlaceholders, getTemplateFolder, listTemplates } from "../services/newItemFlow";

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TemplateItem {
  path: string;
  title: string;
}

export function TemplatePickerModal({ isOpen, onClose }: TemplatePickerModalProps) {
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

  const handleInsert = async (templatePath: string) => {
    if (!vaultAdapter) return;
    try {
      const raw = await vaultAdapter.readTextFile(templatePath);
      // No active-file title available here — {{title}} interpolates to "".
      const content = applyTemplatePlaceholders(raw, "");
      window.dispatchEvent(new CustomEvent("plainva-insert-text", { detail: { text: content } }));
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
        handleInsert(results[selectedIndex].path);
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
        <div className="pv-palette-inputrow">
          <Search size={18} style={{ flexShrink: 0 }} />
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
                onClick={() => handleInsert(item.path)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  padding: "8px 12px", cursor: "pointer", borderRadius: "var(--radius-xs)",
                  display: "flex", alignItems: "center", gap: "10px",
                  background: i === selectedIndex ? "var(--accent-color)" : "transparent",
                  color: i === selectedIndex ? "var(--accent-on)" : "var(--text-main)"
                }}
              >
                <FileText size={16} opacity={0.7} />
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
