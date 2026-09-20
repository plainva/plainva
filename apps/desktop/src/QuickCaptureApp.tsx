import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen, X } from "lucide-react";
import { Banner, ICON, IconButton, JournalCaptureField } from "@plainva/ui";
import { getWindowBus } from "./services/windowBus";

/**
 * The quick-capture window of the global shortcut (plan Journal, J7): the
 * journal's capture field and nothing else. It holds a text — no vault, no
 * write access (capabilities/capture-window.json). Enter hands the text to the
 * central window, which writes it into today's daily note of the vault it
 * shows; then the window closes. A refusal is shown here, where it can be seen,
 * and the text stays.
 *
 * Esc discards, as the hint says. Losing the focus does NOT close the window:
 * a half-written thought must survive a look into another window.
 */
export function QuickCaptureApp() {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [asTask, setAsTask] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* no backend (browser/test): nothing to close */
    }
  }, []);

  const submit = () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const bus = await getWindowBus();
        const result = await bus.request("journal-capture", { text: value, task: asTask });
        if (result.ok) await close();
        else setError(result.message);
      } catch {
        // No answer at all: the central window is gone or busy past the timeout.
        setError(t("quickCapture.failed"));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="pv-journal-quick" data-testid="quick-capture">
      <div className="pv-journal-quick-bar" data-tauri-drag-region>
        <NotebookPen size={ICON.ui} aria-hidden />
        <span className="pv-journal-quick-title" data-tauri-drag-region>{t("journal.newEntry")}</span>
        <IconButton label={t("common.close")} size="sm" onClick={() => void close()} data-testid="quick-capture-close">
          <X size={ICON.ui} />
        </IconButton>
      </div>
      <JournalCaptureField
        testId="quick-capture-field"
        autoFocus
        rows={3}
        value={value}
        onChange={(next) => { setValue(next); if (error) setError(null); }}
        asTask={asTask}
        onAsTask={setAsTask}
        onSubmit={submit}
        onCancel={() => void close()}
        disabled={busy}
        hint={error ? null : undefined}
      />
      {error && (
        <div data-testid="quick-capture-error">
          <Banner kind="error" rounded>{error}</Banner>
        </div>
      )}
    </div>
  );
}
