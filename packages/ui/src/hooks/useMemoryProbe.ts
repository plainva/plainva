import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { memoryProbeResult, runMemoryProbe, type MemoryProbeResult } from "../lib/memoryProbe";

/**
 * The row „Speicher messen“ of both shells' About & Diagnostics (L14): the
 * last result as one line, and the run. One answer for the desktop's row and
 * the phone's.
 */
export function useMemoryProbe(): { running: boolean; line: string | null; run: () => void } {
  const { t } = useTranslation();
  const [result, setResult] = useState<MemoryProbeResult | null>(() => memoryProbeResult());
  const [running, setRunning] = useState(false);
  const run = useCallback(() => {
    if (running) return;
    setRunning(true);
    void runMemoryProbe()
      .then(setResult)
      .finally(() => setRunning(false));
  }, [running]);
  const mb = (chars: number) => (chars / 1e6).toFixed(1);
  const line = running
    ? t("settings.memoryProbeRunning")
    : result
      ? result.endedAt
        ? t("settings.memoryProbeEnded", { size: mb(result.endedAt.chars), largest: mb(result.largest) })
        : t("settings.memoryProbeResult", { size: mb(result.largest) })
      : null;
  return { running, line, run };
}
