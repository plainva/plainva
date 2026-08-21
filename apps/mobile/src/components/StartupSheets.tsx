import { OkfRecoveryGate } from "./OkfRecoveryGate";
import { WhatsNewSheet } from "./WhatsNewSheet";
import { markReleaseDialogSeen, type ReleaseDialog } from "../services/mobileWhatsNew";
import type { MobileVault } from "../services/vaultService";

/**
 * The two things the app says on its own when it starts.
 *
 * They sit together because they answer the same question — "is there anything
 * from last time you need to know about?" — and because App.tsx is under a line
 * ratchet whose whole point is that feature blocks grow into modules rather
 * than into the shell.
 *
 * The order matters more than it looks: the interrupted conversion is about the
 * user's own files and comes first; the release highlights are about ours. Both
 * take "not now" for an answer, and neither blocks the app behind it.
 */
export function StartupSheets({
  onOpenOkf,
  onReleaseSeen,
  releaseDialog,
  showRelease,
  vault,
}: {
  onOpenOkf: () => void;
  onReleaseSeen: () => void;
  releaseDialog: ReleaseDialog;
  /** Only once the onboarding is behind us — it is this platform's welcome, and
   *  it marks the highlights as seen, so a fresh install never gets both (BS5). */
  showRelease: boolean;
  vault: MobileVault | null;
}) {
  return (
    <>
      {vault && <OkfRecoveryGate onOpen={onOpenOkf} vault={vault} />}
      {showRelease && releaseDialog !== "none" && (
        <WhatsNewSheet
          onClose={() => {
            onReleaseSeen();
            void markReleaseDialogSeen();
          }}
        />
      )}
    </>
  );
}
