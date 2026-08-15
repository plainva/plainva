import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Cloud, FolderClosed, FolderPlus } from "lucide-react";
import { listVaults, type VaultEntry } from "../services/vaultRegistry";
import { switchVault } from "../services/vaultService";
import { GroupCard, ICON, IconButton, Row, RowList, SectionLabel } from "@plainva/ui";
import { AppBar } from "../components/AppBar";

/**
 * Vault management inside the settings (redesign 2026-07-18, P4): the list of
 * known vaults — the ACTIVE one carries a check mark, tapping another one
 * switches (the established switchVault flow), the chevron opens the vault's
 * detail screen.
 *
 * Creating a vault lives here; SIGNING IN does not (H3). Cloud accounts is the
 * one place for connections — files, calendar and mail together — so this
 * screen points there instead of offering a second, files-only door into the
 * same flow.
 */
export function VaultsScreen({
  activeVaultId,
  onBack,
  onOpenVault,
  onCreateVault,
  onOpenCloudAccounts,
}: {
  activeVaultId: string;
  onBack: () => void;
  onOpenVault: (id: string) => void;
  onCreateVault: () => void;
  onOpenCloudAccounts: () => void;
}) {
  const { t } = useTranslation();
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  useEffect(() => {
    const reload = () => void listVaults().then(setVaults);
    reload();
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [activeVaultId]);

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mobile.vaults")} />
      <div className="m-settings">
        <SectionLabel>{t("settings.vaultSelect", { defaultValue: "Vault wählen" })}</SectionLabel>
        {/* A list of vaults is a list of rows, so it is a card — the rows used
            to stand loose on the page, each drawing its own left edge beside
            the cards on every other settings screen. */}
        <GroupCard>
          <RowList>
            {vaults.map((v) => {
              const active = v.id === activeVaultId;
              return (
                <Row
                  controls
                  end={
                    <IconButton
                      data-testid="vault-details"
                      label={t("mobile.vaultDetails")}
                      onClick={() => onOpenVault(v.id)}
                    >
                      <ChevronRight className="m-chevron" size={ICON.head} />
                    </IconButton>
                  }
                  icon={<FolderClosed className={active ? "m-accent" : "m-chevron"} size={ICON.head} />}
                  key={v.id}
                  // The active vault has nothing to switch to.
                  onClick={active ? undefined : () => void switchVault(v.id)}
                  title={
                    <>
                      {v.name || t("mobile.vaultLocal")}
                      {active && <Check className="m-accent" size={ICON.head} />}
                    </>
                  }
                />
              );
            })}
          </RowList>
        </GroupCard>

        <SectionLabel>{t("mobile.vaultAddSection")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              icon={<FolderPlus className="m-accent" size={ICON.head} />}
              onClick={onCreateVault}
              title={t("mobile.vaultCreate")}
            />
            <Row
              data-testid="vaults-to-cloud-accounts"
              icon={<Cloud className="m-accent" size={ICON.head} />}
              onClick={onOpenCloudAccounts}
              title={t("mobile.vaultAdd")}
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("mobile.vaultAddViaCloudAccounts")}</p>
      </div>
    </div>
  );
}
