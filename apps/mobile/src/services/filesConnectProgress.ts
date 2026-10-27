/**
 * What the files step of a connect is doing after the folder was picked
 * (device finding 2026-10-27). The picker closes at once, and what follows -
 * the account checked, the local notes and the accounts copied - can take a
 * while (the cloud folder's files come later, through the sync); with nothing on screen the step looked as if it had come back
 * to its start. A module of its own: the transfer and the screen both read
 * it, and neither has to load the sign-in to do so.
 */
export type FilesConnectProgress =
  | { phase: "checking" }
  | { phase: "copying" };

export const FILES_CONNECT_PROGRESS_EVENT = "m-files-connect-progress";

let current: FilesConnectProgress | null = null;

export function filesConnectProgress(): FilesConnectProgress | null {
  return current;
}

export function setFilesConnectProgress(next: FilesConnectProgress | null): void {
  current = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FILES_CONNECT_PROGRESS_EVENT));
}
