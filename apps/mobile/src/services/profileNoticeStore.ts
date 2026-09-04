/**
 * The phone's memory of which profile change was already announced.
 *
 * `shouldAnnounceProfileImport` reads and writes synchronously through a
 * storage-like object. On the desktop that is localStorage. On the phone the
 * only storage the app trusts with anything durable is the settings store
 * (Capacitor Preferences) - the device id and the secret slots live there -
 * so the memory is primed from it once per sync cycle and written through.
 * A WebView's localStorage can be emptied by a WebView update or by the OS
 * under pressure, which is one way "once" turns back into "every start"
 * (finding 2026-09-04).
 */
import { getPlatformServices, type ProfileNoticeStorage } from "@plainva/ui";

const noticeKey = (vaultId: string) => `profile-announced_${vaultId}`;

export async function profileNoticeStorage(vaultId: string): Promise<ProfileNoticeStorage> {
  const store = await getPlatformServices().loadSettings();
  const key = noticeKey(vaultId);
  let current = (await store.get<string>(key)) ?? null;
  const persist = (work: Promise<unknown>) => {
    void work.then(() => store.save()).catch(() => {
      // Not persisted: the primed value still holds for this cycle.
    });
  };
  return {
    getItem: () => current,
    setItem: (_key, value) => {
      current = value;
      persist(store.set(key, value));
    },
    removeItem: () => {
      current = null;
      persist(store.delete(key));
    },
  };
}

/** The vault was forgotten on this device: so is what was announced for it. */
export async function forgetProfileNotice(vaultId: string): Promise<void> {
  try {
    const store = await getPlatformServices().loadSettings();
    await store.delete(noticeKey(vaultId));
    await store.save();
  } catch {
    // Best effort, like the other device-local memories.
  }
}
