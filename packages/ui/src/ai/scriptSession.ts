import {
  deviceScriptPublicKey,
  newDeviceScriptKey,
  runScript,
  scriptSeal,
  signScriptApproval,
  verifyScriptApproval,
  type DeviceScriptKey,
  type InstructionSource,
  type RunWrites,
  type ScriptApprovalCheck,
  type ScriptCallRecord,
  type ScriptDefinition,
  type ScriptOutcome,
  type ScriptSandbox,
  type ToolExecutor,
} from "@plainva/core";
import type { ProtectedSecretStore } from "../lib/passwordChangeJournal";

/**
 * Scripts on this device (ADR 0020 decision 6, plan KI-Harness P5.5): the key
 * this device signs its approvals with, and a run started from the workshop.
 * One implementation for both shells — a shell hands in where the key is kept
 * (its keychain) and the sandbox (the script worker).
 */

/** Where this device keeps the key it signs script approvals with: its keychain. */
export interface ScriptKeyStore {
  /** The key; null while this device has none. Rejects where the keychain cannot be read. */
  load(): Promise<DeviceScriptKey | null>;
  save(key: DeviceScriptKey): Promise<void>;
}

export interface AiScriptsHost {
  sandbox: ScriptSandbox;
  keys: ScriptKeyStore;
}

/** The keychain slot of the key this device signs its script approvals with. */
export const SCRIPT_KEY_SLOT = "plainva-ai-script-key";

function readStoredKey(raw: string | null): DeviceScriptKey | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { seed?: unknown } | null;
    return value && typeof value.seed === "string" ? { seed: value.seed } : null;
  } catch {
    return null;
  }
}

/**
 * The script key in the device's protected storage — its keychain, its
 * keystore — and nowhere else: where that storage cannot be read or written,
 * the calls reject, and no script is approved or active. The key is written
 * only where there is none, so two windows that approve at the same moment
 * end up with one key.
 */
export function protectedScriptKeys(secrets: ProtectedSecretStore): ScriptKeyStore {
  return {
    load: async () => readStoredKey(await secrets.read(SCRIPT_KEY_SLOT)),
    async save(key) {
      const current = await secrets.read(SCRIPT_KEY_SLOT);
      if (readStoredKey(current)) return;
      // What is there and is no key — a damaged entry — is replaced; anything else was written by another window in between.
      await secrets.compareAndSet(SCRIPT_KEY_SLOT, current, JSON.stringify({ seed: key.seed }));
    },
  };
}

/** A run the workshop started, as its dialog shows it. */
export interface ScriptRunState {
  /** The script's source id. */
  id: string;
  /** A dry run: what shows or changes something was only written down. */
  dry: boolean;
  running: boolean;
  /** The tool calls so far, in order. */
  calls: ScriptCallRecord[];
  outcome: ScriptOutcome | null;
  /**
   * What the run laid down so far (plan P5.5, second stage): suggestion rounds
   * by note and drafts by id. Null for a script that names no writing tool,
   * and for a dry run — which lays nothing down.
   */
  writes: RunWrites | null;
}

export interface AiScriptsState {
  /** Whether this device can run scripts at all: a sandbox that works, a keychain to sign with. */
  available: boolean;
  run: ScriptRunState | null;
}

/** Why a script could not be approved here. */
export type ScriptApprovalRefusal = "changed" | "no-key" | "unavailable";

const isKey = (value: unknown): value is DeviceScriptKey => Boolean(value) && typeof value === "object" && typeof (value as { seed?: unknown }).seed === "string";

export class AiScripts {
  /** The key once it was read; a device without one is asked again each time — another window may have made it since. */
  private key: DeviceScriptKey | null = null;
  private abort: AbortController | null = null;
  state: AiScriptsState;

  constructor(
    private readonly host: AiScriptsHost | undefined,
    private readonly publish: (state: AiScriptsState) => void,
  ) {
    this.state = { available: this.available(), run: null };
  }

  /** The sandbox where this device has one that can run. */
  get sandbox(): ScriptSandbox | null {
    return this.host && this.safely(() => this.host!.sandbox.available()) ? this.host.sandbox : null;
  }

  available(): boolean {
    return this.sandbox !== null;
  }

  private safely(ask: () => boolean): boolean {
    try {
      return ask();
    } catch {
      return false;
    }
  }

  private set(patch: Partial<AiScriptsState>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }

  /** This device's key; null where it has none or its keychain cannot be read. */
  private async loadKey(): Promise<DeviceScriptKey | null> {
    if (this.key) return this.key;
    if (!this.host) return null;
    const stored = await this.host.keys.load().catch(() => null);
    if (isKey(stored) && deviceScriptPublicKey(stored)) this.key = stored;
    return this.key;
  }

  /**
   * How a vault's script approvals are held against this device's key
   * (`instructionStatus`). Without a key — none made yet, or a keychain that
   * cannot be read — every approval is one this device did not give.
   */
  async signedCheck(vaultKey: string | undefined): Promise<ScriptApprovalCheck> {
    const key = vaultKey ? await this.loadKey() : null;
    const publicKey = key ? deviceScriptPublicKey(key) : null;
    if (!publicKey || !vaultKey) return () => false;
    return (source, approval) => verifyScriptApproval(publicKey, vaultKey, source.id, scriptSeal(source.files), approval.signature ?? "");
  }

  /**
   * This device's signature under an approval of the script as it is now.
   * The key is made when the first script is approved here and kept in the
   * keychain. Null where the keychain refuses: nothing is approved then.
   */
  async sign(vaultKey: string | undefined, source: InstructionSource): Promise<string | null> {
    if (!this.host || !vaultKey || source.kind !== "script") return null;
    let key = await this.loadKey();
    if (!key) {
      const made = newDeviceScriptKey();
      try {
        await this.host.keys.save(made);
        // What the keychain holds now is the key: another window may have been first.
        const stored = await this.host.keys.load();
        key = isKey(stored) && deviceScriptPublicKey(stored) ? stored : null;
      } catch {
        key = null;
      }
      this.key = key;
    }
    return key ? signScriptApproval(key, vaultKey, source.id, scriptSeal(source.files)) : null;
  }

  /** Whether the code is JavaScript the engine reads; null where this device cannot ask. */
  async check(code: string): Promise<{ ok: true } | { ok: false; message: string } | null> {
    const sandbox = this.sandbox;
    return sandbox ? sandbox.check(code).catch(() => null) : null;
  }

  /**
   * Runs a script for the workshop: its calls go to `tools` — the vault's
   * tools as a reader on this device gets them —, and what it did is shown
   * as it happens. One run at a time; a second start while one runs is none.
   */
  async run(input: { id: string; script: ScriptDefinition; code: string; args: unknown; dry: boolean; tools: ToolExecutor; writes?: RunWrites }): Promise<ScriptOutcome | null> {
    const sandbox = this.sandbox;
    if (!sandbox || this.state.run?.running) return null;
    const abort = new AbortController();
    this.abort = abort;
    let made = 0;
    const calls: ScriptCallRecord[] = [];
    // `writes` is the list the run's writing tools fill: shown as it grows, as a copy of that moment.
    const laid = (): RunWrites | null => (input.writes ? { rounds: [...input.writes.rounds], drafts: [...input.writes.drafts], plans: [...input.writes.plans] } : null);
    this.set({ run: { id: input.id, dry: input.dry, running: true, calls: [], outcome: null, writes: laid() } });
    const outcome = await runScript({
      script: input.script,
      code: input.code,
      input: input.args,
      sandbox,
      dry: input.dry,
      signal: abort.signal,
      execute: (tool, args, stop) => input.tools.execute(tool, args, { type: "tool_call", id: `script-${++made}`, name: tool.name, args }, stop),
      onCall: (record) => {
        calls.push(record);
        if (this.abort === abort) this.set({ run: { id: input.id, dry: input.dry, running: true, calls: [...calls], outcome: null, writes: laid() } });
      },
    });
    if (this.abort === abort) {
      this.abort = null;
      this.set({ run: { id: input.id, dry: input.dry, running: false, calls: outcome.calls, outcome, writes: laid() } });
    }
    return outcome;
  }

  /** Stops the run the workshop started. */
  stop(): void {
    this.abort?.abort();
  }

  /** Forgets what the last run showed (its dialog was closed, or the vault changed). */
  clear(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.state.run) this.set({ run: null });
  }
}
