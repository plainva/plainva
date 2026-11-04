import {
  appendAiLedgerEntry,
  EMPTY_USAGE,
  gateDecision,
  GistReader,
  GistStore,
  GistWriter,
  type GistPass,
  type IDatabaseAdapter,
  type PackageGists,
} from "@plainva/core";
import type { AiLedgerStore, LocalCompletion } from "./aiSession";
import type { VaultPolicyHost } from "./aiVaultHost";

/**
 * Gists in one vault (plan KI-Harness P2b-3), the same way in both shells:
 * written by the model of the profile "Local" on this computer, never a cloud
 * in the background. Opt-in by the device setting; while it is on and the
 * profile names a model on this computer, passes run when the device may work
 * (an idle moment on the desktop, the foreground on the phone) and again a
 * little while after the notes change. The package reads only checked gists
 * of the current model (`reader`), never a stale one.
 */

export interface LocalGistsHost {
  db: IDatabaseAdapter;
  readText(path: string): Promise<string | null>;
  /** The vault's privacy rules: only notes a cloud may see go into an area's or the vault's gist. */
  policy: Pick<VaultPolicyHost, "policyOf">;
  encrypted(): boolean;
  /** Resolves when the device may take the next step. */
  ready?(signal: AbortSignal): Promise<void>;
  /** The vault's run ledger: one entry per pass, what the model was asked. */
  ledger?: AiLedgerStore;
  now(): Date;
  newId(): string;
}

export type LocalGistsState =
  | { kind: "off" }
  /** The setting is on, but the profile "Local" names no model on this computer. */
  | { kind: "no-model" }
  | {
      kind: "on";
      model: string;
      working: boolean;
      paused: boolean;
      sections: number;
      covered: number;
      rejected: number;
      failure: string | null;
    };

/** A pass waits this long after the last change: typing produces many. */
const SETTLE_MS = 10_000;
/** A server that could not be reached is tried again at most this often. */
const RETRY_MS = 60_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class LocalGists {
  private state: LocalGistsState = { kind: "off" };
  private readonly listeners = new Set<() => void>();
  private completion: LocalCompletion | null = null;
  private enabled = false;
  private run: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Why writing stands still: the reader paused it, or the app is in the background. Either holds it. */
  private readonly pauses = new Set<"user" | "background">();
  private failedAt = 0;
  private again = false;

  constructor(private readonly host: LocalGistsHost) {}

  snapshot = (): LocalGistsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(state: LocalGistsState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private patch(change: Partial<Extract<LocalGistsState, { kind: "on" }>>): void {
    if (this.state.kind === "on") this.set({ ...this.state, ...change });
  }

  /** The device setting and the profile "Local" (read at start, and on every change). */
  update({ enabled, completion }: { enabled: boolean; completion: LocalCompletion | null }): void {
    const model = completion ? `${completion.providerId}/${completion.model}` : null;
    const same = enabled === this.enabled && model === (this.completion ? `${this.completion.providerId}/${this.completion.model}` : null);
    this.enabled = enabled;
    this.completion = completion;
    if (same && this.state.kind !== "off") return;
    this.stop();
    if (!enabled) {
      this.set({ kind: "off" });
      return;
    }
    if (!completion || !model) {
      this.set({ kind: "no-model" });
      return;
    }
    this.set({ kind: "on", model, working: false, paused: this.pauses.has("user"), sections: 0, covered: 0, rejected: 0, failure: null });
    void this.refreshCounts();
    this.schedule(2_000);
  }

  /** The notes changed: a pass follows once the changes settle. A server that failed is tried again, at most once a minute. */
  indexChanged(): void {
    if (this.state.kind !== "on") return;
    if (this.state.failure && Date.now() - this.failedAt < RETRY_MS) return;
    if (this.run) {
      this.again = true;
      return;
    }
    this.schedule(SETTLE_MS);
  }

  pause(reason: "user" | "background" = "user"): void {
    this.pauses.add(reason);
    this.run?.abort();
    this.patch({ paused: this.pauses.has("user"), working: false });
  }

  /** Lifts one reason; writing goes on once none is left — a return to the foreground does not undo the reader's pause. */
  resume(reason: "user" | "background" = "user"): void {
    this.pauses.delete(reason);
    this.patch({ paused: this.pauses.has("user") });
    if (!this.pauses.size) this.schedule(0);
  }

  /** Removes every gist of this vault; a running pass stops first. */
  async clear(): Promise<void> {
    this.stop();
    await new GistStore(this.host.db).dropAll();
    this.patch({ sections: 0, covered: 0, rejected: 0 });
    if (this.state.kind === "on") this.schedule(SETTLE_MS);
  }

  /** What the context package reads, while gists are on and a model on this computer writes them. */
  reader(): PackageGists | null {
    if (this.state.kind !== "on") return null;
    return new GistReader(this.host.db, this.state.model);
  }

  close(): void {
    this.stop();
    this.listeners.clear();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.run?.abort();
    this.run = null;
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pass();
    }, ms);
  }

  private async refreshCounts(): Promise<void> {
    if (this.state.kind !== "on") return;
    const counts = await new GistStore(this.host.db).counts(this.state.model).catch(() => null);
    if (counts) this.patch({ rejected: counts.section.rejected });
  }

  private async pass(): Promise<void> {
    const completion = this.completion;
    if (this.state.kind !== "on" || this.pauses.size || this.run || !completion) return;
    const controller = new AbortController();
    this.run = controller;
    this.again = false;
    this.patch({ working: true, failure: null });
    let requests = 0;
    const usage = { ...EMPTY_USAGE };
    const model = {
      id: `${completion.providerId}/${completion.model}`,
      complete: async (instruction: string, text: string, signal?: AbortSignal) => {
        requests++;
        const answer = await completion.complete(instruction, text, signal);
        usage.inputTokens += answer.usage.inputTokens;
        usage.outputTokens += answer.usage.outputTokens;
        return answer.text;
      },
    };
    const cloud = { recipient: { kind: "cloud" as const, provider: "gists", model: "gists" }, webTools: false };
    const writer = new GistWriter(
      {
        db: this.host.db,
        readText: this.host.readText,
        cloudAllowed: async (path, text) => !this.host.encrypted() && gateDecision(await this.host.policy.policyOf(path, text), cloud).allowed,
        ready: this.host.ready,
        now: () => this.host.now().getTime(),
      },
      model,
    );
    let outcome: GistPass | null = null;
    try {
      outcome = await writer.run(controller.signal, (progress) => this.patch({ sections: progress.sections, covered: progress.covered }));
    } catch (error) {
      if (!controller.signal.aborted) {
        this.failedAt = Date.now();
        this.patch({ failure: errorText(error) });
      }
    } finally {
      if (this.run === controller) this.run = null;
      this.patch({ working: false });
    }
    if (outcome) this.patch({ sections: outcome.sections, covered: outcome.covered });
    void this.refreshCounts();
    if (requests > 0) await this.record(completion, requests, usage, outcome ? "answered" : "failed");
    if (this.again && !this.pauses.size) this.schedule(SETTLE_MS);
  }

  /** One ledger entry per pass: a model on this computer costs nothing, but what it was asked is still told. */
  private async record(completion: LocalCompletion, requests: number, usage: typeof EMPTY_USAGE, stop: "answered" | "failed"): Promise<void> {
    const ledger = this.host.ledger;
    if (!ledger) return;
    try {
      await ledger.save(
        appendAiLedgerEntry(await ledger.load(), {
          at: this.host.now().toISOString(),
          conversationId: `gists-${this.host.newId()}`,
          providerId: completion.providerId,
          model: completion.model,
          stop,
          steps: requests,
          tools: [],
          usage,
        }),
      );
    } catch {
      // The gists count even when app data cannot be written.
    }
  }
}
