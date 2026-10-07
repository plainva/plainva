import {
  isMcpExposedToolName,
  mcpForeignManifest,
  mcpOfferedTools,
  mcpServerTarget,
  type EndpointConfirmText,
  type McpFailure,
  type McpListing,
  type McpNativeHost,
  type McpOAuthBrowser,
  type McpOAuthRedirect,
  type McpOAuthStatus,
  type McpProgramSpec,
  type McpRegisteredServer,
  type McpSandboxInfo,
  type McpServerGrant,
  type McpServerState,
  type McpSignInPlan,
  type McpSignInProblem,
  type ToolManifest,
} from "@plainva/core";
import { McpRuntime, type McpAddResult, type McpCheck, type McpInspection, type McpPromptLook } from "./mcpRuntime";
import { mcpVaultEntryFor, type McpAuditEntry, type McpDeviceStore, type McpServerRecord, type McpVaultStore } from "./mcpStores";

/**
 * Foreign MCP servers in the assistant's session (plan KI-Harness P4.5): the
 * one place where what this DEVICE knows of a server (registered natively,
 * approved here) meets what the open VAULT decided about it (switched on,
 * tools granted, folders allowed).
 *
 * The state it publishes is what the settings show. Nothing is decided on
 * it: whenever a conversation is about to use a server, `servers()` reads
 * both sides again.
 */

export interface AiMcpHost {
  /** The shell's native side. */
  native: McpNativeHost;
  /** The browser a sign-in to a remote server is made in, and the way back from it. */
  browser: McpOAuthBrowser;
  /** The address of Plainva's own description as a client of an authorization server; null where this build has none. */
  clientDocument: string | null;
  /** The device's record of servers and approvals, in the app's data. */
  store: McpDeviceStore;
  /** The app's version, as a server is told who asks. */
  version(): Promise<string>;
}

/** A server as the settings show it: where it stands for this vault, and what is registered. */
export interface AiMcpServer extends McpServerState {
  registered: McpRegisteredServer;
  addedAt: string;
  seen?: McpServerRecord["seen"];
}

export interface AiMcpState {
  /** This shell reaches foreign servers at all. */
  available: boolean;
  /** A program on this device can be a server (the desktop). */
  programs: boolean;
  loaded: boolean;
  servers: AiMcpServer[];
}

export const NO_MCP: AiMcpState = { available: false, programs: false, loaded: false, servers: [] };

/** What a server's prompt expanded to, for the user to read before it is sent as their message. */
export interface McpPromptReview {
  serverId: string;
  /** The user's name for the server. */
  server: string;
  name: string;
  key: string;
  body: { description: string; messages: unknown[] };
  /** Exactly what would be sent. */
  text: string;
  /** Parts that are no text and were left out. */
  dropped: number;
  truncated: boolean;
}

export type McpPromptStart =
  /** The expansion was the approved one: it went as the user's message. */
  | { kind: "sent" }
  /** Nobody approved this expansion yet: the user reads it first. */
  | { kind: "review"; review: McpPromptReview }
  /** The server's texts changed: it is blocked, and nothing was sent. */
  | { kind: "blocked" }
  /** The prompt expanded to no text. */
  | { kind: "empty" }
  /** The server is not ready in this vault, or does not list this prompt. */
  | { kind: "unavailable" }
  | { kind: "failed"; failure: McpFailure };

export class AiMcp {
  private readonly runtime: McpRuntime | null;
  private vault: McpVaultStore | null = null;
  private current: AiMcpState;
  /** Counts the vaults: an answer that arrives for a vault that was closed is dropped. */
  private generation = 0;

  constructor(
    host: AiMcpHost | undefined,
    clock: { now(): Date; newId(): string },
    private readonly publish: (state: AiMcpState) => void,
  ) {
    this.runtime = host
      ? new McpRuntime({
          native: host.native,
          browser: host.browser,
          clientDocument: host.clientDocument,
          store: host.store,
          // A build that cannot name its version is still Plainva; a server learns nothing else about this device.
          client: async () => ({ name: "Plainva", version: (await host.version().catch(() => "")) || "0" }),
          now: clock.now,
          newId: clock.newId,
        })
      : null;
    this.current = host ? { available: true, programs: host.native.programs !== null, loaded: false, servers: [] } : NO_MCP;
  }

  get state(): AiMcpState {
    return this.current;
  }

  private set(next: AiMcpState): void {
    this.current = next;
    this.publish(next);
  }

  /** Another vault, or none: its choices are its own. Connections end, and the programs behind them with them. */
  attach(vault: McpVaultStore | null): void {
    this.vault = vault;
    this.generation++;
    this.runtime?.dispose();
    this.set({ ...this.current, loaded: false, servers: [] });
    if (vault) void this.refresh();
  }

  /** The servers of this device as they stand for this vault — read anew, from the native registry and both files. */
  async servers(): Promise<AiMcpServer[]> {
    if (!this.runtime) return [];
    const [device, entries] = await Promise.all([this.runtime.servers(), this.vault ? this.vault.load() : Promise.resolve({})]);
    return device.map(({ id, registered, record }) => {
      const target = mcpServerTarget(registered);
      const entry = mcpVaultEntryFor(entries, id, target);
      return {
        id,
        label: record.label || id,
        transport: registered.kind === "http" ? ("http" as const) : ("stdio" as const),
        target,
        reviewedTarget: record.target,
        review: record.review,
        snapshot: record.snapshot,
        enabled: entry.enabled,
        grant: entry.grant,
        registered,
        addedAt: record.addedAt,
        ...(record.seen ? { seen: record.seen } : {}),
      };
    });
  }

  /** Reads everything again and publishes it for the settings. */
  async refresh(): Promise<void> {
    if (!this.runtime) return;
    const generation = this.generation;
    const servers = await this.servers().catch(() => null);
    if (generation !== this.generation) return;
    // A native side that does not answer — a browser build has none — offers nothing, and the settings show no card for it.
    this.set({ ...this.current, available: servers !== null, loaded: true, servers: servers ?? [] });
  }

  /** The names a new conversation carries for the foreign tools it may find. Fixed for the conversation, like every tool name. */
  async offeredNames(): Promise<string[]> {
    if (!this.runtime || !this.vault) return [];
    return mcpOfferedTools(await this.servers().catch(() => [])).map((tool) => tool.exposed);
  }

  /** The foreign tools of one run: of the names its conversation was started with, the ones that are offered now. */
  async manifests(names: readonly string[]): Promise<ToolManifest[]> {
    const wanted = new Set(names.filter(isMcpExposedToolName));
    if (!wanted.size || !this.runtime || !this.vault) return [];
    const servers = await this.servers().catch(() => []);
    return mcpOfferedTools(servers)
      .filter((tool) => wanted.has(tool.exposed))
      .map((tool) => mcpForeignManifest(tool, servers.find((server) => server.id === tool.serverId)!.grant));
  }

  /* ---- what the settings do ------------------------------------------------------------------ */

  async addHttp(label: string, url: string, token: string, text: EndpointConfirmText): Promise<McpAddResult> {
    if (!this.runtime) return { ok: false, problem: { kind: "refused", detail: "unavailable" } };
    const result = await this.runtime.addHttp(label, url, token, text);
    await this.refresh();
    return result;
  }

  async addProgram(label: string, spec: McpProgramSpec, values: Readonly<Record<string, string>>, text: EndpointConfirmText): Promise<McpAddResult> {
    if (!this.runtime) return { ok: false, problem: { kind: "refused", detail: "unavailable" } };
    const result = await this.runtime.addProgram(label, spec, values, text);
    await this.refresh();
    return result;
  }

  async remove(id: string): Promise<void> {
    await this.runtime?.remove(id);
    await this.refresh();
  }

  async rename(id: string, label: string): Promise<void> {
    await this.runtime?.rename(id, label);
    await this.refresh();
  }

  async setSecret(id: string, name: string | null, value: string): Promise<void> {
    await this.runtime?.setSecret(id, name, value);
    await this.refresh();
  }

  /** How a remote server can be signed in to; `challenge` is the line it refused a request with. */
  signInPlan(id: string, challenge?: string): Promise<{ ok: true; plan: McpSignInPlan } | { ok: false; problem: McpSignInProblem }> {
    return this.runtime ? this.runtime.signInPlan(id, challenge) : Promise.resolve({ ok: false, problem: "not-offered" });
  }

  /** Makes the sign-in in the browser. What comes of it is the native side's; this side learns whether it worked. */
  async signIn(id: string, plan: McpSignInPlan, clientId?: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; problem: McpSignInProblem }> {
    if (!this.runtime) return { ok: false, problem: "failed" };
    const result = await this.runtime.signIn(id, plan, clientId, signal);
    await this.refresh();
    return result;
  }

  /** Ends a sign-in whose browser came back while nobody waited. Answers with the server's name, or null where nothing was begun. */
  async finishSignIn(redirect: McpOAuthRedirect): Promise<string | null> {
    const id = this.runtime ? await this.runtime.finishSignIn(redirect) : null;
    if (id === null) return null;
    await this.refresh();
    return this.current.servers.find((server) => server.id === id)?.label ?? id;
  }

  signInStatus(id: string): Promise<McpOAuthStatus | null> {
    return this.runtime ? this.runtime.signInStatus(id) : Promise.resolve(null);
  }

  async signOut(id: string): Promise<void> {
    await this.runtime?.signOut(id);
    await this.refresh();
  }

  sandbox(): Promise<McpSandboxInfo> {
    return this.runtime ? this.runtime.sandbox() : Promise.resolve({ kind: "none", works: false });
  }

  /** The end of what a program wrote to its error stream: for a person, never for a model. */
  programLog(id: string): Promise<string> {
    return this.runtime ? this.runtime.log(id) : Promise.resolve("");
  }

  /** Connects to a server and reads what it lists now, for the review. A listing that differs from the approved one blocks the server. */
  async inspect(id: string, signal?: AbortSignal): Promise<McpInspection> {
    if (!this.runtime) throw new Error("unavailable");
    try {
      return await this.runtime.inspect(id, signal);
    } finally {
      await this.refresh();
    }
  }

  /** The user looked at this listing and allowed it. */
  async approve(id: string, listing: McpListing): Promise<boolean> {
    const done = this.runtime ? await this.runtime.approve(id, listing) : false;
    await this.refresh();
    return done;
  }

  /**
   * This vault's choice for a server: whether it uses it, and what it grants.
   * Bound to what is registered now, so that it does not pass to another
   * server that is later registered under the same id.
   */
  async setVault(id: string, change: { enabled?: boolean; grant?: McpServerGrant }): Promise<void> {
    if (!this.vault) return;
    const server = (await this.servers()).find((entry) => entry.id === id);
    if (!server || server.target === null) return;
    const entries = await this.vault.load();
    const before = mcpVaultEntryFor(entries, id, server.target);
    await this.vault.save({ ...entries, [id]: { enabled: change.enabled ?? before.enabled, grant: change.grant ?? before.grant, target: server.target } });
    await this.refresh();
  }

  audit(): Promise<McpAuditEntry[]> {
    return this.vault ? this.vault.audit() : Promise.resolve([]);
  }

  /* ---- what a run does ----------------------------------------------------------------------- */

  /** Before a use: the listing again, against the approved one. A difference blocks the server, and the settings show it. */
  async check(id: string, signal?: AbortSignal): Promise<McpCheck> {
    if (!this.runtime) return { ok: false, reason: "not-approved" };
    const result = await this.runtime.check(id, signal);
    if (!result.ok && result.reason === "blocked") void this.refresh();
    return result;
  }

  call(id: string, tool: string, args: Record<string, unknown>, inputSchema: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!this.runtime) return Promise.reject(new Error("unavailable"));
    return this.runtime.call(id, tool, args, inputSchema, signal);
  }

  /** What a prompt of a server expands to, compared with what was approved. */
  async prompt(id: string, name: string, args: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<McpPromptLook> {
    if (!this.runtime) return { standing: "changed" };
    const look = await this.runtime.prompt(id, name, args, signal);
    if (look.standing === "changed") void this.refresh();
    return look;
  }

  async pinPrompt(id: string, key: string, body: unknown): Promise<void> {
    await this.runtime?.pinPrompt(id, key, body);
  }

  /** One line for this vault's log of calls. */
  log(entry: McpAuditEntry): void {
    void this.vault?.log(entry).catch(() => undefined);
  }

  dispose(): void {
    this.runtime?.dispose();
  }
}
