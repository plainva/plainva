import type { ISettingsStore } from "../platform/settings";

/**
 * Says once per vault that a file is too large to keep a full snapshot history
 * (C21).
 *
 * The trimming itself is silent by construction — `BackupVaultAdapter` keeps one
 * version instead of a hundred and writes nothing about it. Silence would be the
 * wrong answer: the version history is a promise, and a file that quietly keeps
 * only its newest copy breaks that promise exactly when someone reaches for an
 * older one.
 *
 * Once per VAULT, not once per file: a vault with thirty large attachments would
 * otherwise hand out thirty identical warnings, and the thirtieth teaches nothing
 * the first did not. The flag survives restarts for the same reason.
 */
const KEY_PREFIX = "backupLargeFileHintSeen_";

/** Stable per-vault key. The path is base64'd like every other per-vault key. */
export function largeFileHintKey(vaultKey: string): string {
  return `${KEY_PREFIX}${vaultKey}`;
}

export interface LargeFileHintDeps {
  store: ISettingsStore;
  vaultKey: string;
  /** Shows the hint. Called at most once per vault. */
  notify: (path: string, megabytes: number) => void;
}

/**
 * Records the hint as seen and calls `notify` — but only the first time for this
 * vault. Any failure to read or write the flag falls back to NOT showing it: a
 * warning that reappears on every start is worse than one that is missed, and
 * the trimming it describes has no data-loss consequence on its own.
 */
export async function noteLargeFileTrimmed(
  deps: LargeFileHintDeps,
  path: string,
  sizeBytes: number
): Promise<void> {
  const key = largeFileHintKey(deps.vaultKey);
  try {
    if ((await deps.store.get<boolean>(key)) === true) return;
    await deps.store.set(key, true);
    await deps.store.save();
  } catch {
    return;
  }
  deps.notify(path, Math.round(sizeBytes / (1024 * 1024)));
}
