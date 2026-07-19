import { useState, useEffect, useMemo } from "react";
import { useVault } from "../contexts/VaultContext";
import { Link as LinkIcon, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { groupBacklinks } from "./backlinksModel";
import { ICON } from "@plainva/ui";

interface BacklinksPanelProps {
  activePath: string | null;
  onOpenPath: (path: string, newTab?: boolean) => void;
  /** When embedded in a collapsible sidebar section, drop the own header/scroll chrome. */
  embedded?: boolean;
  /** Reports the number of backlinks (for the section header badge). */
  onCountChange?: (count: number) => void;
}

interface BacklinkItem {
  source_path: string;
  target_path: string;
  link_type: string;
}

export function BacklinksPanel({ activePath, onOpenPath, embedded, onCountChange }: BacklinksPanelProps) {
  const { t } = useTranslation();
  const { queryService, fileTreeVersion } = useVault();
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);

  // One row per linking file — repeated links inside the same note collapse
  // into a single entry with an occurrence badge (maintainer request 2026-07-04).
  const grouped = useMemo(() => groupBacklinks(backlinks), [backlinks]);

  useEffect(() => { onCountChange?.(grouped.length); }, [grouped, onCountChange]);

  useEffect(() => {
    let active = true;

    const fetchBacklinks = async () => {
      if (!queryService || !activePath) {
        if (active) setBacklinks([]);
        return;
      }

      try {
        const links = await queryService.getBacklinks(activePath);
        if (active) {
          setBacklinks(links);
        }
      } catch (err) {
        console.error("Failed to fetch backlinks", err);
        if (active) setBacklinks([]);
      }
    };

    fetchBacklinks();

    return () => {
      active = false;
    };
  }, [activePath, queryService, fileTreeVersion]);

  const listItems = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {grouped.map((link) => (
        <div
          key={link.source_path}
          onClick={(e) => onOpenPath(link.source_path, e.ctrlKey || e.metaKey)}
          className="pv-rowhover"
          style={{ padding: '0.5rem', borderRadius: "var(--radius-sm)", cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}
        >
          <FileText size={ICON.ui} color="var(--accent-color)" style={{ marginTop: '2px', flexShrink: 0 }} />
          <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-ui)', fontWeight: 500, color: 'var(--accent-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {link.source_path.split(/[/\\]/).pop()}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {link.source_path}
            </div>
          </div>
          {link.count > 1 && (
            <span
              data-tip={t("backlinks.occurrences", { count: link.count })}
              style={{ flexShrink: 0, marginTop: '2px', fontSize: 'var(--text-sm)', color: 'var(--text-faint)', border: '1px solid var(--border-color)', borderRadius: "var(--radius-pill)", padding: '0 6px', lineHeight: 1.5 }}
            >×{link.count}</span>
          )}
        </div>
      ))}
    </div>
  );

  // Embedded: no own header/scroll chrome (the sidebar section provides them).
  if (embedded) {
    if (!activePath) {
      return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--text-ui)', fontStyle: 'italic' }}>{t("backlinks.noActiveFile")}</div>;
    }
    return backlinks.length === 0
      ? <div style={{ color: 'var(--text-faint)', fontSize: 'var(--text-ui)', fontStyle: 'italic' }}>{t("backlinks.noBacklinks")}</div>
      : listItems;
  }

  if (!activePath) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-faint)", fontSize: "var(--text-md)", textAlign: "center" }}>
        {t("backlinks.noActiveFile")}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary)' }}>
        <LinkIcon size={ICON.ui} color="var(--text-muted)" />
        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text-main)' }}>{t("backlinks.title")}</h3>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {backlinks.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-ui)', textAlign: 'center', padding: '2rem 1rem' }}>
            {t("backlinks.noBacklinks")}
          </div>
        ) : listItems}
      </div>
    </div>
  );
}
