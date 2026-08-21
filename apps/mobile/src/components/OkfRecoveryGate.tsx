import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { pendingOkfRun } from "../services/okfConversion";
import type { MobileVault } from "../services/vaultService";

/**
 * "A conversion was interrupted" — said at the start, not buried in a menu (P8).
 *
 * The OKF conversion is the only run in the app that writes into every note,
 * and on a phone the normal way it ends is that the OS takes the process away.
 * The vault it leaves behind is incomplete, not broken — every note is valid
 * Markdown either way, because the conversion only adds frontmatter keys — so
 * the right response is to ASK rather than to roll back on sight or to block
 * the app until someone answers.
 *
 * Hence three ways out and no fourth: continue, undo, or decide later. "Later"
 * exists on purpose; a sheet somebody cannot dismiss on their own phone is
 * worse than the state it is warning about. The journal stays until the run is
 * finished or undone, so declining once is not the same as forgetting.
 *
 * It asks once per app start rather than on every vault switch: seeing the
 * same question again after you have just answered it teaches people to
 * dismiss it without reading.
 */
export function OkfRecoveryGate({ vault, onOpen }: { vault: MobileVault; onOpen: () => void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<{ started: string; remaining: number } | null>(null);
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    if (askedFor.current === vault.vaultId) return;
    askedFor.current = vault.vaultId;
    let alive = true;
    void (async () => {
      const open = await pendingOkfRun(vault).catch(() => null);
      if (alive && open) setPending({ started: open.journal.startedAt, remaining: open.remaining });
    })();
    return () => {
      alive = false;
    };
  }, [vault]);

  if (!pending) return null;

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={() => setPending(null)}>
      <div className="pv-sheet m-sheet" data-testid="okf-recovery-gate" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={() => setPending(null)} />
        <p className="m-sheet-title">{t("okf.recoveryTitle")}</p>
        <div className="m-card">
          <p>{t("okf.recoveryBody", { started: new Date(pending.started).toLocaleString() })}</p>
          {pending.remaining >= 0 && (
            <p className="m-hint">{t("okf.recoveryRemaining", { count: pending.remaining })}</p>
          )}
        </div>
        <div className="m-sync-actions">
          <Button
            data-testid="okf-gate-open"
            onClick={() => {
              setPending(null);
              onOpen();
            }}
            variant="primary"
          >
            {t("okf.recoveryOpen")}
          </Button>
          <Button onClick={() => setPending(null)} variant="ghost">
            {t("okf.recoveryLater")}
          </Button>
        </div>
      </div>
    </div>
  );
}
