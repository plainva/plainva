import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Trash2 } from "lucide-react";
import { TextInput, toast } from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";
import { mailAccountKind } from "@plainva/ui/mail";
import { mConfirm } from "../services/mobileDialogs";
import {
  connectMicrosoftMail,
  listMobileMailAccounts,
  mailVaultId,
  removeMobileMailAccount,
  MAIL_CHANGED_EVENT,
} from "../services/mail/mailRuntime";
import { deviceSignInStates, type DeviceSignInState } from "../services/deviceSignIn";
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
          <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
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
                  <button
                    type="button"
                    className="m-iconbtn"
                    onClick={() => void remove(a)}
                    aria-label={t("mail.removeAccount", { defaultValue: "Postfach entfernen" })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {imap ? (
                  /* An IMAP mailbox from the desktop shows up here through the
                     settings sync — and cannot work until G2. Say so on the row
                     rather than letting the list screen fail later. */
                  <p className="m-hint m-acct-hint">{t("mail.imapMobileUnavailable")}</p>
                ) : (
                  state === "signin" && <p className="m-hint m-acct-hint">{t("deviceSignIn.rowHintOauth")}</p>
                )}
              </div>
            );
          })
        )}

        <h2 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "20px 0 8px" }}>
          {t("mail.addAccount", { defaultValue: "Postfach hinzufügen" })}
        </h2>
        <p className="m-hint">{t("mail.microsoftHint")}</p>
        <p className="m-hint m-hint--warn">{t("mail.imapMobileUnavailable")}</p>

        {msShowId ? (
          <label className="m-field">
            <span>{t("settings.clientId")}</span>
            <TextInput onChange={(e) => setMsClientId(e.target.value)} value={msClientId} placeholder="00000000-0000-0000-0000-000000000000" />
          </label>
        ) : (
          <button type="button" className="m-btn m-btn--ghost" onClick={() => setMsShowId(true)}>
            {t("settings.useOwnAppId")}
          </button>
        )}

        <button type="button" className="m-btn m-btn--filled" disabled={busy} onClick={() => void connect()}>
          {t("mail.connectMicrosoft")}
        </button>
      </div>
    </div>
  );
}
