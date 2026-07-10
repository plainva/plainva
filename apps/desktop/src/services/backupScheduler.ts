import { getSettingsStore } from "./settingsStore";
import { IVaultAdapter, VersionHistoryService } from "@plainva/core";
import {
  ZIP_INTERVAL_MS,
  backupPruneLastRunKey,
  loadBackupRetentionSettings,
  loadZipBackupSettings,
} from "./backupPolicy";
import { isZipRunning, runVaultZipBackup } from "./vaultZipBackup";

/** Pure due-check for the daily auto ZIP (unit-tested). */
export function shouldRunZip(s: { enabled: boolean; lastRun: number; now: number; running: boolean }): boolean {
  return s.enabled && !s.running && s.now - s.lastRun > ZIP_INTERVAL_MS;
}

const INITIAL_ZIP_DELAY_MS = 30_000; // idle window after vault open
const INITIAL_PRUNE_DELAY_MS = 45_000;
const TICK_MS = 30 * 60_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Per-vault background loop: daily ZIP backup (checked 30 s after open, then
 * every 30 min) and daily snapshot age-pruning. Settings are re-read from the
 * store on every tick, so changes apply without a restart. Also serves the
 * manual `plainva-backup-now` window event. Returns a disposer.
 */
export function startBackupScheduler(opts: { vaultPath: string; adapter: IVaultAdapter }): () => void {
  const { vaultPath, adapter } = opts;
  let stopped = false;
  const timeouts: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];

  const zipTick = async (manual = false) => {
    if (stopped) return;
    try {
      const store = await getSettingsStore();
      const settings = await loadZipBackupSettings(store, vaultPath);
      const due = manual
        ? !isZipRunning() // manual runs bypass the 24h check, never the guard
        : shouldRunZip({ enabled: settings.enabled, lastRun: settings.lastRun, now: Date.now(), running: isZipRunning() });
      if (due) {
        await runVaultZipBackup({ vaultPath, store });
      }
    } catch (e) {
      console.warn("[backupScheduler] zip tick failed", e);
    }
  };

  const pruneTick = async () => {
    if (stopped) return;
    try {
      const store = await getSettingsStore();
      const last = (await store.get<number>(backupPruneLastRunKey(vaultPath))) ?? 0;
      if (Date.now() - last <= PRUNE_INTERVAL_MS) return;
      const { maxAgeDays } = await loadBackupRetentionSettings(store, vaultPath);
      const service = new VersionHistoryService(adapter);
      // deleteItem hard-deletes .plainva paths (TauriVaultAdapter), so pruning
      // never floods the OS trash.
      const result = await service.pruneOldBackups({ maxAgeDays });
      await store.set(backupPruneLastRunKey(vaultPath), Date.now());
      await store.save();
      if (result.deletedFiles > 0 || result.deletedBatchFolders > 0) {
        console.log(
          `[backupScheduler] pruned ${result.deletedFiles} snapshots, ${result.deletedBatchFolders} batch folders`
        );
      }
    } catch (e) {
      console.warn("[backupScheduler] prune failed", e);
    }
  };

  const onManualBackup = (e: Event) => {
    const detail = (e as CustomEvent).detail as { vaultPath?: string } | undefined;
    if (detail?.vaultPath && detail.vaultPath !== vaultPath) return;
    void zipTick(true);
  };

  timeouts.push(setTimeout(() => void zipTick(), INITIAL_ZIP_DELAY_MS));
  timeouts.push(setTimeout(() => void pruneTick(), INITIAL_PRUNE_DELAY_MS));
  intervals.push(
    setInterval(() => {
      void zipTick();
      void pruneTick();
    }, TICK_MS)
  );
  window.addEventListener("plainva-backup-now", onManualBackup);

  return () => {
    stopped = true;
    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    window.removeEventListener("plainva-backup-now", onManualBackup);
  };
}
