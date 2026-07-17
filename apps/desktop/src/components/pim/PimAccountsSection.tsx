import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2 } from "lucide-react";
import { toast, Button, IconButton, PLAINVA_ONEDRIVE_CLIENT_ID } from "@plainva/ui";
import type { PimAccountRow, PimCalendar, PimTaskList } from "@plainva/core";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { Select } from "../Select";
import {
  connectCalDavAccount,
  connectGoogleAccount,
  connectMicrosoftAccount,
  removePimAccount,
  setPimAccountEnabled,
} from "../../services/pim/pimAccounts";

/**
 * Settings section "Kalender & Konten" (PIM stage 2b): manage the vault's
 * calendar/task accounts. Connect validates by actually listing calendars —
 * nothing persists on failure. Only rendered for the OPEN vault (the runtime
 * is bound to its index DB).
 */

type AddProvider = "caldav" | "google" | "microsoft";

export function PimAccountsSection() {
  const { t } = useTranslation();
  const { pimRuntime, vaultPath } = useVault();
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<Array<PimCalendar & { accountId: string; selected: boolean }>>([]);
  const [taskLists, setTaskLists] = useState<Array<PimTaskList & { accountId: string; selected: boolean }>>([]);
  const [tick, setTick] = useState(0);

  const [showAdd, setShowAdd] = useState(false);
  const [provider, setProvider] = useState<AddProvider>("google");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [davUrl, setDavUrl] = useState("");
  const [davUser, setDavUser] = useState("");
  const [davPass, setDavPass] = useState("");
  const [gClientId, setGClientId] = useState("");
  const [gClientSecret, setGClientSecret] = useState("");
  const [msClientId, setMsClientId] = useState(PLAINVA_ONEDRIVE_CLIENT_ID);

  useEffect(() => {
    let alive = true;
    if (!pimRuntime) {
      setAccounts([]);
      setCalendars([]);
      setTaskLists([]);
      return;
    }
    void (async () => {
      try {
        const [acc, cals, lists] = await Promise.all([
          pimRuntime.cache.listAccounts(),
          pimRuntime.cache.listCalendars(),
          pimRuntime.cache.listTaskLists(),
        ]);
        if (!alive) return;
        setAccounts(acc);
        setCalendars(cals);
        setTaskLists(lists);
      } catch (e) {
        console.error("[PimAccountsSection] loading accounts failed", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pimRuntime, tick]);

  // Fresh pull results (worker cycle) refresh the lists too.
  useEffect(() => {
    const onChanged = () => setTick((x) => x + 1);
    window.addEventListener("plainva-pim-changed", onChanged);
    return () => window.removeEventListener("plainva-pim-changed", onChanged);
  }, []);

  const connect = useCallback(async () => {
    if (!pimRuntime || !vaultPath || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (provider === "caldav") {
        if (!davUrl.trim() || !davUser.trim() || !davPass) throw new Error(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
        await connectCalDavAccount(pimRuntime, vaultPath, { url: davUrl.trim(), user: davUser.trim(), pass: davPass });
      } else if (provider === "google") {
        if (!gClientId.trim()) throw new Error(t("pim.googleClientIdRequired", { defaultValue: "Google braucht eine eigene Client-ID (BYO)." }));
        await connectGoogleAccount(pimRuntime, vaultPath, { clientId: gClientId.trim(), clientSecret: gClientSecret.trim() });
      } else {
        if (!msClientId.trim()) throw new Error(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
        await connectMicrosoftAccount(pimRuntime, vaultPath, { clientId: msClientId.trim() });
      }
      pimRuntime.worker.start();
      setShowAdd(false);
      setDavPass("");
      setTick((x) => x + 1);
      toast.info(t("pim.connected", { defaultValue: "Konto verbunden." }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pimRuntime, vaultPath, busy, provider, davUrl, davUser, davPass, gClientId, gClientSecret, msClientId, t]);

  const remove = useCallback(
    async (account: PimAccountRow) => {
      if (!pimRuntime || !vaultPath) return;
      const ok = await appConfirm({
        title: t("pim.removeAccount", { defaultValue: "Konto entfernen" }),
        message: t("pim.removeAccountMsg", { defaultValue: "„{{label}}“ wird aus diesem Vault entfernt. Beim Anbieter wird nichts gelöscht.", label: account.label }),
        kind: "danger",
      });
      if (!ok) return;
      await removePimAccount(pimRuntime, vaultPath, account.id);
      setTick((x) => x + 1);
    },
    [pimRuntime, vaultPath, t]
  );

  if (!pimRuntime) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</p>;
  }

  const providerLabel = (p: string) =>
    p === "caldav" ? "CalDAV" : p === "google" ? "Google" : "Microsoft";

  return (
    <div data-testid="pim-accounts">
      {accounts.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0.25rem 0 0.75rem" }}>
          {t("pim.noAccounts", { defaultValue: "Noch keine Kalender-Konten verbunden." })}
        </p>
      )}

      {accounts.map((account) => {
        const accCals = calendars.filter((c) => c.accountId === account.id);
        const accLists = taskLists.filter((l) => l.accountId === account.id);
        return (
          <div key={account.id} data-testid={`pim-account-${account.provider}`} style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.6rem 0.75rem", marginBottom: "0.6rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.label}</strong>
              <span style={{ fontSize: "0.72rem", padding: "0.05rem 0.45rem", borderRadius: "var(--radius-pill)", background: "var(--bg-secondary)", color: "var(--text-muted)", flexShrink: 0 }}>
                {providerLabel(account.provider)}
              </span>
              <div style={{ flex: 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: "var(--text-muted)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={account.enabled}
                  onChange={(e) => {
                    void setPimAccountEnabled(pimRuntime, account, e.target.checked).then(() => setTick((x) => x + 1));
                  }}
                />
                {t("pim.accountEnabled", { defaultValue: "Aktiv" })}
              </label>
              <IconButton label={t("pim.removeAccount", { defaultValue: "Konto entfernen" })} onClick={() => void remove(account)}>
                <Trash2 size={14} />
              </IconButton>
            </div>

            {accCals.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("pim.calendars", { defaultValue: "Kalender" })}
                </div>
                {accCals.map((cal) => (
                  <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", padding: "0.1rem 0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={cal.selected}
                      onChange={(e) => {
                        void pimRuntime.cache.setCalendarSelected(account.id, cal.id, e.target.checked).then(() => {
                          setTick((x) => x + 1);
                          void pimRuntime.worker.triggerImmediate();
                        });
                      }}
                    />
                    {cal.color ? <span aria-hidden style={{ width: 9, height: 9, borderRadius: "var(--radius-pill)", background: cal.color, flexShrink: 0 }} /> : null}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cal.name}</span>
                  </label>
                ))}
              </div>
            )}

            {accLists.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("pim.taskLists", { defaultValue: "Aufgabenlisten" })}
                </div>
                {accLists.map((list) => (
                  <label key={list.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", padding: "0.1rem 0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={list.selected}
                      onChange={(e) => {
                        void pimRuntime.cache.setTaskListSelected(account.id, list.id, e.target.checked).then(() => {
                          setTick((x) => x + 1);
                          void pimRuntime.worker.triggerImmediate();
                        });
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{list.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <Button variant="secondary" data-testid="pim-add-account" onClick={() => setShowAdd((v) => !v)}>
          {t("pim.addAccount", { defaultValue: "Konto hinzufügen…" })}
        </Button>
        {accounts.length > 0 && (
          <Button variant="ghost" onClick={() => void pimRuntime.worker.triggerImmediate()}>
            <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            {t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })}
          </Button>
        )}
      </div>

      {showAdd && (
        <div data-testid="pim-add-form" style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.6rem 0.75rem" }}>
          <div style={{ marginBottom: "0.5rem", maxWidth: "16rem" }}>
            <Select
              ariaLabel={t("pim.provider", { defaultValue: "Anbieter" })}
              value={provider}
              onChange={(v) => {
                setProvider(v as AddProvider);
                setError(null);
              }}
              options={[
                { value: "google", label: "Google" },
                { value: "microsoft", label: "Microsoft" },
                { value: "caldav", label: "CalDAV (Nextcloud, Fastmail …)" },
              ]}
            />
          </div>

          {provider === "caldav" && (
            <>
              <input autoComplete="off" value={davUrl} onChange={(e) => setDavUrl(e.target.value)} placeholder="https://cloud.example.org/remote.php/dav" className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
              <input autoComplete="off" value={davUser} onChange={(e) => setDavUser(e.target.value)} placeholder={t("pim.davUser", { defaultValue: "Benutzername" })} className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
              <input autoComplete="off" type="password" value={davPass} onChange={(e) => setDavPass(e.target.value)} placeholder={t("pim.davPass", { defaultValue: "App-Passwort" })} className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
            </>
          )}
          {provider === "google" && (
            <>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.4rem" }}>
                {t("pim.googleByoHint", { defaultValue: "Google verlangt eine eigene OAuth-Client-ID (wie beim Drive-Sync). Scopes: Kalender + Aufgaben." })}
              </p>
              <input autoComplete="off" value={gClientId} onChange={(e) => setGClientId(e.target.value)} placeholder="Client-ID" className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
              <input autoComplete="off" type="password" value={gClientSecret} onChange={(e) => setGClientSecret(e.target.value)} placeholder={t("pim.googleClientSecret", { defaultValue: "Client-Secret (optional bei Desktop-Clients)" })} className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
            </>
          )}
          {provider === "microsoft" && (
            <>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 0.4rem" }}>
                {t("pim.microsoftHint", { defaultValue: "Nutzt die zentrale Plainva-App-Registrierung — einfach verbinden und im Browser zustimmen." })}
              </p>
              <input autoComplete="off" value={msClientId} onChange={(e) => setMsClientId(e.target.value)} placeholder="Client-ID" className="pv-field" style={{ width: "100%", marginBottom: "0.4rem" }} />
            </>
          )}

          {error && <p style={{ color: "var(--error-text)", fontSize: "0.8rem", margin: "0.2rem 0" }}>{error}</p>}

          <Button variant="primary" data-testid="pim-connect" disabled={busy} onClick={() => void connect()}>
            {busy ? t("pim.connecting", { defaultValue: "Verbinde…" }) : t("pim.connect", { defaultValue: "Verbinden" })}
          </Button>
        </div>
      )}
    </div>
  );
}
