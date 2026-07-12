import { registerPlugin } from "@capacitor/core";

/**
 * JS side of the Android share target (M3E package J): MainActivity buffers
 * ACTION_SEND text in the native plugin; the shell polls on boot and on
 * every resume (a warm share always foregrounds the app). Web/iOS return
 * nothing — sharing INTO the app is an Android launcher feature here.
 */

interface ShareTargetPlugin {
  consumePendingShare(): Promise<{ text: string | null; subject: string | null }>;
}

const ShareTarget = registerPlugin<ShareTargetPlugin>("ShareTarget", {
  web: () => ({ consumePendingShare: async () => ({ text: null, subject: null }) }),
});

export async function consumePendingShare(): Promise<{ text: string; subject: string } | null> {
  try {
    const res = await ShareTarget.consumePendingShare();
    if (res.text && res.text.trim()) {
      return { text: res.text, subject: res.subject ?? "" };
    }
  } catch {
    /* plugin absent (web, iOS) */
  }
  return null;
}
