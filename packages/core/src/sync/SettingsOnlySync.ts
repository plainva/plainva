import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "./ISyncTarget.js";
import type { SettingsSyncRunner } from "./SyncWorker.js";
import { FatalSyncProtocolError } from "../settingsSync/errors.js";

/**
 * The sync of a vault whose FILES are switched off (plan "Verbinden", E3;
 * second review, B3): on the normal interval it pulls and pushes the settings
 * profile and nothing else - no file is listed, downloaded, uploaded or
 * queued from here.
 *
 * The switch itself lives in that profile. With no sync at all while files
 * were off, "off" left the device by one best-effort push and "on" never came
 * back to it: a stopped device cannot learn anything. This keeps the profile
 * moving, so "off" and "on" - and the calendar and mail switches made in the
 * meantime - reach every device. A device the person paused ("Pause sync"), or
 * one signed out, runs nothing at all: that stop is meant.
 *
 * Runs are serialised: a timer tick and `pushSettingsNow` never sync the
 * profile side by side. A failed run is reported and tried again on the next
 * tick.
 */
export class SettingsOnlySync {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly runner: SettingsSyncRunner,
    private readonly target: ISyncTarget,
    private readonly vault: IVaultAdapter,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void = (error) => console.error("[SettingsOnlySync] settings sync failed:", error),
    /**
     * Asked once per session before the first run (R8): the profile is plain
     * text, and never goes next to an encrypted workspace this device may not
     * sync next to. There is no file listing here to show one, so this is the
     * one look at the folder - never one per run. A `FatalSyncProtocolError`
     * ("encrypted-workspace") stops the interval and is handed to `onHeld`;
     * any other error skips this run and asks again on the next.
     */
    private readonly sessionCheck?: () => Promise<void>,
    private readonly onHeld?: (error: FatalSyncProtocolError) => void,
  ) {}

  private sessionChecked = false;

  /** Starts the interval with a run right away (the device may have missed "on"). */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Stops, then waits for a run still in flight. */
  async stopAndDrain(): Promise<void> {
    this.stop();
    await this.chain;
  }

  /** One run now, after any run in flight; failures are reported, never thrown. */
  async pushSettingsNow(): Promise<"pushed" | "held"> {
    await this.runSerially();
    return this.held ? "held" : "pushed";
  }

  private held = false;

  private runSerially(): Promise<void> {
    const run = this.chain.then(async () => {
      try {
        if (this.sessionCheck && !this.sessionChecked) {
          await this.sessionCheck();
          this.sessionChecked = true;
        }
        if (this.runner.guardBeforeCycle) await this.runner.guardBeforeCycle(this.target, this.vault);
        await this.runner.run(this.target, this.vault);
      } catch (error) {
        if (error instanceof FatalSyncProtocolError && error.reason === "encrypted-workspace") {
          this.held = true;
          this.stop();
          this.onHeld?.(error);
          return;
        }
        this.onError(error);
      }
    });
    this.chain = run;
    return run;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.runSerially();
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }
}
