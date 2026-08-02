import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button, IconButton, TextInput, toast } from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";
import { checkMailLogin, getMailPassword, mailAccountKind, normalizeSenderAddress, saveMailAccount, senderOptions, updateMailAccount } from "@plainva/ui/mail";
import { MailImapForm, type ImapFormValues } from "./mail/MailImapForm";
import { mConfirm, mSelect } from "../services/mobileDialogs";
import {
  connectMicrosoftMail,
  listMobileMailAccounts,
  mailVaultId,
  removeMobileMailAccount,
  MAIL_CHANGED_EVENT,
} from "../services/mail/mailRuntime";
import { deviceSignInStates, type DeviceSignInState } from "../services/deviceSignIn";
import { notifyMailChanged } from "../services/mail/mailRuntime";
import { hasNativeMailSocket } from "../adapters/mailNet";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";

/**
 * Mobile mail accounts (mail feinplan G1). Stage one connects Microsoft only:
 * Graph is plain HTTPS and rides the bridge the sync already uses, while
 * IMAP/SMTP need raw TLS sockets and therefore the native plugin from G2.
 * The screen says that outright instead of offering a form that would fail.
 *
 * Accounts are the same records the desktop writes (settings store + secure
 * store); a mailbox that arrived through the settings sync shows the shared
 * "sign in on this device" badge, because credentials never travel.
 */
export function MailAccountsScreen({ bump, onBack }: { bump: number; onBack?: () => void }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  // Microsoft uses the shipped central client id; the field stays empty and
  // hidden (never expose our app id) unless the user brings their own.
  const [msClientId, setMsClientId] = useState("");
  const [msShowId, setMsShowId] = useState(false);
  const [busy, setBusy] = useState(false);
  // Per-account sending settings (issue #34 round 1): signature and the
  // additional sender addresses. Not credentials — editing them must never ask
  // for the password again, so they go through the metadata-only update.
  const [sendingId, setSendingId] = useState("");
  const [signature, setSignature] = useState("");
  const [senders, setSenders] = useState("");
  // P8.2: which address the signature field is pointed at. "" = the account
  // default, which every address without its own signature uses.
  const [sigAddress, setSigAddress] = useState("");
  // IMAP sign-in (G2): the address picks the preset, so the usual case is
  // address + app password and nothing else.
  const [kind, setKind] = useState<"microsoft" | "imap">("microsoft");
  /** Account being edited (B4) — the same form serves adding and editing. */
  const [editing, setEditing] = useState<MailAccountConfig | null>(null);
  const imapAvailable = hasNativeMailSocket();

  const reload = useCallback(() => {
    void listMobileMailAccounts()
      .then(async (rows) => {
        setAccounts(rows);
        const vault = mailVaultId();
        setSignIn(vault ? await deviceSignInStates("mail", vault, rows.map((r) => r.id)) : new Map());
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => { reload(); }, [reload, bump]);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener(MAIL_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MAIL_CHANGED_EVENT, onChanged);
  }, [reload]);

  // Keep the sending form on a real account and show ITS values; a removed
  // account falls back to the first one instead of editing a ghost.
  const sendingAccount = accounts.find((a) => a.id === sendingId) ?? accounts[0] ?? null;
  useEffect(() => {
    if (!sendingAccount) {
      setSendingId("");
      return;
    }
    if (sendingAccount.id !== sendingId) setSendingId(sendingAccount.id);
    setSignature(sendingAccount.signature ?? "");
    setSenders((sendingAccount.senders ?? []).join("\n"));
  }, [sendingAccount, sendingId]);

  const persistSending = useCallback(
    async (patch: Partial<MailAccountConfig>) => {
      const vault = mailVaultId();
      if (!vault || !sendingAccount) return;
      await updateMailAccount(vault, sendingAccount.id, patch);
      notifyMailChanged();
    },
    [sendingAccount]
  );

  const pickSendingAccount = () => {
    void mSelect({
      title: t("mail.account", { defaultValue: "Konto" }),
      options: accounts.map((a) => ({ value: a.id, label: a.label || a.user })),
      value: sendingId,
    }).then((v) => {
      if (v !== null) setSendingId(v);
    });
  };

  /** Saves to the selected address, or to the account default. An emptied
   * per-address signature is REMOVED, so the address falls back to the default —
   * which is what "no own signature" means. */
  const persistSignature = async (text: string) => {
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
  };

  const pickSignatureAddress = () => {
    if (!sendingAccount) return;
    void mSelect({
      title: t("mail.signatureAddress", { defaultValue: "Signatur für" }),
      options: [
        { value: "", label: t("mail.signatureDefault", { defaultValue: "Standard (alle Adressen)" }) },
        ...senderOptions(sendingAccount).map((address) => ({
          value: address,
          label: sendingAccount.signatures?.[normalizeSenderAddress(address)] ? `${address} ✓` : address,
        })),
      ],
      value: sigAddress,
    }).then((v) => {
      if (v !== null) setSigAddress(v);
    });
  };

  const connect = async () => {
    setBusy(true);
    try {
      await connectMicrosoftMail(msClientId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Adds a new IMAP mailbox, or saves an edited one (B4). */
  const submitImap = async (v: ImapFormValues) => {
    const vault = mailVaultId();
    if (!vault) return;
    setBusy(true);
    try {
      // An untouched password field means "keep the stored one" — changing a
      // server address must not cost the user their app password.
      const password = v.pass || (editing ? ((await getMailPassword(vault, editing.id)) ?? "") : "");
      if (!password) throw new Error(t("mail.passwordMissing"));
      const account: MailAccountConfig = {
        id: editing?.id ?? crypto.randomUUID(),
        label: v.label,
        host: v.host,
        port: v.port,
        user: v.user,
        smtpHost: v.smtpHost || undefined,
        smtpPort: v.smtpHost ? v.smtpPort : undefined,
        kind: "imap",
      };
      // Verify before storing: a rejected password must not leave a broken
      // account behind (the same guarantee the Microsoft path gives) — and an
      // edit must not break a mailbox that worked a moment ago.
      await checkMailLogin({ host: account.host, port: account.port, user: account.user, kind: "imap" }, password);
      await saveMailAccount(vault, account, password);
      setEditing(null);
      toast.success(t(editing ? "mail.accountSaved" : "mail.accountAdded"));
      notifyMailChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: MailAccountConfig) => {
    if (!(await mConfirm({ title: t("mail.removeAccountConfirm"), message: a.label, danger: true }))) return;
    try {
      await removeMobileMailAccount(a.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="m-page">
      <header className="m-header">
        {onBack && (
          <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
            <ChevronLeft size={20} />
          </IconButton>
        )}
        <h1>{t("mail.accounts", { defaultValue: "Postfächer" })}</h1>
      </header>

      <div className="m-sync">
        {/* Same truth as the calendar screen: settings sync, sign-ins do not. */}
        <p className="m-hint">{t("pim.perDeviceHint")}</p>

        {accounts.length === 0 ? (
          <p className="m-hint">{t("mail.noAccounts")}</p>
        ) : (
          accounts.map((a) => {
            const state = signIn.get(a.id) ?? "active";
            const imap = mailAccountKind(a) === "imap";
            return (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <div className="m-row m-acct" data-testid={`mail-account-${a.id}`}>
                  <span className="m-acct-name">{a.label}</span>
                  <DeviceSignInBadge state={state} />
                  <span className="m-acct-provider">{imap ? "IMAP" : "Microsoft"}</span>
                  {imap && (
                    /* Editing an existing mailbox (B4) — a server move used to
                       mean removing the account and adding it again. */
                    <IconButton label={t("common.edit")} onClick={() => { setKind("imap"); setEditing(a); }}>
                      <Pencil size={16} />
                    </IconButton>
                  )}
                  <IconButton
                    label={t("mail.removeAccount", { defaultValue: "Postfach entfernen" })}
                    onClick={() => void remove(a)}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
                {imap && !imapAvailable ? (
                  /* Only the web dev server lacks a socket; on a device IMAP
                     works and the row needs no caveat. */
                  <p className="m-hint m-acct-hint">{t("mail.imapMobileUnavailable")}</p>
                ) : (
                  state === "signin" && (
                    <p className="m-hint m-acct-hint">
                      {imap ? t("deviceSignIn.rowHintStatic") : t("deviceSignIn.rowHintOauth")}
                    </p>
                  )
                )}
              </div>
            );
          })
        )}

        {accounts.length > 0 && (
          <>
            <h2 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "20px 0 8px" }}>
              {t("mail.sendingGroup", { defaultValue: "Senden" })}
            </h2>
            {accounts.length > 1 && (
              <button className="m-row" onClick={pickSendingAccount}>
                <span>{t("mail.account", { defaultValue: "Konto" })}</span>
                <span className="m-prop-val">{sendingAccount?.label || sendingAccount?.user}</span>
                <ChevronRight className="m-chevron" size={18} />
              </button>
            )}
            {sendingAccount && senderOptions(sendingAccount).length > 1 && (
              <button className="m-row" onClick={pickSignatureAddress} data-testid="mail-signature-address">
                <span>{t("mail.signatureAddress", { defaultValue: "Signatur für" })}</span>
                <span className="m-prop-val">
                  {sigAddress || t("mail.signatureDefault", { defaultValue: "Standard (alle Adressen)" })}
                </span>
                <ChevronRight className="m-chevron" size={18} />
              </button>
            )}
            <label className="m-field">
              <span>{t("mail.signature", { defaultValue: "Signatur" })}</span>
              <textarea
                rows={4}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                onBlur={() => void persistSignature(signature)}
                data-testid="mail-signature"
              />
            </label>
            <p className="m-hint">{t("mail.signatureHint")}</p>
            <label className="m-field">
              <span>{t("mail.senders", { defaultValue: "Weitere Absender-Adressen" })}</span>
              <textarea
                rows={3}
                value={senders}
                onChange={(e) => setSenders(e.target.value)}
                onBlur={() => void persistSending({ senders: senders.split("\n").map((l) => l.trim()).filter(Boolean) })}
                data-testid="mail-senders"
              />
            </label>
            <p className="m-hint">{t("mail.sendersHint")}</p>
          </>
        )}

        <h2 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "20px 0 8px" }}>
          {editing ? t("common.edit") : t("mail.addAccount", { defaultValue: "Postfach hinzufügen" })}
        </h2>
        {!editing && (
          <div className="m-viewpills" role="tablist">
            {(["microsoft", "imap"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={kind === k ? "m-viewpill is-active" : "m-viewpill"}
                onClick={() => setKind(k)}
              >
                {k === "microsoft" ? "Microsoft" : "IMAP"}
              </button>
            ))}
          </div>
        )}

        {kind === "imap" ? (
          <MailImapForm
            key={editing?.id ?? "new"}
            available={imapAvailable}
            busy={busy}
            editing={editing ?? undefined}
            onCancel={editing ? () => setEditing(null) : undefined}
            onSubmit={(v) => void submitImap(v)}
          />
        ) : (
          <>
        <p className="m-hint">{t("mail.microsoftHint")}</p>

        {msShowId ? (
          <label className="m-field">
            <span>{t("settings.clientId")}</span>
            <TextInput onChange={(e) => setMsClientId(e.target.value)} value={msClientId} placeholder="00000000-0000-0000-0000-000000000000" />
          </label>
        ) : (
          <Button variant="ghost" onClick={() => setMsShowId(true)}>
            {t("settings.useOwnAppId")}
          </Button>
        )}

        <Button variant="primary" disabled={busy} onClick={() => void connect()}>
          {t("mail.connectMicrosoft")}
        </Button>
          </>
        )}
      </div>
    </div>
  );
}
