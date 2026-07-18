import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Folder } from "lucide-react";
import { Modal } from "@plainva/ui";

const basename = (p: string) => p.split(/[/\\]/).pop() || p;

/**
 * Vault picker for the rail's "switch" link (redesign 2026-07-18, P2).
 * Lists the known vaults (open + recents — the same set the old dropdown
 * offered); picking one selects WHICH vault the VAULT settings pages show.
 * It deliberately does NOT open the vault in the app — no new data model.
 */
export interface VaultPickerModalProps {
  vaults: string[];
  /** The vault whose settings are currently shown (check mark). */
  selected: string;
  /** The vault open in the app (accent dot). */
  activeVaultPath: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export const VaultPickerModal: React.FC<VaultPickerModalProps> = ({ vaults, selected, activeVaultPath, onSelect, onClose }) => {
  const { t } = useTranslation();
  return (
    <Modal onClose={onClose} title={t("settings.vaultSelect", { defaultValue: "Vault wählen" })} size="sm">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }} data-testid="vault-picker-list">
        {vaults.map((v) => {
          const isSelected = v === selected;
          return (
            <button
              key={v}
              type="button"
              className={isSelected ? "pv-navlink is-active" : "pv-navlink"}
              onClick={() => { onSelect(v); onClose(); }}
            >
              <Folder size={15} aria-hidden />
              <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{basename(v)}</span>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 400 }}>{v}</span>
              </span>
              {v === activeVaultPath && <span className="pv-vaultcard-dot" title={t("settings.activeVault")} />}
              {isSelected && <Check size={14} aria-hidden style={{ flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
};
