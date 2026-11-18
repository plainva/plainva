import { dailyDayResolver } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";

export const dailyNotesFolderKey = (vaultPath: string) => `dailyNotesFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNotesFormatKey = (vaultPath: string) => `dailyNotesFormat_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/** The two settings that name a daily note in this vault. */
export async function readDailyNaming(vaultPath: string): Promise<{ folder: string; format: string }> {
  const store = await getSettingsStore();
  const folder = (await store.get<string>(dailyNotesFolderKey(vaultPath))) ?? "";
  const format = (await store.get<string>(dailyNotesFormatKey(vaultPath))) ?? "YYYY-MM-DD";
  return { folder, format };
}

/**
 * Which day a daily note's name stands for in this vault (plan
 * Journal-Erweiterungen, X8), read from the two settings that name a daily
 * note. Handed to a query service as soon as it exists — the owner's and an
 * auxiliary window's alike (F8 of release 0.9.0) — and the service waits for
 * the answer, so the first task list after a start already knows a journal
 * stamp (plan Rückmeldungen 2026-11-05, § 3.177 Nr. 2).
 */
export async function readDailyDayOfPath(vaultPath: string): Promise<((path: string) => string | null) | null> {
  return dailyDayResolver(await readDailyNaming(vaultPath));
}
