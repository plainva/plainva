import { useCallback, useEffect, useState } from "react";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * The vault's "Checkboxes with a time" switch (Sammelplan § 3.145 no. 1, E3) for
 * the due sheet (plan Rückmeldungen 2026-11-05, E3): the picker writes a time
 * into a checkbox, and where that time would not remind it offers this switch
 * right there. It is the setting of the reminder settings, not a copy — the
 * same field, the same re-plan afterwards. The desktop's twin is
 * `useCheckboxReminders` in apps/desktop.
 */
export function useCheckboxReminders(): { on: boolean; onChange: (on: boolean) => void } {
  const [on, setOn] = useState(() => getMobileSettings().remindCheckboxes);
  useEffect(() => {
    const changed = () => setOn(getMobileSettings().remindCheckboxes);
    window.addEventListener("m-settings-changed", changed);
    return () => window.removeEventListener("m-settings-changed", changed);
  }, []);
  const onChange = useCallback((next: boolean) => {
    setOn(next);
    void updateMobileSettings({ remindCheckboxes: next })
      .then(() => import("../services/reminderScheduler").then((m) => m.rescheduleReminders()))
      .catch(() => undefined);
  }, []);
  return { on, onChange };
}
