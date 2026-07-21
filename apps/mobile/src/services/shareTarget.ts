import { registerPlugin } from "@capacitor/core";

/**
 * Cross-platform share target (M3E package J). Android buffers launcher intents
 * in memory; the iOS Share Extension atomically stores the same payload contract
 * in the app-group container. The shell polls on boot and every resume.
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
    /* plugin absent (web or an older native shell) */
  }
  return null;
}
