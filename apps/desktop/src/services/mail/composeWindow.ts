import i18n from "@plainva/ui/i18n";
import { isOwnerWindow } from "../windowContext";
import { getWindowBus } from "../windowBus";
import { openComposeWindow } from "../windowManager";
import type { ComposeSnapshot } from "./composeHandoff";

/**
 * Popping the composer out, from whichever window it was written in (P3).
 *
 * A mail window cannot open the compose window itself: the aux capability
 * withholds `core:webview:allow-create-webview-window` on purpose, so no
 * second window can spawn a third. It asks the owner, which is also the only
 * place that keeps the draft until the new window collects it.
 *
 * The window is TITLED with the subject: two composers in the taskbar are
 * otherwise two entries called "Plainva".
 */
export async function popOutCompose(vaultPath: string, snapshot: ComposeSnapshot): Promise<void> {
  const title = snapshot.subject.trim() || i18n.t("mail.composeTitle");
  if (isOwnerWindow()) {
    await openComposeWindow({ vaultPath, snapshot, title });
    return;
  }
  const bus = await getWindowBus();
  await bus.request("compose-popout", { vaultPath, snapshot, title });
}
