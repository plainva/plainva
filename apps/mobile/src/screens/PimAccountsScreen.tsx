import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Trash2, Check, Plus } from "lucide-react";
import { Button, classifyAuthError, ICON, IconButton, PLAINVA_ONEDRIVE_CLIENT_ID, Segmented, TextInput, toast } from "@plainva/ui";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { mConfirm } from "../services/mobileDialogs";
import {
  listPimAccounts,
  listPimCalendars,
  setPimCalendarSelected,
  addPimAccount,
  reauthorizePimAccount,
  removePimAccount,
  getPimCache,
} from "../services/pim/pimService";
import { getPimCredentials } from "../services/pim/pimCredentials";
import { beginPimOAuth } from "../services/pim/pimOAuth";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { accountRowState, deviceSignInStates, isOAuthProvider, type DeviceSignInState } from "../services/deviceSignIn";
import { DeviceSignInBadge } from "../components/DeviceSignInRow";

/**
 * Mobile PIM calendar accounts. All three providers connect on-device: CalDAV
 * with an app password, Google (BYO client id) and Microsoft (central app id)
 * via the system-browser OAuth flow (beginPimOAuth → handlePimOAuthRedirect).
 * Credentials live in the per-vault SecureStore and are never synced, so every
 * device signs in once (package D — the per-device hint below).
 */

type CalRow = PimCalendar & { accountId: string; selected: boolean };

export function PimAccountsScreen({ bump, onBack }: { bump: number; onBack?: () => void }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<CalRow[]>([]);
  const [addProvider, setAddProvider] = useState<"google" | "microsoft" | "caldav">("google");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [gClientId, setGClientId] = useState("");
  const [gClientSecret, setGClientSecret] = useState("");
  // Microsoft uses the shipped central client id; the field stays EMPTY and
  // hidden (never expose our app id). beginPimOAuth falls back to the central
  // id when this is blank — an opt-in reveals the field for a user's own.
  const [msClientId, setMsClientId] = useState("");
  const [msShowId, setMsShowId] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sign-in state per account (plan P7). A synced account row without a
  // credential slot on this device is the case the screen used to hide.
  const [signIn, setSignIn] = useState<Map<string, DeviceSignInState>>(new Map());
  // The last real failure per account (findings P6.1). The worker has always
  // recorded it; the phone never read it, so an expired token read as "aktiv".
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  /** Which account a CalDAV re-sign-in is for — the form repairs it in place. */
  const [reconnect, setReconnect] = useState<PimAccountRow | null>(null);

  const reload = useCallback(() => {
    void listPimAccounts()
      .then(async (rows) => {
        setAccounts(rows);
        const vault = await getActiveVaultEntry();
        setSignIn(await deviceSignInStates("pim", vault.id, rows.map((r) => r.id)));
        const cache = getPimCache();
        const next = new Map<string, string>();
        if (cache) {
          for (const r of rows) {
            const scope = await cache.getScopeState(r.id, "account").catch(() => null);
            if (scope?.lastError) next.set(r.id, scope.lastError);
          }
        }
        setErrors(next);
      })
      .catch(() => setAccounts([]));
    void listPimCalendars().then(setCalendars).catch(() => setCalendars([]));
  }, []);

  useEffect(() => { reload(); }, [reload, bump]);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("m-pim-changed", onChanged);
    return () => window.removeEventListener("m-pim-changed", onChanged);
  }, [reload]);

  /** The account this form repairs, if it is of the provider being filled in. */
  const reconnectFor = (provider: string) => (reconnect?.provider === provider ? reconnect : null);

  const connectCaldav = async () => {
    const u = url.trim();
    if (!u || !user.trim() || !pass) return;
    setBusy(true);
    try {
      const host = (() => { try { return new URL(u).host; } catch { return u; } })();
      const target = reconnectFor("caldav");
      if (target) {
        await reauthorizePimAccount(target.id, { kind: "caldav", url: u, user: user.trim(), pass });
      } else {
        await addPimAccount("caldav", label.trim() || host, { kind: "caldav", url: u, user: user.trim(), pass });
      }
      setLabel(""); setUrl(""); setUser(""); setPass(""); setReconnect(null);
      toast.success(
        target
          ? t("pim.accountReconnected", { defaultValue: "Konto neu angemeldet" })
          : t("pim.accountAdded", { defaultValue: "Konto verbunden" })
      );
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Google/Microsoft open the system browser (OAuth); the account is added when
  // the redirect returns (handlePimOAuthRedirect -> addPimAccount -> m-pim-changed),
  // or its credential replaced in place when the flow carries an accountId.
  const connectGoogle = async () => {
    if (!gClientId.trim()) {
      toast.error(t("pim.googleClientIdRequired", { defaultValue: "Google braucht eine eigene Client-ID (BYO)." }));
      return;
    }
    try {
      await beginPimOAuth("google", { clientId: gClientId, clientSecret: gClientSecret, label, accountId: reconnectFor("google")?.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const connectMicrosoft = async () => {
    try {
      // Empty msClientId → beginPimOAuth uses the shipped central client id.
      await beginPimOAuth("microsoft", { clientId: msClientId, label, accountId: reconnectFor("microsoft")?.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * "Erneut anmelden" — the same consent flow as connecting, bound to the same
   * account id, so the row keeps its calendars and every mirrored task keeps its
   * anchor. Deleting and re-adding was the old advice and cost all of that.
   *
   * For an expired grant the credential slot is still there, so the client id it
   * was created with is reused — the user does not have to dig it out again. A
   * slot that is gone entirely has no id to reuse: Google then needs the form
   * (BYO), Microsoft falls back to the shipped app.
   */
  const signInAgain = async (a: PimAccountRow) => {
    setReconnect(a);
    if (a.provider === "caldav") {
      setAddProvider("caldav");
      setLabel(a.label);
      toast.info(t("pim.reconnectCaldavHint", { defaultValue: "Trage die Serveradresse und das Passwort unten erneut ein." }));
      return;
    }
    try {
      const vault = await getActiveVaultEntry();
      const stored = await getPimCredentials(vault.id, a.id).catch(() => null);
      const storedId = stored && stored.kind !== "caldav" ? stored.clientId : "";
      const storedSecret = stored && stored.kind === "google" ? stored.clientSecret : "";
      if (a.provider === "google") {
        const clientId = storedId || gClientId.trim();
        if (!clientId) {
          // Nothing to sign in WITH — the form asks, instead of opening a
          // consent page Google would reject.
          setAddProvider("google");
          toast.error(t("pim.googleClientIdRequired", { defaultValue: "Google braucht eine eigene Client-ID (BYO)." }));
          return;
        }
        await beginPimOAuth("google", { clientId, clientSecret: storedSecret || gClientSecret, label: a.label, accountId: a.id });
      } else {
        await beginPimOAuth("microsoft", { clientId: storedId || msClientId, label: a.label, accountId: a.id });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (a: PimAccountRow) => {
    const ok = await mConfirm({
      title: t("pim.removeAccount", { defaultValue: "Konto entfernen" }),
      message: t("pim.removeAccountConfirm", { defaultValue: "Zugangsdaten und zwischengespeicherte Termine werden entfernt (der Kalender beim Anbieter bleibt)." }),
      confirmLabel: t("pim.removeAccount", { defaultValue: "Entfernen" }),
      danger: true,
    });
    if (!ok) return;
    try {
      await removePimAccount(a.id);
      toast.success(t("pim.accountRemoved", { defaultValue: "Konto entfernt" }));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleCal = async (c: CalRow) => {
    try {
      await setPimCalendarSelected(c.accountId, c.id, !c.selected);
      setCalendars((cs) => cs.map((x) => (x.accountId === c.accountId && x.id === c.id ? { ...x, selected: !x.selected } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const canConnect = url.trim().length > 0 && user.trim().length > 0 && pass.length > 0 && !busy;

  return (
    <div className="m-page">
      <header className="m-header">
        {onBack && (
          <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
            <ChevronLeft size={ICON.head} />
          </IconButton>
        )}
        <h1>{t("pim.accounts", { defaultValue: "Kalenderkonten" })}</h1>
      </header>

      <div className="m-sync">
        {/* Per-device sign-in (package D): app settings sync, but credentials
            never do — this answers "settings synced yet no calendar login". */}
        <p className="m-hint">{t("pim.perDeviceHint")}</p>
        {accounts.length === 0 ? (
          <p className="m-hint">{t("pim.noAccountsMobile", { defaultValue: "Noch kein Kalenderkonto verbunden." })}</p>
        ) : (
          accounts.map((a) => {
            const cals = calendars.filter((c) => c.accountId === a.id);
            const failure = errors.get(a.id);
            const state = accountRowState(signIn.get(a.id) ?? "active", failure);
            return (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <div className="m-row m-acct" data-testid={`pim-account-${a.id}`}>
                  <span className="m-acct-name">{a.label}</span>
                  <DeviceSignInBadge state={state} />
                  <span className="m-acct-provider">{a.provider}</span>
                  <IconButton
                    label={t("pim.removeAccount", { defaultValue: "Konto entfernen" })}
                    onClick={() => void remove(a)}
                  >
                    <Trash2 size={ICON.ui} />
                  </IconButton>
                </div>
                {state !== "active" && (
                  /* The row alone would only say something is wrong — this says
                     what, and offers the one action that fixes it. */
                  <>
                    <p className="m-hint m-acct-hint" data-testid={`pim-account-hint-${a.id}`}>
                      {state === "expired"
                        ? a.provider === "google"
                          ? t("pim.authExpiredGoogle")
                          : t("pim.authExpired")
                        : isOAuthProvider(a.provider)
                          ? t("deviceSignIn.rowHintOauth")
                          : t("deviceSignIn.rowHintStatic")}
                    </p>
                    <Button
                      variant="ghost"
                      data-testid={`pim-account-reauth-${a.id}`}
                      onClick={() => void signInAgain(a)}
                    >
                      {t("pim.signInAgain", { defaultValue: "Neu anmelden" })}
                    </Button>
                  </>
                )}
                {/* A failure that re-signing does NOT fix still has to be
                    visible — a wrong client id or a dead network read as an
                    empty calendar before, with nothing on screen to explain it.
                    The provider's own words stay below the advice. */}
                {state === "active" && failure && (
                  <p className="m-hint m-acct-hint" data-testid={`pim-account-error-${a.id}`}>
                    {classifyAuthError(failure) === "config"
                      ? t("pim.authConfig")
                      : classifyAuthError(failure) === "network"
                        ? t("pim.authNetwork")
                        : t("pim.accountFailed")}
                    <br />
                    <span style={{ color: "var(--text-faint)" }}>{failure}</span>
                  </p>
                )}
                {cals.map((c) => (
                  <button key={c.id} type="button" className="m-row" onClick={() => void toggleCal(c)} style={{ paddingLeft: 24 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: c.color || "var(--accent-color)", flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    {c.selected && <Check size={ICON.ui} style={{ color: "var(--accent-color)" }} />}
                  </button>
                ))}
              </div>
            );
          })
        )}

        <h2 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "20px 0 8px" }}>{t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}</h2>
        {/* Provider chooser — Google / Microsoft (OAuth) / CalDAV (app password) */}
        <Segmented
          ariaLabel={t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}
          options={[
            { value: "google", label: "Google" },
            { value: "microsoft", label: "Microsoft" },
            { value: "caldav", label: "CalDAV" },
          ]}
          value={addProvider}
          onChange={(v) => setAddProvider(v as "google" | "microsoft" | "caldav")}
        />

        <label className="m-field">
          <span>{t("pim.accountLabel", { defaultValue: "Bezeichnung (optional)" })}</span>
          <TextInput onChange={(e) => setLabel(e.target.value)} value={label} placeholder={addProvider === "google" ? "Google" : addProvider === "microsoft" ? "Outlook" : "Fastmail"} />
        </label>

        {addProvider === "google" && (
          <>
            <p className="m-hint">{t("pim.googleByoHint", { defaultValue: "Google verlangt eine eigene OAuth-Client-ID (wie beim Drive-Sync). Scopes: Kalender + Aufgaben." })}</p>
            <label className="m-field">
              <span>Client-ID</span>
              <TextInput onChange={(e) => setGClientId(e.target.value)} value={gClientId} placeholder="…apps.googleusercontent.com" />
            </label>
            <label className="m-field">
              <span>{t("pim.googleClientSecret", { defaultValue: "Client-Secret (optional bei Desktop-Clients)" })}</span>
              <TextInput type="password" onChange={(e) => setGClientSecret(e.target.value)} value={gClientSecret} />
            </label>
            <Button
              variant="primary"
              disabled={busy || !gClientId.trim()}
              onClick={() => void connectGoogle()}
            >
              <Plus size={ICON.ui} /> {t("pim.connectGoogle", { defaultValue: "Mit Google verbinden" })}
            </Button>
          </>
        )}

        {addProvider === "microsoft" && (
          <>
            <p className="m-hint">{t("pim.microsoftHint", { defaultValue: "Nutzt die zentrale Plainva-App-Registrierung — einfach verbinden und im Browser zustimmen." })}</p>
            {!PLAINVA_ONEDRIVE_CLIENT_ID || msShowId ? (
              <label className="m-field">
                <span>Client-ID</span>
                <TextInput onChange={(e) => setMsClientId(e.target.value)} value={msClientId} />
              </label>
            ) : (
              <Button variant="ghost" onClick={() => setMsShowId(true)}>
                {t("settings.useOwnAppId", { defaultValue: "Eigene App-ID verwenden" })}
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={() => void connectMicrosoft()}>
              <Plus size={ICON.ui} /> {t("pim.connectMicrosoft", { defaultValue: "Mit Microsoft verbinden" })}
            </Button>
          </>
        )}

        {addProvider === "caldav" && (
          <>
            <p className="m-hint">{t("pim.connectCaldavHint", { defaultValue: "CalDAV mit einem App-Passwort verbinden (z. B. Fastmail, Nextcloud, iCloud). Google/Microsoft folgen über die Anmeldung im Browser." })}</p>
            <label className="m-field">
              <span>{t("pim.caldavUrl", { defaultValue: "CalDAV-URL" })}</span>
              <TextInput onChange={(e) => setUrl(e.target.value)} value={url} placeholder="https://caldav.fastmail.com/dav/calendars/user/name/" />
            </label>
            <label className="m-field">
              <span>{t("mobile.syncUser", { defaultValue: "Benutzer" })}</span>
              <TextInput onChange={(e) => setUser(e.target.value)} value={user} />
            </label>
            <label className="m-field">
              <span>{t("mobile.syncPassword", { defaultValue: "Passwort" })}</span>
              <TextInput type="password" onChange={(e) => setPass(e.target.value)} value={pass} />
            </label>
            <Button variant="primary" disabled={!canConnect} onClick={() => void connectCaldav()}>
              <Plus size={ICON.ui} /> {t("pim.connectAccount", { defaultValue: "Konto verbinden" })}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
