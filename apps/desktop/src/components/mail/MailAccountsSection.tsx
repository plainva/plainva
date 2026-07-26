import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Button, EmptyState, ICON, SettingCard, SettingCardNote, SettingRow, familyOfMailAccount } from "@plainva/ui";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { CLOUD_ACCOUNTS_EVENT } from "../../services/cloudAccounts";
import { listMailAccounts, mailAccountKind, updateMailAccount, type MailAccountConfig } from "@plainva/ui/mail";
import { AccountMark } from "../settings/cloudAccountsShared";
import { Select } from "../Select";

/** One address per line, blanks dropped. */
function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

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
  // Per-account sending settings (issue #34 round 1). Edited here rather than
  // in the connect wizard: they are not credentials, and changing a signature
  // must never ask for a password again.
  const [sendingId, setSendingId] = useState("");
  const [signature, setSignature] = useState("");
  const [senders, setSenders] = useState("");

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

  // Keep the sending form pointed at a real account and show ITS values. A
  // removed account falls back to the first one instead of editing a ghost.
  useEffect(() => {
    const current = accounts.find((a) => a.id === sendingId) ?? accounts[0];
    if (!current) {
      setSendingId("");
      return;
    }
    if (current.id !== sendingId) setSendingId(current.id);
    setSignature(current.signature ?? "");
    setSenders((current.senders ?? []).join("\n"));
  }, [accounts, sendingId]);

  const persistSending = useCallback(
    async (patch: Partial<MailAccountConfig>) => {
      if (!vaultPath || !sendingId) return;
      await updateMailAccount(vaultPath, sendingId, patch);
      await reload();
    },
    [vaultPath, sendingId, reload]
  );

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

      {accounts.length > 0 && (
        <SettingCard label={t("mail.sendingGroup", { defaultValue: "Senden" })}>
          {accounts.length > 1 && (
            <SettingRow label={t("mail.account", { defaultValue: "Konto" })}>
              <Select
                value={sendingId}
                onChange={setSendingId}
                ariaLabel={t("mail.account", { defaultValue: "Konto" })}
                data-testid="mail-sending-account"
                options={accounts.map((a) => ({ value: a.id, label: a.label || a.user }))}
              />
            </SettingRow>
          )}
          <SettingRow
            label={t("mail.signature", { defaultValue: "Signatur" })}
            desc={t("mail.signatureHint", { defaultValue: "Wird beim Verfassen unter Deinen Text gesetzt. Markdown wie im Editor." })}
            wide
          >
            <textarea
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              onBlur={() => void persistSending({ signature })}
              rows={4}
              className="pv-field pv-field--area"
              data-testid="mail-signature"
              style={{ width: "100%" }}
            />
          </SettingRow>
          <SettingRow
            label={t("mail.senders", { defaultValue: "Weitere Absender-Adressen" })}
            desc={t("mail.sendersHint", { defaultValue: "Eine pro Zeile, z. B. Name <alias@example.org>. Ob eine Adresse akzeptiert wird, entscheidet Dein Anbieter." })}
            wide
          >
            <textarea
              value={senders}
              onChange={(e) => setSenders(e.target.value)}
              onBlur={() => void persistSending({ senders: splitLines(senders) })}
              rows={3}
              className="pv-field pv-field--area"
              data-testid="mail-senders"
              style={{ width: "100%" }}
            />
          </SettingRow>
        </SettingCard>
      )}
    </div>
  );
}
