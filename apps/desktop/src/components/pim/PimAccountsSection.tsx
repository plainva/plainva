import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button, ICON } from "@plainva/ui";
import type { PimAccountRow, PimCalendar, PimTaskList } from "@plainva/core";
import { useVault, meetingFolderKey, DEFAULT_MEETING_FOLDER, defaultCalendarKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { Select } from "../Select";
import { setPimAccountEnabled } from "../../services/pim/pimAccounts";

/**
 * Settings section "Kalender" (cloud-accounts split): per-account calendar and
 * task-list SELECTION plus the calendar behavior settings. Connecting and
 * removing accounts lives in the Cloud-Konten area (the connect wizard).
 * Only rendered for the OPEN vault (the runtime is bound to its index DB).
 */

export function PimAccountsSection({ onOpenCloudAccounts }: { onOpenCloudAccounts?: () => void }) {
  const { t } = useTranslation();
  const { pimRuntime, vaultPath } = useVault();
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<Array<PimCalendar & { accountId: string; selected: boolean }>>([]);
  const [taskLists, setTaskLists] = useState<Array<PimTaskList & { accountId: string; selected: boolean }>>([]);
  const [tick, setTick] = useState(0);
  const [meetingFolder, setMeetingFolder] = useState("");

  // Meetings folder ("Termin → Meeting-Notiz" target, stage 2c). Loaded once,
  // persisted on blur through the normal settings store.
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = (await store.get<string>(meetingFolderKey(vaultPath))) ?? "";
      if (alive) setMeetingFolder(v);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);
  const persistMeetingFolder = useCallback(async () => {
    if (!vaultPath) return;
    const store = await getSettingsStore();
    await store.set(meetingFolderKey(vaultPath), meetingFolder.trim());
    await store.save();
  }, [vaultPath, meetingFolder]);

  // Default calendar for new events ("<accountId> <calId>"; "" = first writable).
  const [defaultCal, setDefaultCal] = useState("");
  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    void (async () => {
      const store = await getSettingsStore();
      const v = (await store.get<string>(defaultCalendarKey(vaultPath))) ?? "";
      if (alive) setDefaultCal(v);
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);
  const persistDefaultCal = useCallback(
    async (value: string) => {
      setDefaultCal(value);
      if (!vaultPath) return;
      const store = await getSettingsStore();
      await store.set(defaultCalendarKey(vaultPath), value);
      await store.save();
      // Let an open calendar tab pick it up without a remount.
      window.dispatchEvent(new CustomEvent("plainva-default-calendar-changed"));
    },
    [vaultPath]
  );
  const defaultCalOptions = useMemo(() => {
    const accById = new Map(accounts.map((a) => [a.id, a.label]));
    const writable = calendars
      .filter((c) => !c.readOnly)
      .map((c) => ({ value: `${c.accountId} ${c.id}`, label: accounts.length > 1 ? `${c.name} · ${accById.get(c.accountId) ?? ""}` : c.name }));
    return [{ value: "", label: t("pim.defaultCalendarFirst", { defaultValue: "Erster beschreibbarer Kalender" }) }, ...writable];
  }, [calendars, accounts, t]);

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

  if (!pimRuntime) {
    return <p style={{ color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("pim.openVaultFirst", { defaultValue: "Nur für den geöffneten Vault verfügbar." })}</p>;
  }

  const providerLabel = (p: string) =>
    p === "caldav" ? "CalDAV" : p === "google" ? "Google" : "Microsoft";

  return (
    <div data-testid="pim-accounts">
      {accounts.length === 0 && (
        <div style={{ margin: "0.25rem 0 0.75rem" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-md)", margin: "0 0 0.5rem" }}>
            {t("pim.noAccounts", { defaultValue: "Noch keine Kalender-Konten verbunden." })}
          </p>
          {onOpenCloudAccounts && (
            <Button variant="primary" onClick={onOpenCloudAccounts} data-testid="pim-open-cloudaccounts">
              {t("cloudAccounts.openArea")}
            </Button>
          )}
        </div>
      )}

      {accounts.map((account) => {
        const accCals = calendars.filter((c) => c.accountId === account.id);
        const accLists = taskLists.filter((l) => l.accountId === account.id);
        return (
          <div key={account.id} data-testid={`pim-account-${account.provider}`} style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.6rem 0.75rem", marginBottom: "0.6rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: "var(--text-md)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.label}</strong>
              <span style={{ fontSize: "var(--text-sm)", padding: "0.05rem 0.45rem", borderRadius: "var(--radius-pill)", background: "var(--bg-secondary)", color: "var(--text-muted)", flexShrink: 0 }}>
                {providerLabel(account.provider)}
              </span>
              <div style={{ flex: 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-ui)", color: "var(--text-muted)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={account.enabled}
                  onChange={(e) => {
                    void setPimAccountEnabled(pimRuntime, account, e.target.checked).then(() => setTick((x) => x + 1));
                  }}
                />
                {t("pim.accountEnabled", { defaultValue: "Aktiv" })}
              </label>
              {onOpenCloudAccounts && (
                <Button variant="ghost" size="sm" onClick={onOpenCloudAccounts}>
                  {t("cloudAccounts.manageAccount")}
                </Button>
              )}
            </div>

            {accCals.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("pim.calendars", { defaultValue: "Kalender" })}
                </div>
                {accCals.map((cal) => (
                  <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-md)", padding: "0.1rem 0", cursor: "pointer" }}>
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
                <div style={{ fontSize: "var(--text-sm)", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 2 }}>
                  {t("pim.taskLists", { defaultValue: "Aufgabenlisten" })}
                </div>
                {accLists.map((list) => (
                  <label key={list.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-md)", padding: "0.1rem 0", cursor: "pointer" }}>
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

      {accounts.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
          <Button variant="ghost" onClick={() => void pimRuntime.worker.triggerImmediate()}>
            <RefreshCw size={ICON.ui} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            {t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })}
          </Button>
        </div>
      )}

      <div style={{ marginTop: "0.75rem" }}>
        <label style={{ display: "block", fontSize: "var(--text-md)", marginBottom: 2 }}>
          {t("pim.meetingFolder", { defaultValue: "Meeting-Ordner" })}
        </label>
        <input
          autoComplete="off"
          value={meetingFolder}
          onChange={(e) => setMeetingFolder(e.target.value)}
          onBlur={() => void persistMeetingFolder()}
          placeholder={DEFAULT_MEETING_FOLDER}
          className="pv-field"
          data-testid="pim-meeting-folder"
          style={{ width: "100%", maxWidth: "20rem" }}
        />
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
          {t("pim.meetingFolderHint", { defaultValue: "Ablage für Notizen aus „Termin → Meeting-Notiz“ im Kalender." })}
        </p>
      </div>

      {defaultCalOptions.length > 1 && (
        <div style={{ marginTop: "0.75rem" }}>
          <label style={{ display: "block", fontSize: "var(--text-md)", marginBottom: 2 }}>
            {t("pim.defaultCalendar", { defaultValue: "Standardkalender für Termine" })}
          </label>
          <div style={{ maxWidth: "20rem" }}>
            <Select
              ariaLabel={t("pim.defaultCalendar", { defaultValue: "Standardkalender für Termine" })}
              value={defaultCal}
              onChange={(v) => void persistDefaultCal(v)}
              options={defaultCalOptions}
              data-testid="pim-default-calendar"
            />
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0.2rem 0 0" }}>
            {t("pim.defaultCalendarHint", { defaultValue: "Neue Termine wählen diesen Kalender vor." })}
          </p>
        </div>
      )}
    </div>
  );
}
