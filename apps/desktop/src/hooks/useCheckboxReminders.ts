import { useCallback, useEffect, useState } from "react";
import { useVault } from "../contexts/VaultContext";
import { getSettingsStore } from "../services/settingsStore";
import { loadReminderSettings, remindCheckboxesKey } from "../services/reminderSettings";

const CHANGED = "plainva-reminders-changed";
const FROM = "due-picker";

/**
 * The vault's "Checkboxes with a time" switch (Sammelplan § 3.145 no. 1, E3) for
 * the due picker (plan Rückmeldungen 2026-11-05, E3): the picker writes a time
 * into a checkbox, and where that time would not remind it offers this switch
 * right there. It is the setting of the reminder settings, not a copy: the
 * same store key, the same notice to the scheduler. The phone's twin is
 * `useCheckboxReminders` in apps/mobile.
 */
export function useCheckboxReminders(): { on: boolean; onChange: (on: boolean) => void } | null {
  const { vaultPath } = useVault();
  const [state, setState] = useState<{ vault: string; on: boolean } | null>(null);

  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    // A change from the settings is read again; this switch's own notice is not — it knows what it wrote.
    const read = (event?: Event) => {
      if ((event as CustomEvent<{ from?: string }> | undefined)?.detail?.from === FROM) return;
      void getSettingsStore()
        .then((store) => loadReminderSettings(store, vaultPath))
        .then((settings) => { if (alive) setState({ vault: vaultPath, on: settings.checkboxes }); })
        .catch(() => undefined);
    };
    read();
    window.addEventListener(CHANGED, read);
    return () => {
      alive = false;
      window.removeEventListener(CHANGED, read);
    };
  }, [vaultPath]);

  const onChange = useCallback((on: boolean) => {
    if (!vaultPath) return;
    setState({ vault: vaultPath, on });
    void (async () => {
      const store = await getSettingsStore();
      await store.set(remindCheckboxesKey(vaultPath), on);
      await store.save();
      // The running scheduler plans again, as after the switch in the settings.
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: { from: FROM } }));
    })().catch(() => undefined);
  }, [vaultPath]);

  return vaultPath && state?.vault === vaultPath ? { on: state.on, onChange } : null;
}
