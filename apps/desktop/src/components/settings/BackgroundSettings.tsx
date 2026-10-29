import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, SettingCard, SettingCardNote, SettingRow, Switch } from "@plainva/ui";
import { getSettingsStore } from "../../services/settingsStore";
import { appConfirm } from "../../services/appDialogs";
import {
  BACKGROUND_OFFERED_KEY,
  RUN_IN_TRAY_KEY,
  applyAutostart,
  disableTray,
  enableTray,
  turnTrayOn,
  type TrayOutcome,
} from "../../services/background";

/**
 * Running in the background — Settings → Startup & behavior (S11c).
 *
 * Two switches, both off by default, because they are two different wishes:
 * starting with the system, and staying alive when the window is closed. The
 * first is a row of the "Startup" card (AutostartRow below, settings plan
 * 2026-10-29, appendix 2.4 B1), the second heads this card. Its next row is
 * not a setting at all but the consequence: it says, live, what currently
 * holds for reminders (B2).
 *
 * The tray switch proves itself instead of predicting: it puts the icon up and
 * asks whether it can be seen. Both ways of failing end with no icon and the
 * switch off, so the window's close handler keeps quitting — see src/tray.rs.
 */
export function BackgroundSettings() {
  const { t } = useTranslation();
  const [tray, setTray] = useState(false);
  const [failure, setFailure] = useState<Extract<TrayOutcome, { on: false }> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = await getSettingsStore();
      const wanted = (await store.get<boolean>(RUN_IN_TRAY_KEY)) ?? false;
      if (alive) setTray(wanted);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggleTray = useCallback(
    async (on: boolean) => {
      setBusy(true);
      setFailure(null);
      try {
        const store = await getSettingsStore();
        if (!on) {
          await disableTray().catch(() => {});
          setTray(false);
          await store.set(RUN_IN_TRAY_KEY, false);
          await store.save();
          return;
        }
        const outcome = await turnTrayOn({
          enable: enableTray,
          disable: disableTray,
          confirmVisible: () =>
            appConfirm({
              title: t("background.trayConfirmTitle"),
              message: t("background.trayConfirmBody"),
              kind: "info",
              confirmLabel: t("background.trayConfirmYes"),
              cancelLabel: t("background.trayConfirmNo"),
            }),
        });
        setTray(outcome.on);
        if (!outcome.on) setFailure(outcome);
        await store.set(RUN_IN_TRAY_KEY, outcome.on);
        await store.save();
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  return (
    <SettingCard label={t("background.section")} testId="behavior-background">
      {/* What keeps running, and why a tray icon that did not appear leaves the
          switch off, stand behind the ⓘ (appendix 2.4). */}
      <SettingRow label={t("background.tray")} info={`${t("background.note")}\n\n${t("background.trayInvisibleWhy")}`}>
        <Switch checked={tray} disabled={busy} label={t("background.tray")} onChange={(on) => void toggleTray(on)} />
      </SettingRow>

      {failure && (
        <SettingCardNote>
          <Banner kind="warning" rounded>
            {failure.reason === "failed" ? t("background.trayFailed", { error: failure.error }) : t("background.trayInvisible")}
          </Banner>
        </SettingCardNote>
      )}

      {/* Not a setting — the consequence of the one above, said plainly. */}
      <SettingRow label={t("background.reminders")} desc={tray ? t("background.remindersClosed") : t("background.remindersRunning")} />
    </SettingCard>
  );
}

/**
 * "Start with the system" — a row of the Startup card (appendix 2.4 B1): it is
 * a start behaviour, beside opening the last vault and restoring the windows.
 */
export function AutostartRow() {
  const { t } = useTranslation();
  const [autostart, setAutostart] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Reads the system rather than a remembered flag: the registry entry or
      // LaunchAgent can be removed from outside Plainva, and a switch that
      // shows a state the system does not have is worse than none.
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      const on = await isEnabled().catch(() => false);
      if (alive) setAutostart(on);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggleAutostart = useCallback(async (on: boolean) => {
    setBusy(true);
    try {
      setAutostart(await applyAutostart(on));
    } catch {
      setAutostart(await applyAutostart(false).catch(() => false));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <SettingRow label={t("background.autostart")}>
      <Switch checked={autostart} disabled={busy} label={t("background.autostart")} onChange={(on) => void toggleAutostart(on)} />
    </SettingRow>
  );
}

/**
 * The one-time offer, made where it has a reason: the moment reminders are
 * switched on. Never registers anything unasked, and asks only once.
 */
export async function offerBackgroundOnce(t: (k: string) => string): Promise<void> {
  const store = await getSettingsStore();
  if ((await store.get<boolean>(BACKGROUND_OFFERED_KEY)) === true) return;
  await store.set(BACKGROUND_OFFERED_KEY, true);
  await store.save();
  if ((await store.get<boolean>(RUN_IN_TRAY_KEY)) === true) return;

  const yes = await appConfirm({
    title: t("background.offerTitle"),
    message: t("background.offerBody"),
    kind: "info",
    confirmLabel: t("background.offerYes"),
    cancelLabel: t("background.offerNo"),
  });
  if (!yes) return;

  const outcome = await turnTrayOn({
    enable: enableTray,
    disable: disableTray,
    confirmVisible: () =>
      appConfirm({
        title: t("background.trayConfirmTitle"),
        message: t("background.trayConfirmBody"),
        kind: "info",
        confirmLabel: t("background.trayConfirmYes"),
        cancelLabel: t("background.trayConfirmNo"),
      }),
  });
  await store.set(RUN_IN_TRAY_KEY, outcome.on);
  await store.save();
}
