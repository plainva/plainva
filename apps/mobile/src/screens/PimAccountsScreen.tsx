import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Trash2, Check, Plus } from "lucide-react";
import { TextInput, toast, PLAINVA_ONEDRIVE_CLIENT_ID } from "@plainva/ui";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { mConfirm } from "../services/mobileDialogs";
import {
  listPimAccounts,
  listPimCalendars,
  setPimCalendarSelected,
  addPimAccount,
  removePimAccount,
} from "../services/pim/pimService";
import { beginPimOAuth } from "../services/pim/pimOAuth";

/**
 * Mobile PIM calendar accounts (calendar-mobile branch). CalDAV connects with
 * an app-password on-device (the first device-testable path — no OAuth); its
 * calendars auto-sync (default selected). Google/Microsoft need native OAuth
 * roundtrips (prepared in pimAuth/pimService, wired when the sync OAuth flow is
 * extended) — shown as a hint here, not a broken button.
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

  const reload = useCallback(() => {
    void listPimAccounts().then(setAccounts).catch(() => setAccounts([]));
    void listPimCalendars().then(setCalendars).catch(() => setCalendars([]));
  }, []);

  useEffect(() => { reload(); }, [reload, bump]);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("m-pim-changed", onChanged);
    return () => window.removeEventListener("m-pim-changed", onChanged);
  }, [reload]);

  const connectCaldav = async () => {
    const u = url.trim();
    if (!u || !user.trim() || !pass) return;
    setBusy(true);
    try {
      const host = (() => { try { return new URL(u).host; } catch { return u; } })();
      await addPimAccount("caldav", label.trim() || host, { kind: "caldav", url: u, user: user.trim(), pass });
      setLabel(""); setUrl(""); setUser(""); setPass("");
      toast.success(t("pim.accountAdded", { defaultValue: "Konto verbunden" }));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Google/Microsoft open the system browser (OAuth); the account is added when
  // the redirect returns (handlePimOAuthRedirect -> addPimAccount -> m-pim-changed).
  const connectGoogle = async () => {
    if (!gClientId.trim()) {
      toast.error(t("pim.googleClientIdRequired", { defaultValue: "Google braucht eine eigene Client-ID (BYO)." }));
      return;
    }
    try {
      await beginPimOAuth("google", { clientId: gClientId, clientSecret: gClientSecret, label });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const connectMicrosoft = async () => {
    try {
      // Empty msClientId → beginPimOAuth uses the shipped central client id.
      await beginPimOAuth("microsoft", { clientId: msClientId, label });
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
          <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1>{t("pim.accounts", { defaultValue: "Kalenderkonten" })}</h1>
      </header>

      <div className="m-sync">
        {accounts.length === 0 ? (
          <p className="m-hint">{t("pim.noAccountsMobile", { defaultValue: "Noch kein Kalenderkonto verbunden." })}</p>
        ) : (
          accounts.map((a) => {
            const cals = calendars.filter((c) => c.accountId === a.id);
            return (
              <div key={a.id} style={{ marginBottom: 16 }}>
                <div className="m-row" style={{ fontWeight: 600 }}>
                  <span style={{ flex: 1 }}>{a.label}</span>
                  <span className="m-prop-val" style={{ textTransform: "uppercase", fontSize: "var(--text-xs)" }}>{a.provider}</span>
                  <button type="button" className="m-iconbtn" onClick={() => void remove(a)} aria-label={t("pim.removeAccount", { defaultValue: "Konto entfernen" })}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {cals.map((c) => (
                  <button key={c.id} type="button" className="m-row" onClick={() => void toggleCal(c)} style={{ paddingLeft: 24 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: c.color || "var(--accent-color)", flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    {c.selected && <Check size={16} style={{ color: "var(--accent-color)" }} />}
                  </button>
                ))}
              </div>
            );
          })
        )}

        <h2 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "20px 0 8px" }}>{t("pim.addAccount", { defaultValue: "Konto hinzufügen" })}</h2>
        {/* Provider chooser — Google / Microsoft (OAuth) / CalDAV (app password) */}
        <div className="m-viewpills" role="tablist" style={{ marginBottom: 12 }}>
          {(["google", "microsoft", "caldav"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={addProvider === p}
              className={addProvider === p ? "m-viewpill is-active" : "m-viewpill"}
              onClick={() => setAddProvider(p)}
            >
              {p === "google" ? "Google" : p === "microsoft" ? "Microsoft" : "CalDAV"}
            </button>
          ))}
        </div>

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
            <button className="m-btn m-btn--filled" disabled={busy || !gClientId.trim()} onClick={() => void connectGoogle()}>
              <Plus size={16} /> {t("pim.connectGoogle", { defaultValue: "Mit Google verbinden" })}
            </button>
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
              <button className="m-btn m-btn--ghost" onClick={() => setMsShowId(true)}>
                {t("settings.useOwnAppId", { defaultValue: "Eigene App-ID verwenden" })}
              </button>
            )}
            <button className="m-btn m-btn--filled" disabled={busy} onClick={() => void connectMicrosoft()}>
              <Plus size={16} /> {t("pim.connectMicrosoft", { defaultValue: "Mit Microsoft verbinden" })}
            </button>
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
            <button className="m-btn m-btn--filled" disabled={!canConnect} onClick={() => void connectCaldav()}>
              <Plus size={16} /> {t("pim.connectAccount", { defaultValue: "Konto verbinden" })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
