import { useEffect, useState, type KeyboardEvent } from "react";
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
 * switch and nothing is left half-on. The shortcut is recorded, not typed: the
 * button listens for the next key press with Ctrl, Alt or Cmd/Win.
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

  useEffect(() => {
    let alive = true;
    void readQuickCaptureConfig().then((stored) => { if (alive) setConfig(stored); }).catch(() => undefined);
    const off = onQuickCaptureState((next) => { if (alive) setState(next); });
    return () => { alive = false; off(); };
  }, []);

  const apply = async (next: QuickCaptureConfig) => {
    setBusy(true);
    setConfig(next);
    try {
      setState(await saveQuickCaptureConfig(next));
    } finally {
      setBusy(false);
    }
  };

  const onRecordKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || !config) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(false);
      setHint(null);
      return;
    }
    const read = acceleratorFromEvent(e, mac);
    if (!read.ok) {
      setHint(read.reason === "needs-modifier" ? t("quickCapture.needsModifier") : read.reason === "unsupported" ? t("quickCapture.unsupportedKey") : null);
      return;
    }
    setRecording(false);
    setHint(null);
    void apply({ ...config, shortcut: read.accelerator });
  };

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
            onClick={() => { setRecording((on) => !on); setHint(null); }}
            onKeyDown={onRecordKey}
            onBlur={() => { setRecording(false); setHint(null); }}
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
