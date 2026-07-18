import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { toast, Button, IconButton } from "@plainva/ui";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { appConfirm } from "../../services/appDialogs";
import { listMailAccounts, saveMailAccount, removeMailAccount, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { checkMailLogin } from "../../services/mail/mailClient";
import { MAIL_PRESETS, presetById, presetForEmail } from "../../services/mail/mailPresets";
import { Select } from "../Select";

/**
 * Settings block "E-Mail (IMAP, nur Lesen)" (PIM stage 5): read-only IMAP
 * accounts for the mail-capture tab. Connect validates by actually logging
 * in and listing mailboxes — nothing persists on failure. Gmail works with
 * an app password (imap.gmail.com:993), which needs NO Google verification.
 */

export function MailAccountsSection() {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [presetId, setPresetId] = useState("custom");
  const [mailFolder, setMailFolder] = useState("");

  // Preset picker (E2): fill IMAP + SMTP host/port for a known provider.
  const applyPreset = useCallback((id: string) => {
    setPresetId(id);
    const p = presetById(id);
    if (!p) return;
    setHost(p.host);
    setPort(String(p.port));
    setSmtpHost(p.smtpHost);
    setSmtpPort(String(p.smtpPort));
  }, []);

  // Typing the email: if nothing is filled yet, guess the provider from its domain.
  const guessFromEmail = useCallback(
    (email: string) => {
      if (host.trim() || presetId !== "custom") return;
      const p = presetForEmail(email);
      if (p) applyPreset(p.id);
    },
    [host, presetId, applyPreset]
  );

  const reload = useCallback(async () => {
    if (!vaultPath) return;
    setAccounts(await listMailAccounts(vaultPath));
  }, [vaultPath]);

  useEffect(() => {
    void reload();
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

  const connect = useCallback(async () => {
    if (!vaultPath || busy) return;
    const h = host.trim();
    const u = user.trim();
    const p = Number(port) || 993;
    if (!h || !u || !pass) {
      setError(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Validate BEFORE persisting anything (list mailboxes = real login).
      await checkMailLogin({ host: h, port: p, user: u }, pass);
      const id = crypto.randomUUID().slice(0, 8);
      const sh = smtpHost.trim();
      const sp = Number(smtpPort) || 587;
      await saveMailAccount(
        vaultPath,
        { id, label: u, host: h, port: p, user: u, ...(sh ? { smtpHost: sh, smtpPort: sp } : {}) },
        pass
      );
      setShowAdd(false);
      setPass("");
      setPresetId("custom");
      await reload();
      toast.info(t("pim.connected", { defaultValue: "Konto verbunden." }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultPath, busy, host, port, smtpHost, smtpPort, user, pass, reload, t]);

  const remove = useCallback(
    async (account: MailAccountConfig) => {
      if (!vaultPath) return;
      const ok = await appConfirm({
        title: t("pim.removeAccount", { defaultValue: "Konto entfernen" }),
        message: t("pim.removeAccountMsg", { defaultValue: "„{{label}}“ wird aus diesem Vault entfernt. Beim Anbieter wird nichts gelöscht.", label: account.label }),
        kind: "danger",
      });
      if (!ok) return;
      await removeMailAccount(vaultPath, account.id);
      await reload();
    },
    [vaultPath, reload, t]
  );

  if (!vaultPath) return null;

  return (
    <div data-testid="mail-accounts">
      {accounts.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.6rem" }}>
          {t("mail.noAccounts", { defaultValue: "Noch kein E-Mail-Konto verbunden." })}
        </p>
      )}
      {accounts.map((account) => (
        <div key={account.id} data-testid="mail-account" style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.45rem 0.75rem", marginBottom: "0.5rem" }}>
          <strong style={{ fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.label}</strong>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {account.host}:{account.port}
          </span>
          <IconButton label={t("pim.removeAccount", { defaultValue: "Konto entfernen" })} onClick={() => void remove(account)}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}

      <Button variant="secondary" data-testid="mail-add-account" onClick={() => setShowAdd((v) => !v)} style={{ marginBottom: "0.5rem" }}>
        {t("pim.addAccount", { defaultValue: "Konto hinzufügen…" })}
      </Button>

      {showAdd && (
        <div data-testid="mail-add-form" style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.6rem 0.75rem" }}>
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.4rem" }}>
            {t("mail.imapHint", { defaultValue: "Nur Lesen — Plainva ändert nichts im Postfach. Gmail: imap.gmail.com, Port 993, mit App-Passwort." })}
          </p>
          <div style={{ marginBottom: "0.4rem", maxWidth: "20rem" }} data-testid="mail-provider">
            <Select
              ariaLabel={t("mail.provider", { defaultValue: "Anbieter" })}
              value={presetId}
              onChange={applyPreset}
              options={[
                { value: "custom", label: t("mail.customProvider", { defaultValue: "Anderer Anbieter" }) },
                ...MAIL_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
          </div>
          <input autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} onBlur={() => guessFromEmail(user)} placeholder={t("mail.emailAddress", { defaultValue: "E-Mail-Adresse" })} className="pv-field" data-testid="mail-user" style={{ width: "100%", marginBottom: "0.4rem" }} />
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.4rem" }}>
            <input autoComplete="off" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" className="pv-field" data-testid="mail-imap-host" style={{ flex: 1 }} />
            <input autoComplete="off" value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" className="pv-field" aria-label={t("mail.imapPort", { defaultValue: "IMAP-Port" })} style={{ width: "6rem" }} />
          </div>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.4rem" }}>
            <input autoComplete="off" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="pv-field" data-testid="mail-smtp-host" style={{ flex: 1 }} />
            <input autoComplete="off" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" className="pv-field" aria-label={t("mail.smtpPort", { defaultValue: "SMTP-Port" })} style={{ width: "6rem" }} />
          </div>
          <input autoComplete="off" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={t("pim.davPass", { defaultValue: "App-Passwort" })} className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
          {error && <p style={{ color: "var(--error-text)", fontSize: "0.8rem", margin: "0.2rem 0" }}>{error}</p>}
          <Button variant="primary" data-testid="mail-connect" disabled={busy} onClick={() => void connect()}>
            {busy ? t("pim.connecting", { defaultValue: "Verbinde…" }) : t("pim.connect", { defaultValue: "Verbinden" })}
          </Button>
        </div>
      )}

      <div style={{ marginTop: "0.6rem" }}>
        <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 2 }}>
          {t("mail.folder", { defaultValue: "E-Mail-Ordner" })}
        </label>
        <input
          autoComplete="off"
          value={mailFolder}
          onChange={(e) => setMailFolder(e.target.value)}
          onBlur={() => void persistMailFolder()}
          placeholder={DEFAULT_MAIL_FOLDER}
          className="pv-field"
          data-testid="mail-folder"
          style={{ width: "100%", maxWidth: "20rem" }}
        />
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          {t("mail.folderHint", { defaultValue: "Ablage für abgelegte E-Mails (Notizen und .eml-Dateien)." })}
        </p>
      </div>

      <div style={{ marginTop: "0.6rem" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={remoteImages}
            onChange={(e) => void persistRemoteImages(e.target.checked)}
            data-testid="mail-remote-images"
          />
          {t("mail.loadRemoteImages", { defaultValue: "Externe Bilder immer laden" })}
        </label>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          {t("mail.loadRemoteImagesHint", {
            defaultValue:
              "Beim Laden externer Bilder sieht der Absender Deine IP-Adresse und wann Du die Mail geöffnet hast (Tracking). Standardmäßig blockiert Plainva sie — pro Nachricht lassen sie sich über „Bilder anzeigen“ einblenden.",
          })}
        </p>
      </div>
    </div>
  );
}
