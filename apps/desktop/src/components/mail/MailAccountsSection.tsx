import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ComposeEditor } from "./ComposeEditor";
import { Users } from "lucide-react";
import { Banner, Button, ChipField, EmptyState, GmailSignInButton, ICON, SettingCard, SettingCardNote, SettingRow, familyOfMailAccount, serviceConnectionMessage, toast } from "@plainva/ui";
import { RulesSettings } from "./RulesSettings";
import { VacationSettings } from "./VacationSettings";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { CLOUD_ACCOUNTS_EVENT, loadCloudAccounts, refreshCloudAccounts } from "../../services/cloudAccounts";
import { appConfirm } from "../../services/appDialogs";
import { desktopGmailClient, signInGmail } from "../../services/mail/gmailAuth";
import { checkMailLogin, listMailAccounts, mailAccountKind, normalizeSenderAddress, senderOptions, setMailPassword, updateMailAccount, orphanedMailServer, useOrphanedMailAccounts, type MailAccountConfig } from "@plainva/ui/mail";
import { deviceSignInStates, type DeviceSignInState } from "../../services/deviceSignIn";
import { AccountMark } from "../settings/cloudAccountsShared";
import { Select } from "../Select";

/** Raw chip input into addresses. A paste of several at once is split on the
 * usual separators; the angle-bracket form `Name <a@b.c>` stays intact. */
function splitAddresses(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * One mailbox row. It stays quiet while the mailbox works: a row only grows an
 * action when this device is missing the password, because that is the single
 * case the user can act on here (P2).
 *
 * A Microsoft mailbox has no password to type — its sign-in is an OAuth consent
 * and belongs to the connect flow, so the row points there instead of offering
 * a field that could never be filled in correctly.
 */
function MailAccountRow({
  vaultPath,
  account,
  signedIn,
  onSignedIn,
  onOpenCloudAccounts,
  signInRequest,
}: {
  vaultPath: string;
  account: MailAccountConfig;
  signedIn: DeviceSignInState;
  onSignedIn: () => void;
  onOpenCloudAccounts?: (accountRef?: string) => void;
  /** Bumped by the incomplete-accounts notice: open this row's sign-in and show it. */
  signInRequest?: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const oauth = mailAccountKind(account) !== "imap";
  const needsSignIn = signedIn !== "active";

  // The notice's "Sign in on this device" lands HERE, in the same flow every
  // unsigned mailbox already offers — not in a second copy of it.
  useEffect(() => {
    if (!signInRequest) return;
    if (!oauth) setOpen(true);
    rowRef.current?.scrollIntoView?.({ block: "center" });
  }, [signInRequest, oauth]);

  const signIn = useCallback(async () => {
    if (!pass) return;
    setBusy(true);
    setError("");
    try {
      // Verify BEFORE storing: a wrong password that lands in the keychain
      // looks exactly like a working one until the next fetch fails, and the
      // failure then reads as a server problem rather than a typo.
      await checkMailLogin(
        { kind: account.kind, host: account.host, port: account.port, user: account.user, smtpHost: account.smtpHost, smtpPort: account.smtpPort },
        pass
      );
      await setMailPassword(vaultPath, account.id, pass);
      setPass("");
      setOpen(false);
      onSignedIn();
    } catch (e) {
      // The same translation as the phone's form: the server's answer word for
      // word, framed as such (finding 2026-09-24).
      setError(serviceConnectionMessage(e, t));
    } finally {
      setBusy(false);
    }
  }, [account, pass, vaultPath, onSignedIn, t]);

  return (
    <>
      <div className="pv-acct" data-testid="mail-account" ref={rowRef}>
        <AccountMark family={familyOfMailAccount({ kind: mailAccountKind(account), user: account.user, host: account.host })} small />
        <div className="pv-acct-who">
          <div className="pv-acct-name">{account.label}</div>
          <div className="pv-acct-id">
            {account.kind === "gmail" ? "Gmail" : oauth ? "Microsoft" : `${account.host}:${account.port}`}
          </div>
        </div>
        {needsSignIn && !oauth && (
          <Button variant="primary" onClick={() => setOpen((v) => !v)} data-testid="mail-signin-open">
            {t("deviceSignIn.action", { defaultValue: "Auf diesem Gerät anmelden" })}
          </Button>
        )}
        {needsSignIn && account.kind !== "gmail" && oauth && onOpenCloudAccounts && (
          <Button variant="primary" onClick={() => onOpenCloudAccounts(account.id)} data-testid="mail-signin-oauth">
            {t("deviceSignIn.action", { defaultValue: "Auf diesem Gerät anmelden" })}
          </Button>
        )}
        {onOpenCloudAccounts && (
          <Button variant="ghost" onClick={() => onOpenCloudAccounts(account.id)}>
            {t("cloudAccounts.manageAccount")}
          </Button>
        )}
      </div>
      {needsSignIn && account.kind === "gmail" && desktopGmailClient() && <GmailSignInButton onSignIn={async () => {
        const record = (await loadCloudAccounts(vaultPath)).find(row => row.services.mail?.mailAccountId === account.id);
        if (!record) throw new Error("The account changed during sign-in");
        await signInGmail(vaultPath, record); onSignedIn();
      }} />}
      {/* The description is deliberately the SAME sentence the phone shows for
          the same situation — two surfaces explaining one fact in two wordings
          is how they drift apart. */}
      {needsSignIn && open && !oauth && (
        <SettingRow
          label={t("mail.password", { defaultValue: "Passwort" })}
          desc={t("deviceSignIn.cardBodyStatic")}
        >
          <input
            type="password"
            autoComplete="off"
            className="pv-field"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void signIn();
            }}
            data-testid="mail-signin-password"
            style={{ width: 180 }}
          />
          <Button variant="primary" disabled={busy || !pass} onClick={() => void signIn()} data-testid="mail-signin-submit">
            {busy ? t("common.loading", { defaultValue: "Lädt …" }) : t("deviceSignIn.submit", { defaultValue: "Anmelden" })}
          </Button>
        </SettingRow>
      )}
      {error && (
        <SettingCardNote>
          <span data-testid="mail-signin-error">{error}</span>
        </SettingCardNote>
      )}
    </>
  );
}

/**
 * The one-time notice about incomplete mail accounts (finding 2026-09-24, E4):
 * entries a failed setup left behind — no password, never a fetch. The rule and
 * the removal live in the shared hook; this renders it with the desktop's
 * account rows and asks the desktop's confirmation. Never removes by itself.
 */
export function OrphanedMailNotice({ vaultPath, reloadToken, onRemoved, onSignIn }: {
  vaultPath: string;
  reloadToken: number;
  onRemoved: () => void;
  /** The mailbox's own sign-in — the right choice when it works on another device. */
  onSignIn: (account: MailAccountConfig) => void;
}) {
  const { t } = useTranslation();
  const { dbAdapter, pimRuntime } = useVault();
  const notice = useOrphanedMailAccounts(vaultPath, dbAdapter, reloadToken);
  const [open, setOpen] = useState(false);
  if (!notice.visible) return null;

  const remove = async (account: MailAccountConfig) => {
    const label = account.label || account.user;
    const ok = await appConfirm({
      title: t("mail.orphans.confirmTitle"),
      message: t("mail.orphans.confirmMessage", { label }),
      confirmLabel: t("mail.orphans.remove"),
      kind: "danger",
    });
    if (!ok) return;
    try {
      const result = await notice.remove(account);
      toast.success(t(result === "removed" ? "mail.orphans.removed" : "mail.orphans.keptSignedIn"));
      // The card that referenced it loses the reference, exactly as after any
      // other removal of a mailbox.
      await refreshCloudAccounts(vaultPath, pimRuntime ?? null).catch(() => undefined);
      onRemoved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Banner
        kind="warning"
        rounded
        actions={
          <>
            <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="mail-orphans-review">
              {t("mail.orphans.review")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void notice.later()} data-testid="mail-orphans-later">
              {t("mail.orphans.later")}
            </Button>
          </>
        }
      >
        <strong>{t("mail.orphans.title", { count: notice.orphans.length })}</strong> {t("mail.orphans.body")}
      </Banner>
      {open &&
        notice.orphans.map((account) => (
          <div className="pv-acct" data-testid="mail-orphan" key={account.id}>
            <AccountMark family={familyOfMailAccount({ kind: mailAccountKind(account), user: account.user, host: account.host })} small />
            <div className="pv-acct-who">
              <div className="pv-acct-name">{account.label || account.user}</div>
              <div className="pv-acct-id">{t("mail.orphans.rowMeta", { server: orphanedMailServer(account) })}</div>
            </div>
            <Button variant="primary" onClick={() => onSignIn(account)} data-testid="mail-orphan-signin">
              {t("deviceSignIn.action")}
            </Button>
            <Button variant="danger-soft" onClick={() => void remove(account)} data-testid="mail-orphan-remove">
              {t("mail.orphans.remove")}
            </Button>
          </div>
        ))}
    </>
  );
}

/**
 * The "E-Mail" service page content (cloud-accounts split): mailbox REFERENCES
 * plus the capture/privacy behavior. Connecting and removing mailboxes lives
 * in the Cloud-Konten area (connect wizard / account detail).
 */

export function MailAccountsSection({ onOpenCloudAccounts }: { onOpenCloudAccounts?: (accountRef?: string) => void }) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [mailFolder, setMailFolder] = useState("");
  // Per-account sending settings (issue #34 round 1). Edited here rather than
  // in the connect wizard: they are not credentials, and changing a signature
  // must never ask for a password again.
  const [sendingId, setSendingId] = useState("");
  const [signature, setSignature] = useState("");
  const [senders, setSenders] = useState<string[]>([]);
  // Findings round P8.2: which address the signature editor is pointed at. ""
  // means the account default — the value every address without its own
  // signature uses, and the only one an existing account has.
  const [sigAddress, setSigAddress] = useState("");

  // P2: which mailboxes actually have a credential ON THIS DEVICE. Account
  // metadata travels with the settings sync, passwords deliberately do not — so
  // a synced mailbox is normally present here but not signed in, and until now
  // the only sign of that was a raw exception the moment someone opened it.
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());

  const loadSignIn = useCallback(
    async (list: MailAccountConfig[]) => {
      if (!vaultPath) return;
      setSignIn(await deviceSignInStates("mail", vaultPath, list.map((a) => a.id)));
    },
    [vaultPath]
  );

  // "Sign in on this device" from the incomplete-accounts notice: a Microsoft
  // mailbox signs in through Cloud accounts, every other one opens its own row.
  const [signInRequest, setSignInRequest] = useState<{ id: string; n: number } | null>(null);
  const signInHere = useCallback(
    (account: MailAccountConfig) => {
      if (mailAccountKind(account) === "microsoft") {
        onOpenCloudAccounts?.(account.id);
        return;
      }
      setSignInRequest((prev) => ({ id: account.id, n: (prev?.n ?? 0) + 1 }));
    },
    [onOpenCloudAccounts]
  );

  // Bumped on every reload, so the orphan notice re-checks after a sign-in or
  // a removal instead of offering an entry that just changed.
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(async () => {
    if (!vaultPath) return;
    const list = await listMailAccounts(vaultPath);
    setAccounts(list);
    setReloads((n) => n + 1);
    await loadSignIn(list);
  }, [vaultPath, loadSignIn]);

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
    if (current.id !== sendingId) {
      setSendingId(current.id);
      setSigAddress(""); // a different account starts at its default again
    }
    setSenders(current.senders ?? []);
  }, [accounts, sendingId]);

  // The editor always shows the signature of the SELECTED address; switching the
  // address must not carry the previous text over (that would overwrite one
  // signature with another on the next blur).
  const sendingAccount = useMemo(() => accounts.find((a) => a.id === sendingId) ?? null, [accounts, sendingId]);
  useEffect(() => {
    if (!sendingAccount) return;
    setSignature(
      sigAddress
        ? (sendingAccount.signatures?.[normalizeSenderAddress(sigAddress)] ?? "")
        : (sendingAccount.signature ?? ""),
    );
  }, [sendingAccount, sigAddress]);


  const persistSending = useCallback(
    async (patch: Partial<MailAccountConfig>) => {
      if (!vaultPath || !sendingId) return;
      await updateMailAccount(vaultPath, sendingId, patch);
      await reload();
    },
    [vaultPath, sendingId, reload]
  );

  /**
   * Saves the signature to the selected address, or to the account default.
   * An emptied per-address signature is REMOVED rather than stored as "" — the
   * address then falls back to the default, which is what "no own signature"
   * means.
   */
  const persistSignature = useCallback(
    async (text: string) => {
      if (!sendingAccount) return;
      if (!sigAddress) {
        await persistSending({ signature: text });
        return;
      }
      const key = normalizeSenderAddress(sigAddress);
      const next = { ...(sendingAccount.signatures ?? {}) };
      if (text.trim()) next[key] = text;
      else delete next[key];
      await persistSending({ signatures: next });
    },
    [sendingAccount, sigAddress, persistSending],
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
        <OrphanedMailNotice vaultPath={vaultPath} reloadToken={reloads} onRemoved={() => void reload()} onSignIn={signInHere} />
        {desktopGmailClient() && <GmailSignInButton onSignIn={async () => { await signInGmail(vaultPath); await reload(); }} />}
        {accounts.length === 0 && (
          <EmptyState title={t("mail.noAccounts", { defaultValue: "Noch kein E-Mail-Konto verbunden." })} icon={<Users size={ICON.empty} />}>
            {onOpenCloudAccounts && (
              <Button variant="primary" onClick={() => onOpenCloudAccounts()} data-testid="mail-open-cloudaccounts">
                {t("cloudAccounts.openArea")}
              </Button>
            )}
          </EmptyState>
        )}
        {accounts.map((account) => (
          <MailAccountRow
            key={account.id}
            vaultPath={vaultPath}
            account={account}
            signedIn={signIn.get(account.id) ?? "active"}
            onSignedIn={() => void reload()}
            onOpenCloudAccounts={onOpenCloudAccounts}
            signInRequest={signInRequest?.id === account.id ? signInRequest.n : undefined}
          />
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

      {/* The out-of-office notice belongs to the SENDING account, so it sits
          right below the account picker it shares (S13). */}
      {accounts.length > 0 && <RulesSettings vaultPath={vaultPath} account={sendingAccount ?? null} />}
      {accounts.length > 0 && <VacationSettings vaultPath={vaultPath} account={sendingAccount ?? null} />}

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
          {/* P8.2: one signature per sender address. The switcher only appears
              when there IS more than one address — a single-address account keeps
              exactly the surface it had. "Standard" is the account default, i.e.
              what every address without its own signature uses. */}
          {sendingAccount && senderOptions(sendingAccount).length > 1 && (
            <SettingRow
              label={t("mail.signatureAddress", { defaultValue: "Signatur für" })}
              desc={t("mail.signatureAddressHint", {
                defaultValue: "Adressen ohne eigene Signatur nutzen die Standard-Signatur.",
              })}
            >
              <Select
                value={sigAddress}
                onChange={setSigAddress}
                ariaLabel={t("mail.signatureAddress", { defaultValue: "Signatur für" })}
                data-testid="mail-signature-address"
                options={[
                  { value: "", label: t("mail.signatureDefault", { defaultValue: "Standard (alle Adressen)" }) },
                  ...senderOptions(sendingAccount).map((address) => ({
                    value: address,
                    label: sendingAccount.signatures?.[normalizeSenderAddress(address)]
                      ? `${address} ✓`
                      : address,
                  })),
                ]}
              />
            </SettingRow>
          )}
          <SettingRow
            label={t("mail.signature", { defaultValue: "Signatur" })}
            desc={t("mail.signatureHint", { defaultValue: "Wird beim Verfassen unter Deinen Text gesetzt. Markdown wie im Editor." })}
            wide
          >
            {/* The same editor the compose window uses (E4): a signature is
                written once and then appears under every message, so it is the
                worst place to leave someone guessing how their markup will come
                out. Saved on blur, exactly as the textarea did. */}
            <div onBlur={() => void persistSignature(signature)}>
              <ComposeEditor value={signature} onChange={setSignature} resizable data-testid="mail-signature" />
            </div>
          </SettingRow>
          <SettingRow
            label={t("mail.senders", { defaultValue: "Weitere Absender-Adressen" })}
            desc={t("mail.sendersHint", {
              defaultValue:
                "Mit Enter bestätigen. Beim Verfassen stehen sie im Absender-Menü. Ob eine Adresse akzeptiert wird, entscheidet Dein Anbieter.",
            })}
            wide
          >
            <ChipField
              values={senders}
              onChange={(next) => {
                setSenders(next);
                void persistSending({ senders: next });
              }}
              parse={splitAddresses}
              removeLabel={(value) => t("mail.senderRemove", { defaultValue: "Absender entfernen: {{email}}", email: value })}
              placeholder={t("mail.sendersPlaceholder", { defaultValue: "Name <alias@example.org>" })}
              testId="mail-senders"
              ariaLabel={t("mail.senders", { defaultValue: "Weitere Absender-Adressen" })}
            />
          </SettingRow>
        </SettingCard>
      )}
    </div>
  );
}
