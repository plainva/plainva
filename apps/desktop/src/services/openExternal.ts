import { guardedExternalOpener } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * The desktop's ONE way to hand an address to the system (Sammelplan § 3.138).
 *
 * It is what `main.tsx` registers as `openExternal`, and every desktop
 * surface that opens a web, mail or phone address imports it instead of the
 * opener plugin. The plugin's capability (`opener:default`) already refuses
 * other schemes; checking first in the shared rule makes the refusal — and
 * the sentence the person reads — the same as on the phone, and keeps a later
 * widening of the capability from reaching a link in a synced note
 * (`externalUrl.test.ts` keeps the plugin's `openUrl` to this file).
 */
export function openExternalUrl(url: string): Promise<void> {
  // Wrapped per call, not at load: no work across a package boundary while
  // the module loads (moduleInitBoundary.test.ts).
  return guardedExternalOpener((allowed) => openUrl(allowed))(url);
}
