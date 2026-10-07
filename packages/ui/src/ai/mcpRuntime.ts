import {
  McpError,
  NEW_MCP_SERVER,
  approveMcpListing,
  asMcpError,
  checkMcpAddress,
  checkMcpPromptBody,
  createMcpClient,
  createMcpHttpWire,
  createMcpStdioWire,
  mcpHash,
  mcpPromptBody,
  mcpPromptKey,
  mcpServerIdProblem,
  mcpServerTarget,
  reviewMcpListing,
  reviewMcpPromptBody,
  suggestMcpServerId,
  type EndpointConfirmText,
  type McpAddressProblem,
  type McpClient,
  type McpClientInfo,
  type McpFailure,
  type McpHello,
  type McpListing,
  type McpNativeHost,
  type McpProgramSpec,
  type McpRegisteredServer,
  type McpSandboxInfo,
  type McpServerReview,
} from "@plainva/core";
import { mcpSnapshotFits, type McpDeviceStore, type McpServerRecord } from "./mcpStores";

/**
 * Foreign MCP servers on this device (plan KI-Harness P4.5): what is
 * registered, what was approved of each, and the connections to them.
 *
 * This is where the pin is enforced. A listing reaches nobody before it was
 * compared with what the user approved: `inspect` shows it for a review,
 * `check` loads it again before a use, and both block the server when it
 * differs. What a conversation reads of a server comes from the approved
 * snapshot in the record, never from a connection.
 */

export interface McpRuntimeHost {
  native: McpNativeHost;
  store: McpDeviceStore;
  /** Who a server is told asks: the app and its version. Asked once, before the first connection; never rejects. */
  client(): Promise<McpClientInfo>;
  now(): Date;
  newId(): string;
  /** Runs something later and returns how to call it off; a timer of the platform where none is given. */
  later?(run: () => void, ms: number): () => void;
}

/**
 * A connection nobody used for this long is ended. A remote server loses
 * nothing by it; a program — somebody else's code with the user's rights —
 * does not idle beside the app for the rest of the day because a review once
 * looked at it. The next use starts it again.
 */
export const MCP_IDLE_MS = 10 * 60_000;

function platformLater(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  // Neither a closing app nor a test run waits for it.
  (timer as { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
}

/** A server as this device knows it: what is registered natively, and what was approved of it. */
export interface McpDeviceServer {
  id: string;
  registered: McpRegisteredServer;
  record: McpServerRecord;
  /** The registration is the one the approval was made for. */
  current: boolean;
}

export interface McpInspection {
  hello: McpHello;
  listing: McpListing;
  clipped: { tools: boolean; prompts: boolean };
  /** Too large to be stored, so it cannot be approved. */
  tooLarge: boolean;
  /** Where the server stands after this look: `blocked` when the listing differs from the approved one. */
  review: McpServerReview;
}

export type McpAddProblem =
  /** No usable name is left of the label, or every variant of it is taken. */
  | { kind: "name" }
  | { kind: "address"; problem: McpAddressProblem }
  /** The user said no in the native dialog. */
  | { kind: "declined" }
  /** The native side did not take it: the program was not found, the command cannot be shown, programs are not offered here. */
  | { kind: "refused"; detail: string };

export type McpAddResult = { ok: true; id: string } | { ok: false; problem: McpAddProblem };

export type McpCheck =
  | { ok: true }
  /** Not approved, or registered anew since the approval. */
  | { ok: false; reason: "not-approved" }
  /** The listing differs from the approved one: the server is blocked from now on. */
  | { ok: false; reason: "blocked" }
  | { ok: false; reason: "failed"; failure: McpFailure };

export type McpPromptLook =
  /** The expansion is the approved one: it may be sent. */
  | { standing: "match"; key: string; body: { description: string; messages: unknown[] } }
  /** Nobody approved this expansion yet: the user sees it first. */
  | { standing: "unpinned"; key: string; body: { description: string; messages: unknown[] } }
  /** It differs from the approved one: the server is blocked, and nothing of it is shown as a prompt. */
  | { standing: "changed" };

interface Link {
  client: McpClient;
  target: string;
  freshUntil: number;
  /** The server said its lists changed. */
  stale: boolean;
  /** Calls off the end that waits for this connection while nobody uses it. */
  idle: (() => void) | null;
}

const BLANK: McpServerRecord = { label: "", addedAt: "", target: "", review: NEW_MCP_SERVER, snapshot: null };

export class McpRuntime {
  private readonly links = new Map<string, Link>();
  private lane: Promise<unknown> = Promise.resolve();
  private info: Promise<McpClientInfo> | null = null;

  constructor(private readonly host: McpRuntimeHost) {}

  /** Programs can be servers on this device. */
  get programs(): boolean {
    return this.host.native.programs !== null;
  }

  sandbox(): Promise<McpSandboxInfo> {
    return this.host.native.programs ? this.host.native.programs.sandbox() : Promise.resolve({ kind: "none", works: false });
  }

  log(id: string): Promise<string> {
    return this.host.native.programs ? this.host.native.programs.log(id) : Promise.resolve("");
  }

  /** One change of the records at a time: a block and an approval never overwrite each other. */
  private change<T>(work: (records: Record<string, McpServerRecord>) => T | Promise<T>): Promise<T> {
    const run = this.lane
      .catch(() => undefined)
      .then(async () => {
        const records = await this.host.store.load();
        const result = await work(records);
        await this.host.store.save(records);
        return result;
      });
    this.lane = run;
    return run;
  }

  /** Every server of this device: the native registry decides which there are, the records say what was approved. */
  async servers(): Promise<McpDeviceServer[]> {
    const [registered, records] = await Promise.all([this.host.native.servers(), this.host.store.load()]);
    return registered
      .map((server) => {
        const record = records[server.id] ?? { ...BLANK, label: server.id };
        return { id: server.id, registered: server, record, current: record.target === mcpServerTarget(server) };
      })
      .sort((a, b) => a.record.label.localeCompare(b.record.label) || a.id.localeCompare(b.id));
  }

  private async registered(id: string): Promise<McpRegisteredServer> {
    const server = (await this.host.native.servers()).find((entry) => entry.id === id);
    if (!server) throw new McpError({ kind: "refused", detail: "not-registered" });
    return server;
  }

  private async newId(label: string): Promise<string | null> {
    const [registered, records] = await Promise.all([this.host.native.servers(), this.host.store.load()]);
    const taken = [...new Set([...registered.map((server) => server.id), ...Object.keys(records)])];
    const id = suggestMcpServerId(label, taken);
    return id && mcpServerIdProblem(id, taken) === null ? id : null;
  }

  private async remember(id: string, label: string): Promise<void> {
    this.drop(id);
    // A server registered under an id starts as one nobody approved, whatever was there before.
    await this.change((records) => {
      records[id] = { ...BLANK, label: label.trim().slice(0, 60) || id, addedAt: this.host.now().toISOString() };
    });
  }

  /** Adds a remote server. The native side shows its address and asks; a token, where one is given, is stored right after. */
  async addHttp(label: string, url: string, token: string, text: EndpointConfirmText): Promise<McpAddResult> {
    const address = checkMcpAddress(url);
    if (!address.ok) return { ok: false, problem: { kind: "address", problem: address.problem } };
    const id = await this.newId(label);
    if (!id) return { ok: false, problem: { kind: "name" } };
    try {
      if (!(await this.host.native.addHttp(id, address.url, text))) return { ok: false, problem: { kind: "declined" } };
      await this.remember(id, label);
      if (token.trim()) await this.host.native.setSecret(id, null, token.trim());
    } catch (error) {
      return { ok: false, problem: { kind: "refused", detail: error instanceof Error ? error.message : String(error) } };
    }
    return { ok: true, id };
  }

  /** Adds a program. The native side shows its whole command line and asks; the values of its environment are stored right after. */
  async addProgram(label: string, spec: McpProgramSpec, values: Readonly<Record<string, string>>, text: EndpointConfirmText): Promise<McpAddResult> {
    const programs = this.host.native.programs;
    if (!programs) return { ok: false, problem: { kind: "refused", detail: "no-programs" } };
    const id = await this.newId(label);
    if (!id) return { ok: false, problem: { kind: "name" } };
    try {
      if (!(await programs.add(id, spec, text))) return { ok: false, problem: { kind: "declined" } };
      await this.remember(id, label);
      for (const name of spec.env) {
        const value = values[name]?.trim();
        if (value) await this.host.native.setSecret(id, name, value);
      }
    } catch (error) {
      return { ok: false, problem: { kind: "refused", detail: error instanceof Error ? error.message : String(error) } };
    }
    return { ok: true, id };
  }

  async remove(id: string): Promise<void> {
    this.drop(id);
    await this.host.native.remove(id);
    await this.change((records) => {
      delete records[id];
    });
  }

  async rename(id: string, label: string): Promise<void> {
    await this.change((records) => {
      const record = records[id];
      if (record && label.trim()) record.label = label.trim().slice(0, 60);
    });
  }

  setSecret(id: string, name: string | null, value: string): Promise<void> {
    // A new credential may change what a server answers: the next use looks again.
    this.drop(id);
    return value.trim() ? this.host.native.setSecret(id, name, value.trim()) : this.host.native.deleteSecret(id, name);
  }

  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    link.idle?.();
    this.links.delete(id);
    void link.client.close().catch(() => undefined);
  }

  /** A use of a connection: it stays for another while. */
  private used(id: string, link: Link): Link {
    link.idle?.();
    link.idle = (this.host.later ?? platformLater)(() => {
      if (this.links.get(id) === link) this.drop(id);
    }, MCP_IDLE_MS);
    return link;
  }

  private async link(server: McpRegisteredServer): Promise<Link> {
    const target = mcpServerTarget(server);
    const info = await (this.info ??= this.host.client());
    // Looked up after the wait: two uses that asked together share one connection.
    const existing = this.links.get(server.id);
    if (existing && existing.target === target) return this.used(server.id, existing);
    if (existing) this.drop(server.id);
    let client: McpClient;
    if (server.kind === "http") {
      client = createMcpClient(createMcpHttpWire(this.host.native.httpPort(server.id), { client: info, newRequestId: () => `mcp-${this.host.newId()}` }));
    } else {
      const programs = this.host.native.programs;
      if (!programs) throw new McpError({ kind: "refused", detail: "no-programs" });
      client = createMcpClient(
        createMcpStdioWire(programs.port(server.id), {
          client: info,
          // A program of an earlier revision says by itself that its lists changed: they are loaded again before the next use.
          onNotification: (method) => {
            const current = this.links.get(server.id);
            if (current && current.client === client && (method === "notifications/tools/list_changed" || method === "notifications/prompts/list_changed")) current.stale = true;
          },
        }),
      );
    }
    const link: Link = { client, target, freshUntil: 0, stale: false, idle: null };
    this.links.set(server.id, link);
    return this.used(server.id, link);
  }

  /** A failure that ends a connection: the next use starts a new one. */
  private failed(id: string, error: unknown): McpError {
    const failure = asMcpError(error);
    if (failure.failure.kind === "exited" || failure.failure.kind === "unreachable" || failure.failure.kind === "refused") this.drop(id);
    return failure;
  }

  private async load(server: McpRegisteredServer, signal?: AbortSignal) {
    try {
      const link = await this.link(server);
      const hello = await link.client.open(signal);
      const loaded = await link.client.listing(signal);
      link.freshUntil = this.host.now().getTime() + loaded.freshForMs;
      link.stale = false;
      return { hello, ...loaded };
    } catch (error) {
      throw this.failed(server.id, error);
    }
  }

  /**
   * Looks at a server: what it is and what it lists now. For the review — and
   * a look is a comparison too: where the listing differs from the approved
   * one, the server is blocked by it, and the answer says so.
   */
  async inspect(id: string, signal?: AbortSignal): Promise<McpInspection> {
    const server = await this.registered(id);
    const target = mcpServerTarget(server);
    const { hello, listing, clipped } = await this.load(server, signal);
    const now = this.host.now();
    const review = await this.change((records) => {
      const record = (records[id] ??= { ...BLANK, label: id, addedAt: now.toISOString() });
      // A registration other than the approved one voids the approval: its texts were another server's.
      if (record.target !== target) {
        record.review = NEW_MCP_SERVER;
        record.snapshot = null;
      }
      record.review = reviewMcpListing(record.review, listing, now);
      record.seen = { name: hello.serverInfo?.name ?? "", era: hello.era, version: hello.version, at: now.toISOString(), clipped: clipped.tools || clipped.prompts };
      return record.review;
    });
    return { hello, listing, clipped, tooLarge: !mcpSnapshotFits(listing), review };
  }

  /** The user looked at this listing and allowed it. The only way out of "new" and "blocked". */
  async approve(id: string, listing: McpListing): Promise<boolean> {
    if (!mcpSnapshotFits(listing)) return false;
    const server = await this.registered(id);
    const now = this.host.now();
    await this.change((records) => {
      const record = (records[id] ??= { ...BLANK, label: id, addedAt: now.toISOString() });
      record.review = approveMcpListing({ ...listing, promptBodies: {} }, now);
      record.snapshot = { ...listing, promptBodies: {} };
      record.target = mcpServerTarget(server);
    });
    return true;
  }

  /**
   * Before a use: the listing is loaded again unless the server's own hint
   * says it is still fresh, and compared with the approved one. A difference
   * blocks the server, here and for good — until the user looks again.
   */
  async check(id: string, signal?: AbortSignal): Promise<McpCheck> {
    let server: McpRegisteredServer;
    try {
      server = await this.registered(id);
    } catch {
      return { ok: false, reason: "not-approved" };
    }
    const record = (await this.host.store.load())[id];
    if (!record || record.target !== mcpServerTarget(server) || record.review.status === "new") return { ok: false, reason: "not-approved" };
    if (record.review.status === "blocked") return { ok: false, reason: "blocked" };
    const existing = this.links.get(id);
    if (existing && existing.target === record.target && !existing.stale && this.host.now().getTime() < existing.freshUntil) return { ok: true };
    let listing: McpListing;
    try {
      ({ listing } = await this.load(server, signal));
    } catch (error) {
      return { ok: false, reason: "failed", failure: asMcpError(error).failure };
    }
    const now = this.host.now();
    const review = await this.change((records) => {
      const current = records[id];
      if (!current) return NEW_MCP_SERVER;
      current.review = reviewMcpListing(current.review, listing, now);
      return current.review;
    });
    if (review.status === "blocked") return { ok: false, reason: "blocked" };
    return review.status === "approved" ? { ok: true } : { ok: false, reason: "not-approved" };
  }

  /** One call. Whether it may go out was decided before; `check` ran before it. */
  async call(id: string, tool: string, args: Record<string, unknown>, inputSchema: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const server = await this.registered(id);
    try {
      return await (await this.link(server)).client.callTool(tool, args, { inputSchema, ...(signal ? { signal } : {}) });
    } catch (error) {
      throw this.failed(id, error);
    }
  }

  /**
   * What a prompt expands to, compared with the pin at the moment it is
   * used. An expansion that differs from the approved one blocks the server.
   */
  async prompt(id: string, name: string, args: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<McpPromptLook> {
    const server = await this.registered(id);
    let raw: Record<string, unknown>;
    try {
      raw = await (await this.link(server)).client.getPrompt(name, { ...args }, signal);
    } catch (error) {
      throw this.failed(id, error);
    }
    const body = mcpPromptBody(raw);
    const key = mcpPromptKey(name, args);
    const now = this.host.now();
    const standing = await this.change((records) => {
      const record = records[id];
      if (!record || record.review.status !== "approved" || record.target !== mcpServerTarget(server)) return "changed" as const;
      const found = checkMcpPromptBody(record.review.pin, key, body);
      if (found === "changed") record.review = reviewMcpPromptBody(record.review, key, body, now);
      return found;
    });
    return standing === "changed" ? { standing } : { standing, key, body };
  }

  /** The user read this expansion and sent it: from now on it is the approved one. */
  async pinPrompt(id: string, key: string, body: unknown): Promise<void> {
    await this.change((records) => {
      const record = records[id];
      if (record?.review.status !== "approved") return;
      record.review = { status: "approved", pin: { ...record.review.pin, promptBodies: { ...record.review.pin.promptBodies, [key]: mcpHash(body) } } };
    });
  }

  /** Ends every connection: the vault closed, or the app does. */
  dispose(): void {
    for (const id of [...this.links.keys()]) this.drop(id);
  }
}
