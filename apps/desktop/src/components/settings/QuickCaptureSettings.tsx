import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, SettingCard, SettingCardNote, SettingRow, Switch } from "@plainva/ui";
import { detectMac } from "../WindowControls";
import {
  DEFAULT_QUICK_CAPTURE_SHORTCUT,
  acceleratorFromEvent,
  acceleratorLabels,
  onQuickCaptureState,
  quickCaptureState,
  readQuickCaptureConfig,
  saveQuickCaptureConfig,
  type QuickCaptureConfig,
  type QuickCaptureFailure,
  type QuickCaptureState,
} from "../../services/quickCapture";

/**
 * Global quick capture — Settings → Startup & behavior (plan Journal, J7).
 *
 * Off by default. The switch proves itself instead of predicting: it registers
 * the shortcut, and when the system refuses — another application holds it, the
 * key is not one it knows, the session is Wayland — the reason stands under the
 * switch and nothing is left half-on. The shortcut is recorded, not typed: after
 * a click on the button the next key press with Ctrl, Alt or Cmd/Win is it.
 *
 * The recorder listens on the WINDOW, not on the button (issue 123): WebKit on
 * macOS does not move the focus to a button that is clicked, so a key listener
 * on the button heard nothing there and the recorder could only be left with
 * Escape. A press beside the button, or the window losing the system's focus,
 * ends the recording the way the button's blur used to.
 */
const FAILURE_KEY: Record<QuickCaptureFailure, string> = {
  taken: "quickCapture.failedTaken",
  invalid: "quickCapture.failedInvalid",
  wayland: "quickCapture.failedWayland",
};

export function QuickCaptureSettings() {
  const { t } = useTranslation();
  const mac = detectMac();
  const [config, setConfig] = useState<QuickCaptureConfig | null>(null);
  const [state, setState] = useState<QuickCaptureState>(quickCaptureState);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const recordButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void readQuickCaptureConfig().then((stored) => { if (alive) setConfig(stored); }).catch(() => undefined);
    const off = onQuickCaptureState((next) => { if (alive) setState(next); });
    return () => { alive = false; off(); };
  }, []);

  const apply = useCallback(async (next: QuickCaptureConfig) => {
    setBusy(true);
    setConfig(next);
    try {
      setState(await saveQuickCaptureConfig(next));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!recording || !config) return;
    const stop = () => { setRecording(false); setHint(null); };
    const onKey = (e: KeyboardEvent) => {
      // Capture phase, and nothing behind it: while the recorder listens, a key
      // press is the shortcut being chosen, not a command of the app.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { stop(); return; }
      const read = acceleratorFromEvent(e, mac);
      if (!read.ok) {
        setHint(read.reason === "needs-modifier" ? t("quickCapture.needsModifier") : read.reason === "unsupported" ? t("quickCapture.unsupportedKey") : null);
        return;
      }
      stop();
      void apply({ ...config, shortcut: read.accelerator });
    };
    const onPointer = (e: PointerEvent) => {
      // The button itself toggles on its click.
      if (e.target instanceof Node && recordButton.current?.contains(e.target)) return;
      stop();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording, config, mac, t, apply]);

  if (!config) return null;
  const failure = state.status === "failed" && config.enabled ? state : null;

  return (
    <SettingCard label={t("quickCapture.section")}>
      <SettingRow label={t("quickCapture.enable")} desc={t("quickCapture.enableDesc")}>
        <Switch
          checked={config.enabled}
          disabled={busy}
          label={t("quickCapture.enable")}
          onChange={(enabled) => void apply({ ...config, enabled })}
        />
      </SettingRow>

      <SettingRow label={t("quickCapture.shortcut")} desc={recording ? t("quickCapture.recording") : undefined}>
        <div className="pv-capture-quick">
          <span className="pv-journal-keys" data-testid="quick-capture-shortcut" aria-label={acceleratorLabels(config.shortcut, mac).join(" + ")}>
            {acceleratorLabels(config.shortcut, mac).map((cap, i) => <kbd key={i} className="pv-journal-key">{cap}</kbd>)}
          </span>
          <Button
            variant={recording ? "primary" : "secondary"}
            size="sm"
            disabled={busy}
            ref={recordButton}
            onClick={() => { setRecording((on) => !on); setHint(null); }}
            data-testid="quick-capture-record"
          >
            {t("quickCapture.record")}
          </Button>
          {config.shortcut !== DEFAULT_QUICK_CAPTURE_SHORTCUT && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void apply({ ...config, shortcut: DEFAULT_QUICK_CAPTURE_SHORTCUT })} data-testid="quick-capture-reset">
              {t("quickCapture.reset")}
            </Button>
          )}
        </div>
      </SettingRow>

      {hint && <SettingCardNote><span role="status">{hint}</span></SettingCardNote>}

      {failure && (
        <SettingCardNote>
          <Banner kind="warning" rounded>{t(FAILURE_KEY[failure.reason])}</Banner>
        </SettingCardNote>
      )}

      <SettingCardNote>{t("quickCapture.note")}</SettingCardNote>
    </SettingCard>
  );
}
