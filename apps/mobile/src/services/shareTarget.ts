import { registerPlugin } from "@capacitor/core";

/**
 * JS side of the Android share target (M3E package J): MainActivity buffers an
 * ACTION_SEND / ACTION_SEND_MULTIPLE payload in the native plugin — plain text
 * as text+subject, images and arbitrary files as base64 file payloads. The
 * shell polls on boot and on every resume (a warm share always foregrounds the
 * app). Web/iOS return nothing from THIS poll — iOS sharing INTO the app
 * arrives through its own Share Extension; this is an Android launcher feature.
 */

export interface SharedFile {
  name: string;
  mime: string;
  /** base64 (no line wrap). */
  data: string;
}

interface ShareTargetPlugin {
  consumePendingShare(): Promise<{ text: string | null; subject: string | null; files?: SharedFile[] }>;
}

const ShareTarget = registerPlugin<ShareTargetPlugin>("ShareTarget", {
  web: () => ({ consumePendingShare: async () => ({ text: null, subject: null, files: [] }) }),
});

export interface PendingShare {
  text: string;
  subject: string;
  files: SharedFile[];
}

export async function consumePendingShare(): Promise<PendingShare | null> {
  try {
    const res = await ShareTarget.consumePendingShare();
    const files = Array.isArray(res.files) ? res.files.filter((f) => f && typeof f.data === "string") : [];
    const text = res.text && res.text.trim() ? res.text : "";
    if (text || files.length > 0) return { text, subject: res.subject ?? "", files };
  } catch {
    /* plugin absent (web, iOS) */
  }
  return null;
}
