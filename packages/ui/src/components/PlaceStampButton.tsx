import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { cx } from "./ui/cx";
import { IconButton } from "./ui/IconButton";
import { canStampPlace, placeStampEnabled, PlaceError, stampPlace } from "../services/placeStamp";

/**
 * "Add where I am" (plan Journal-Erweiterungen, X7/E6).
 *
 * Absent unless this device was switched on for it AND the platform can answer
 * at all — a button that is always there and always fails is worse than none.
 * One press, one line: `📍 52.5200, 13.4050`, which the person can then edit
 * into a real name. No trail, no history, no online lookup.
 */
export function PlaceStampButton({ onStamped, disabled, className }: {
  /** The finished line. What it does with it is the caller's. */
  onStamped: (line: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const stamp = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onStamped(await stampPlace());
    } catch (error) {
      setProblem(t(`place.${error instanceof PlaceError ? error.reason : "failed"}`));
    } finally {
      setBusy(false);
    }
  }, [busy, onStamped, t]);

  // The switch is read on every render rather than held in state: it lives in
  // the settings screen, which is a different surface, and a stale `false`
  // would leave the button missing until the sheet was closed and reopened.
  if (!canStampPlace() || !placeStampEnabled()) return null;

  return (
    <span className={cx("pv-placestamp", className)} data-testid="place-stamp">
      <IconButton
        label={t("place.add")}
        disabled={disabled || busy}
        onClick={() => void stamp()}
        data-testid="place-stamp-add"
      >
        <MapPin size={ICON.ui} />
      </IconButton>
      {problem && <span className="pv-placestamp-problem" role="status">{problem}</span>}
    </span>
  );
}
