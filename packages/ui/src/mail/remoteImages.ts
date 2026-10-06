import { isJunkFolder, type MailboxLike } from "./junk";

/**
 * May remote images load for this view? One rule for both shells (plan Befunde
 * 06.10., M2). It used to be written twice — `always || once` in each mail
 * surface — and neither copy looked at the folder.
 *
 * Loading a remote image tells the sender that the message was opened, when,
 * and from which address. For ordinary mail the reader may decide that once
 * and for all ("always load"). For spam that decision must not carry over: a
 * message nobody asked for is exactly the one whose sender should learn
 * nothing. So in the junk folder only the release for THIS view counts.
 *
 * Three inputs:
 *
 *  - `always`  — the per-vault setting "Always load remote images".
 *  - `once`    — the reader released this message for this view; it resets
 *                when the message is opened again.
 *  - `folder`  — whether the folder the MESSAGE lives in is the junk folder.
 *                Not the folder that happens to be open: a conversation mixes
 *                folders. While that is not known yet (the folder list has
 *                not arrived), the message is treated as junk — the cautious
 *                reading costs one render without pictures, the other one
 *                costs a tracking hit that cannot be taken back.
 */

export type MessageJunkState = "junk" | "notJunk" | "unknown";

export interface RemoteImagesInput {
  always: boolean;
  once: boolean;
  folder: MessageJunkState;
}

export interface RemoteImagesDecision {
  /** Remote https images may load in this view. */
  allow: boolean;
  /**
   * The folder is the reason nothing loads although "always" is on, or the
   * message simply lies in the junk folder: the hint then names the folder
   * instead of the general default.
   */
  blockedAsJunk: boolean;
}

export function remoteImagesDecision(input: RemoteImagesInput): RemoteImagesDecision {
  const allow = input.folder === "notJunk" ? input.always || input.once : input.once;
  return { allow, blockedAsJunk: !allow && input.folder === "junk" };
}

/**
 * Whether the folder a message came from is the junk folder.
 *
 * `folders` is the folder list together with the account it belongs to: a
 * list of ANOTHER account (the one that was open a moment ago) says nothing
 * about this message, and neither does a list that has not loaded — both are
 * "unknown".
 */
export function messageJunkState(
  origin: { accountId: string; mailbox: string } | null,
  folders: { accountId: string; boxes: readonly MailboxLike[] } | null
): MessageJunkState {
  if (!origin || !origin.mailbox || !folders || folders.accountId !== origin.accountId || folders.boxes.length === 0) {
    return "unknown";
  }
  return isJunkFolder(origin.mailbox, folders.boxes) ? "junk" : "notJunk";
}
