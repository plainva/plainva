import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Trash2, Check, Plus } from "lucide-react";
import { TextInput, toast } from "@plainva/ui";
import type { PimAccountRow, PimCalendar } from "@plainva/core";
import { mConfirm } from "../services/mobileDialogs";
import {
  listPimAccounts,
  listPimCalendars,
  setPimCalendarSelected,
  addPimAccount,
  removePimAccount,
} from "../services/pim/pimService";

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
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
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

        <p className="m-hint" style={{ marginTop: 16 }}>{t("pim.connectCaldavHint", { defaultValue: "CalDAV mit einem App-Passwort verbinden (z. B. Fastmail, Nextcloud, iCloud). Google/Microsoft folgen über die Anmeldung im Browser." })}</p>

        <label className="m-field">
          <span>{t("pim.accountLabel", { defaultValue: "Bezeichnung (optional)" })}</span>
          <TextInput onChange={(e) => setLabel(e.target.value)} value={label} placeholder="Fastmail" />
        </label>
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
      </div>
    </div>
  );
}
