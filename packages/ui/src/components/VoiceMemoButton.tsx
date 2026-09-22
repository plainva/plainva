import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Mic, Trash2 } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { clock } from "./audioPlayer";
import { cx } from "./ui/cx";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { startVoiceMemo, VoiceMemoError, type VoiceMemoPorts, type VoiceMemoRecorder, type VoiceMemoResult } from "../services/voiceMemo";

/**
 * Recording a voice memo, drawn once for both shells (plan X4).
 *
 * One button until it is pressed, then a row: the running time, discard,
 * attach. Two verbs, both named — a take that can only be stopped and not
 * thrown away is a take people are afraid to start.
 *
 * The microphone is asked for on the first tap, never at startup.
 */
export function VoiceMemoButton({ onRecorded, disabled, ports, className }: {
  /** The finished take. Whatever writes it into the vault is the caller's. */
  onRecorded: (result: VoiceMemoResult) => void | Promise<void>;
  disabled?: boolean;
  /** Injected in tests; production uses the platform's recorder. */
  ports?: VoiceMemoPorts;
  className?: string;
}) {
  const { t } = useTranslation();
  const recorderRef = useRef<VoiceMemoRecorder | null>(null);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The meter, once a second. Cheap, and a recording longer than a second is
  // the only kind anyone makes.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSeconds(recorderRef.current?.seconds ?? 0), 500);
    return () => window.clearInterval(id);
  }, [running]);

  // A sheet that closes mid-take must not leave the microphone on.
  useEffect(() => () => recorderRef.current?.discard(), []);

  const begin = useCallback(async () => {
    if (busy || running) return;
    setBusy(true);
    setProblem(null);
    try {
      recorderRef.current = await startVoiceMemo(ports);
      setSeconds(0);
      setRunning(true);
    } catch (error) {
      const reason = error instanceof VoiceMemoError ? error.reason : "failed";
      setProblem(t(`voiceMemo.${reason}`));
    } finally {
      setBusy(false);
    }
  }, [busy, running, ports, t]);

  const attach = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || busy) return;
    setBusy(true);
    try {
      const result = await recorder.stop();
      recorderRef.current = null;
      setRunning(false);
      setSeconds(0);
      // A take of no length is a mis-tap, not a memo.
      if (result.bytes.length > 0) await onRecorded(result);
    } catch (error) {
      const reason = error instanceof VoiceMemoError ? error.reason : "failed";
      setProblem(t(`voiceMemo.${reason}`));
      recorderRef.current = null;
      setRunning(false);
    } finally {
      setBusy(false);
    }
  }, [busy, onRecorded, t]);

  const discard = useCallback(() => {
    recorderRef.current?.discard();
    recorderRef.current = null;
    setRunning(false);
    setSeconds(0);
  }, []);

  if (!running) {
    return (
      <span className={cx("pv-voicememo", className)} data-testid="voice-memo">
        <IconButton
          label={t("voiceMemo.start")}
          disabled={disabled || busy}
          onClick={() => void begin()}
          data-testid="voice-memo-start"
        >
          <Mic size={ICON.ui} />
        </IconButton>
        {problem && <span className="pv-voicememo-problem" role="status">{problem}</span>}
      </span>
    );
  }

  return (
    <span className={cx("pv-voicememo", "pv-voicememo--live", className)} data-testid="voice-memo">
      <span className="pv-voicememo-dot" aria-hidden="true" />
      <span className="pv-voicememo-time" role="timer" data-testid="voice-memo-time">{clock(seconds)}</span>
      <IconButton label={t("voiceMemo.discard")} onClick={discard} data-testid="voice-memo-discard">
        <Trash2 size={ICON.ui} />
      </IconButton>
      <Button
        variant="primary"
        size="sm"
        icon={<Check size={ICON.meta} />}
        disabled={busy}
        onClick={() => void attach()}
        data-testid="voice-memo-attach"
      >
        {t("voiceMemo.attach")}
      </Button>
    </span>
  );
}
