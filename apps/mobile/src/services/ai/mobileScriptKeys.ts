import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { protectedScriptKeys, type ScriptKeyStore } from "@plainva/ui";
import { protectedSecrets } from "../../platform/protectedSecrets";

/**
 * Where the phone keeps the key it signs its script approvals with (plan
 * KI-Harness P5.5): the Keychain on iOS, the Keystore on Android — the same
 * protected storage as the desktop's keychain, and nowhere else.
 *
 * The app in a browser — the dev server, the bundle the E2E runs — has
 * neither. There the key lies in the browser's storage, as the app's other
 * secrets do in a browser (`platform/secureStore.ts`). No device ever takes
 * that branch.
 */
export function mobileScriptKeys(): ScriptKeyStore {
  if (Capacitor.isNativePlatform()) return protectedScriptKeys(protectedSecrets);
  return protectedScriptKeys({
    read: async (key) => (await Preferences.get({ key })).value,
    async compareAndSet(key, expected, value) {
      if ((await Preferences.get({ key })).value !== expected) return false;
      if (value === null) await Preferences.remove({ key });
      else await Preferences.set({ key, value });
      return true;
    },
  });
}
