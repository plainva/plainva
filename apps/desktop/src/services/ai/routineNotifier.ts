import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { toast, type RoutineReady } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * Telling the user that a routine left a note (plan KI-Harness P8, ADR 0033).
 *
 * A routine runs beside whatever the user is doing, so its result is said
 * where they are: a toast with the way to the note while this window is in
 * front, the system's notification while it is not — a desktop window that
 * is open in the background still runs its routines. The routine's row in
 * the settings and the line in the conversation say it either way; this is
 * the knock on the door, and a knock that cannot be delivered is no failure.
 */
let permissionAsked = false;

export function notifyRoutineReady(ready: RoutineReady, open: () => void): void {
  if (document.hasFocus()) {
    toast.info(i18n.t("ai.routines.ready", { name: ready.name }), { label: i18n.t("ai.routines.openNote"), run: open });
    return;
  }
  void (async () => {
    try {
      if (!(await isPermissionGranted())) {
        // Asked once per start of the app: a no is an answer.
        if (permissionAsked) return;
        permissionAsked = true;
        if ((await requestPermission()) !== "granted") return;
      }
      sendNotification({ title: i18n.t("ai.routines.notify", { name: ready.name }), body: i18n.t("ai.routines.notifyBody", { title: ready.title }) });
    } catch {
      // No notification is no failure: the row and the conversation say what happened.
    }
  })();
}
