import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Button, EmptyState, ICON, SettingCard, SettingCardNote, SettingRow, familyOfMailAccount } from "@plainva/ui";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { CLOUD_ACCOUNTS_EVENT } from "../../services/cloudAccounts";
import { listMailAccounts, mailAccountKind, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { AccountMark } from "../settings/cloudAccountsShared";

/**
 * The "E-Mail" service page content (cloud-accounts split): mailbox REFERENCES
 * plus the capture/privacy behavior. Connecting and removing mailboxes lives
 * in the Cloud-Konten area (connect wizard / account detail).
 */

export function MailAccountsSection({ onOpenCloudAccounts }: { onOpenCloudAccounts?: () => void }) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [mailFolder, setMailFolder] = useState("");

  const reload = useCallback(async () => {
    if (!vaultPath) return;
    setAccounts(await listMailAccounts(vaultPath));
  }, [vaultPath]);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    window.addEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
    return () => window.removeEventListener(CLOUD_ACCOUNTS_EVENT, onChanged);
  }, [reload]);

  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = (await store.get<string>(mailFolderKey(vaultPath))) ?? "";
      if (alive) setMailFolder(v);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  const persistMailFolder = useCallback(async () => {
    if (!vaultPath) return;
    const store = await getSettingsStore();
    await store.set(mailFolderKey(vaultPath), mailFolder.trim());
    await store.save();
  }, [vaultPath, mailFolder]);

  // Remote-image opt-in (default OFF — loading remote images is tracking).
  const [remoteImages, setRemoteImages] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = await store.get<boolean>(mailRemoteImagesKey(vaultPath));
      if (alive) setRemoteImages(v === true);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);
  const persistRemoteImages = useCallback(
    async (value: boolean) => {
      if (!vaultPath) return;
      setRemoteImages(value);
      const store = await getSettingsStore();
      await store.set(mailRemoteImagesKey(vaultPath), value);
      await store.save();
      window.dispatchEvent(new CustomEvent("plainva-mail-settings-changed"));
    },
    [vaultPath]
  );

  if (!vaultPath) return null;

  return (
    <div data-testid="mail-accounts">
      <SettingCard label={t("cloudAccounts.mailboxesGroup")}>
        {accounts.length === 0 && (
          <EmptyState title={t("mail.noAccounts", { defaultValue: "Noch kein E-Mail-Konto verbunden." })} icon={<Users size={ICON.empty} />}>
            {onOpenCloudAccounts && (
              <Button variant="primary" onClick={onOpenCloudAccounts} data-testid="mail-open-cloudaccounts">
                {t("cloudAccounts.openArea")}
              </Button>
            )}
          </EmptyState>
        )}
        {accounts.map((account) => (
          <div key={account.id} className="pv-acct" data-testid="mail-account">
            <AccountMark family={familyOfMailAccount({ kind: mailAccountKind(account), user: account.user, host: account.host })} small />
            <div className="pv-acct-who">
              <div className="pv-acct-name">{account.label}</div>
              <div className="pv-acct-id">
                {mailAccountKind(account) === "microsoft" ? "Microsoft" : `${account.host}:${account.port}`}
              </div>
            </div>
            {onOpenCloudAccounts && (
              <Button variant="ghost" onClick={onOpenCloudAccounts}>
                {t("cloudAccounts.manageAccount")}
              </Button>
            )}
          </div>
        ))}
      </SettingCard>

      <SettingCard label={t("cloudAccounts.mailCaptureGroup")}>
        <SettingRow label={t("mail.folder", { defaultValue: "E-Mail-Ordner" })} desc={t("mail.folderHint", { defaultValue: "Ablage für abgelegte E-Mails (Notizen und .eml-Dateien)." })}>
          <input
            autoComplete="off"
            value={mailFolder}
            onChange={(e) => setMailFolder(e.target.value)}
            onBlur={() => void persistMailFolder()}
            placeholder={DEFAULT_MAIL_FOLDER}
            className="pv-field"
            data-testid="mail-folder"
            style={{ width: 180 }}
          />
        </SettingRow>
        <SettingRow label={t("mail.loadRemoteImages", { defaultValue: "Externe Bilder immer laden" })}>
          <input
            type="checkbox"
            checked={remoteImages}
            onChange={(e) => void persistRemoteImages(e.target.checked)}
            data-testid="mail-remote-images"
            className="pv-check"
          />
        </SettingRow>
        <SettingCardNote>
          {t("mail.loadRemoteImagesHint", {
            defaultValue:
              "Beim Laden externer Bilder sieht der Absender Deine IP-Adresse und wann Du die Mail geöffnet hast (Tracking). Standardmäßig blockiert Plainva sie — pro Nachricht lassen sie sich über „Bilder anzeigen“ einblenden.",
          })}
        </SettingCardNote>
      </SettingCard>
    </div>
  );
}
