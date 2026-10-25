import {
  McpError,
  MCP_SKILL_LIMITS,
  NEW_MCP_SERVER,
  approveMcpListing,
  asMcpError,
  checkMcpAddress,
  checkMcpPromptBody,
  createMcpClient,
  createMcpHttpWire,
  createMcpStdioWire,
  mcpHash,
  mcpOnDeviceHost,
  mcpPromptBody,
  mcpPromptKey,
  mcpResourceBytes,
  mcpServerIdProblem,
  mcpServerTarget,
  mcpSkillFileMatches,
  planMcpSignIn,
  combineMcpSkillEntries,
  readMcpSkillEntries,
  readMcpSkillEntry,
  reviewMcpListing,
  reviewMcpPromptBody,
  runMcpSignIn,
  suggestMcpServerId,
  type EndpointConfirmText,
  type McpAddressProblem,
  type McpClient,
  type McpClientInfo,
  type McpFailure,
  type McpHello,
  type McpListing,
  type McpNativeHost,
  type McpOAuthBrowser,
  type McpOAuthRedirect,
  type McpOAuthStatus,
  type McpElicitResult,
  type McpProgramSpec,
  type McpQuestions,
  type McpRegisteredServer,
  type McpSandboxInfo,
  type McpServerReview,
  type McpSignInPlan,
  type McpSignInProblem,
  type McpSkillEntry,
} from "@plainva/core";
import { fitMcpSkillsRecord, mcpSkillAddress, mcpSnapshotFits, type McpDeviceStore, type McpServerRecord, type McpSkillsRecord } from "./mcpStores";

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
  /** The browser a sign-in is made in, and the way back from it. */
  browser: McpOAuthBrowser;
  /**
   * The address of Plainva's own description as a client — what it is to an
   * authorization server that takes such an address as an id. Null: this
   * build has none, and registers where it can.
   */
  clientDocument: string | null;
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
  /** How many skills it serves (plan P9-4b) — each is approved on its own, in the workshop; null where it serves none. */
  skills: number | null;
}

/** What reading a server's skills brought (plan P9-4b). */
interface SkillsRead {
  entries: McpSkillEntry[];
  clipped: boolean;
  /** Something could not be read: what is shown of it is what was read before. */
  failed: boolean;
  /** The list itself could not be read: the entries are the ones read before, and so is the time they were read. */
  listFailed: boolean;
  /** Addresses the user added that the server no longer knows. */
  gone: string[];
}

export type McpSkillAdd =
  | { ok: true }
  /** Not an address of a skill's `SKILL.md`, or the server answered with another skill. */
  | { ok: false; reason: "invalid" }
  /** The server knows no skill at that address. */
  | { ok: false; reason: "unknown" }
  /** It serves no skills at all. */
  | { ok: false; reason: "no-skills" }
  /** Already as many addresses as are kept for one server. */
  | { ok: false; reason: "full" }
  | { ok: false; reason: "not-approved" | "blocked" }
  | { ok: false; reason: "failed"; failure: McpFailure };

export type McpSkillRead =
  | { ok: true; bytes: Uint8Array }
  /** Other bytes than the manifest names: not used, and the entry was read again. */
  | { ok: false; reason: "digest" }
  | { ok: false; reason: "not-approved" | "blocked" }
  | { ok: false; reason: "failed"; failure: McpFailure };

/** What is kept of read files of skills, at most: verified bytes, in memory, never on the disk. */
export const MCP_SKILL_CACHE_BYTES = 32 * 1024 * 1024;

/** A failure that says the server knows nothing at the address asked for. */
const unknownAddress = (failure: McpFailure) => failure.kind === "rpc" && failure.code === -32602;

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
  /**
   * The calls and prompts that run on this connection right now, each by
   * what stops it: ending the connection stops them, and while one runs —
   * a call that waits for the user's answer to the server's question — the
   * connection is not ended for being idle.
   */
  running: Set<AbortController>;
}

/** At most this many approved prompt expansions per server: the oldest goes first, and is shown again before its next use. */
export const MCP_PROMPT_PINS_MAX = 200;

/** A server on this device — a program, or an address on this device: only such a server may send the user to a page on it (plan P9-4a). */
export function mcpServerOnDevice(server: McpRegisteredServer): boolean {
  if (server.kind !== "http") return true;
  try {
    return mcpOnDeviceHost(new URL(server.url ?? "").hostname);
  } catch {
    return false;
  }
}

const BLANK: McpServerRecord = { label: "", addedAt: "", target: "", review: NEW_MCP_SERVER, snapshot: null };

export class McpRuntime {
  private readonly links = new Map<string, Link>();
  private lane: Promise<unknown> = Promise.resolve();
  private info: Promise<McpClientInfo> | null = null;
  /** Files of skills that were read and checked (plan P9-4b), by server, address and digest: what the digest names, nothing else. */
  private readonly skillFiles = new Map<string, Uint8Array>();
  private skillFileBytes = 0;

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
    this.forgetSkillFiles(id);
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

  /* ---- signing in to a remote server ---------------------------------------------------------- */

  /**
   * How this server can be signed in to: where it says its sign-in lives and
   * what that authorization server offers. `challenge` is the line it refused
   * a request with, where there was one.
   */
  async signInPlan(id: string, challenge?: string): Promise<{ ok: true; plan: McpSignInPlan } | { ok: false; problem: McpSignInProblem }> {
    const server = await this.registered(id).catch(() => null);
    if (!server || server.kind !== "http" || !server.url) return { ok: false, problem: "not-offered" };
    return planMcpSignIn(this.host.native.oauth, { id, url: server.url }, challenge, this.host.clientDocument);
  }

  /**
   * Makes the sign-in in the browser. The connection is ended either way: the
   * next use asks the server again, with whatever credential there is now.
   */
  async signIn(id: string, plan: McpSignInPlan, clientId?: string, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; problem: McpSignInProblem }> {
    const result = await runMcpSignIn(this.host.native.oauth, this.host.browser, id, plan, {
      clientName: "Plainva",
      documentUrl: this.host.clientDocument,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(signal ? { signal } : {}),
    });
    this.drop(id);
    return result;
  }

  /**
   * The browser came back while nobody waited for it — a phone ends an app
   * that is in the background. The native side kept what was begun: it ends
   * the sign-in, and the answer is the server that is signed in to now.
   */
  async finishSignIn(redirect: McpOAuthRedirect): Promise<string | null> {
    try {
      const id = await this.host.native.oauth.finish(redirect);
      this.drop(id);
      return id;
    } catch {
      return null;
    }
  }

  /** The sign-in that is kept for a server; null where there is none. */
  signInStatus(id: string): Promise<McpOAuthStatus | null> {
    return this.host.native.oauth.status(id).catch(() => null);
  }

  async signOut(id: string): Promise<void> {
    this.drop(id);
    await this.host.native.oauth.signOut(id);
  }

  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    link.idle?.();
    this.links.delete(id);
    // What still runs on it ends with it: a call that waited for an answer does not go out again on a new connection.
    for (const stop of link.running) stop.abort();
    void link.client.close().catch(() => undefined);
  }

  /** A use of a connection: it stays for another while — and for as long as something runs on it. */
  private used(id: string, link: Link): Link {
    link.idle?.();
    // A timer that was called off does nothing, even where it fires after all.
    let live = true;
    const cancel = (this.host.later ?? platformLater)(() => {
      if (!live || this.links.get(id) !== link) return;
      if (link.running.size > 0) this.used(id, link);
      else this.drop(id);
    }, MCP_IDLE_MS);
    link.idle = () => {
      live = false;
      cancel();
    };
    return link;
  }

  /**
   * Runs one request on a server's connection, stoppable by the caller and by
   * the end of the connection; the connection is marked used before and after.
   */
  private async running<T>(server: McpRegisteredServer, signal: AbortSignal | undefined, run: (link: Link, signal: AbortSignal) => Promise<T>): Promise<T> {
    const link = await this.link(server);
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    if (signal?.aborted) stop.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    link.running.add(stop);
    try {
      return await run(link, stop.signal);
    } finally {
      link.running.delete(stop);
      signal?.removeEventListener("abort", onAbort);
      if (this.links.get(server.id) === link) this.used(server.id, link);
    }
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
      client = createMcpClient(
        createMcpHttpWire(this.host.native.httpPort(server.id), {
          client: info,
          newRequestId: () => `mcp-${this.host.newId()}`,
          // A sign-in that ran out renews itself natively; this side only learns whether to ask again.
          renew: () => this.host.native.oauth.renew(server.id),
        }),
      );
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
    const link: Link = { client, target, freshUntil: 0, stale: false, idle: null, running: new Set() };
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
      // Where it serves skills — as the answer this listing was made with says —, what it lists of them comes along
      // (plan P9-4b), never a file of them.
      const skills = loaded.skills ? await this.readSkills(server, link, signal) : null;
      link.freshUntil = this.host.now().getTime() + loaded.freshForMs;
      link.stale = false;
      return { hello, ...loaded, skills };
    } catch (error) {
      throw this.failed(server.id, error);
    }
  }

  /**
   * What a server lists of its skills now, and the entries of the addresses
   * the user added that the list does not carry. A reading that fails keeps
   * what was read before — of this registration only: another one's skills
   * are another server's.
   */
  private async readSkills(server: McpRegisteredServer, link: Link, signal?: AbortSignal): Promise<SkillsRead> {
    const record = (await this.host.store.load())[server.id];
    const before = record && record.target === mcpServerTarget(server) ? record.skills : undefined;
    const added = before?.added ?? [];
    const kept = (uri: string) => before?.entries.find((entry) => entry.uri === uri) ?? null;
    let listed: McpSkillEntry[];
    let clipped: boolean;
    let listFailed = false;
    try {
      const answer = await link.client.skills(signal);
      listed = readMcpSkillEntries(answer.items);
      clipped = answer.clipped;
    } catch (error) {
      if (signal?.aborted) throw error;
      listFailed = true;
      clipped = before?.clipped ?? false;
      listed = (before?.entries ?? []).filter((entry) => !added.includes(entry.uri));
    }
    let failed = listFailed;
    const gone: string[] = [];
    // The addresses the user added come first: a long list never pushes one of them out.
    const fromAdded: McpSkillEntry[] = [];
    for (const uri of added) {
      const inList = listed.find((entry) => entry.uri === uri);
      if (inList) {
        fromAdded.push(inList);
        continue;
      }
      try {
        const entry = readMcpSkillEntry(await link.client.skill(uri, signal));
        // An answer about another address is no answer about this one: what was read of it before stays.
        if (entry?.uri === uri) fromAdded.push(entry);
        else {
          failed = true;
          const before = kept(uri);
          if (before) fromAdded.push(before);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        if (unknownAddress(asMcpError(error).failure)) {
          gone.push(uri);
          continue;
        }
        failed = true;
        const before = kept(uri);
        if (before) fromAdded.push(before);
      }
    }
    return { entries: combineMcpSkillEntries([...fromAdded, ...listed]), clipped, failed, listFailed, gone };
  }

  /**
   * What is kept of a server's skills after a reading. A server that does not
   * say it serves skills keeps none — only the addresses the user added, for
   * the day it serves them again. An address added while the reading ran is
   * kept with what was read of it.
   */
  private skillsAfter(record: McpServerRecord, skills: SkillsRead | null, now: Date): void {
    const before = record.skills;
    if (!skills) {
      if (before?.added.length) record.skills = { at: before.at, failed: false, clipped: false, entries: [], added: before.added };
      else delete record.skills;
      return;
    }
    const added = (before?.added ?? []).filter((uri) => !skills.gone.includes(uri));
    const meanwhile = (before?.entries ?? []).filter((entry) => added.includes(entry.uri) && !skills.entries.some((read) => read.uri === entry.uri));
    record.skills = fitMcpSkillsRecord({
      // A list that could not be read is shown as of when it was read.
      at: skills.listFailed && before ? before.at : now.toISOString(),
      failed: skills.failed,
      clipped: skills.clipped,
      entries: combineMcpSkillEntries([...meanwhile, ...skills.entries]),
      added,
    });
  }

  /**
   * Looks at a server: what it is and what it lists now. For the review — and
   * a look is a comparison too: where the listing differs from the approved
   * one, the server is blocked by it, and the answer says so.
   */
  async inspect(id: string, signal?: AbortSignal): Promise<McpInspection> {
    const server = await this.registered(id);
    const target = mcpServerTarget(server);
    const { hello, listing, clipped, skills } = await this.load(server, signal);
    const now = this.host.now();
    const review = await this.change((records) => {
      const record = (records[id] ??= { ...BLANK, label: id, addedAt: now.toISOString() });
      // A registration other than the approved one voids the approval: its texts were another server's — and its skills.
      if (record.target !== target) {
        record.review = NEW_MCP_SERVER;
        record.snapshot = null;
        delete record.skills;
        this.forgetSkillFiles(id);
      }
      record.review = reviewMcpListing(record.review, listing, now);
      record.seen = { name: hello.serverInfo?.name ?? "", era: hello.era, version: hello.version, at: now.toISOString(), clipped: clipped.tools || clipped.prompts };
      this.skillsAfter(record, skills, now);
      return record.review;
    });
    return { hello, listing, clipped, tooLarge: !mcpSnapshotFits(listing), review, skills: skills ? skills.entries.length : null };
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
    let skills: SkillsRead | null;
    try {
      ({ listing, skills } = await this.load(server, signal));
    } catch (error) {
      return { ok: false, reason: "failed", failure: asMcpError(error).failure };
    }
    const now = this.host.now();
    const review = await this.change((records) => {
      const current = records[id];
      if (!current) return NEW_MCP_SERVER;
      current.review = reviewMcpListing(current.review, listing, now);
      if (current.target === record.target) this.skillsAfter(current, skills, now);
      return current.review;
    });
    if (review.status === "blocked") return { ok: false, reason: "blocked" };
    return review.status === "approved" ? { ok: true } : { ok: false, reason: "not-approved" };
  }

  /**
   * One call. Whether it may go out was decided before; `check` ran before
   * it. `questions` where the vault lets this server ask the user something
   * on the way (plan P9-4a); left out, it may not.
   */
  async call(id: string, tool: string, args: Record<string, unknown>, inputSchema: unknown, signal?: AbortSignal, questions?: McpQuestions): Promise<Record<string, unknown>> {
    const server = await this.registered(id);
    const asking = questions && { ...questions, local: mcpServerOnDevice(server) };
    try {
      return await this.running(server, signal, (link, stop) => link.client.callTool(tool, args, { inputSchema, signal: stop, ...(asking ? { questions: asking } : {}) }));
    } catch (error) {
      throw this.failed(id, error);
    }
  }

  /**
   * What a prompt expands to, compared with the pin at the moment it is
   * used. An expansion that differs from the approved one blocks the server.
   */
  async prompt(id: string, name: string, args: Readonly<Record<string, string>>, signal?: AbortSignal, questions?: McpQuestions): Promise<McpPromptLook> {
    const server = await this.registered(id);
    // What went to the server on the way — every answer, the ones nobody was asked for included — is part of what the
    // expansion is pinned under: as a hash, kept with the approval on this device.
    const answers: McpElicitResult[] = [];
    const asking: McpQuestions | undefined = questions && {
      ...questions,
      local: mcpServerOnDevice(server),
      replied: (reply) => {
        answers.push(reply);
        questions.replied?.(reply);
      },
    };
    let raw: Record<string, unknown>;
    try {
      raw = await this.running(server, signal, (link, stop) => link.client.getPrompt(name, { ...args }, stop, asking));
    } catch (error) {
      throw this.failed(id, error);
    }
    const body = mcpPromptBody(raw);
    const key = mcpPromptKey(name, args, answers.length ? mcpHash(answers) : undefined);
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
      // The newest at the end; beyond the bound the oldest go — an expansion that is no longer pinned is shown first again.
      const bodies = Object.entries(record.review.pin.promptBodies).filter(([known]) => known !== key);
      bodies.push([key, mcpHash(body)]);
      record.review = { status: "approved", pin: { ...record.review.pin, promptBodies: Object.fromEntries(bodies.slice(-MCP_PROMPT_PINS_MAX)) } };
    });
  }

  /* ---- skills a server serves (plan P9-4b) ---------------------------------------------------- */

  /**
   * Reads a server's skills again, now: the next look at it is not left to
   * the server's own hint of freshness — and like every look it compares
   * the listing with the approved one.
   */
  refreshSkills(id: string, signal?: AbortSignal): Promise<McpCheck> {
    const link = this.links.get(id);
    if (link) link.stale = true;
    return this.check(id, signal);
  }

  /**
   * A skill by its address (`skills/get`): one the server serves without
   * listing it, or one the user wants to be sure of. Kept with the server on
   * this device, and asked for at every reading of its skills from then on.
   */
  async addSkill(id: string, uri: string, signal?: AbortSignal): Promise<McpSkillAdd> {
    const address = mcpSkillAddress(uri);
    if (!address) return { ok: false, reason: "invalid" };
    const checked = await this.check(id, signal);
    if (!checked.ok) return checked.reason === "failed" ? { ok: false, reason: "failed", failure: checked.failure } : { ok: false, reason: checked.reason };
    const server = await this.registered(id);
    let asked: { serves: false } | { serves: true; raw: unknown };
    try {
      asked = await this.running(server, signal, async (link, stop) =>
        // Asked only of a server that said it serves skills.
        (await link.client.open(stop)).skills ? { serves: true as const, raw: await link.client.skill(address, stop) } : { serves: false as const },
      );
    } catch (error) {
      const failure = this.failed(id, error).failure;
      return unknownAddress(failure) ? { ok: false, reason: "unknown" } : { ok: false, reason: "failed", failure };
    }
    if (!asked.serves) return { ok: false, reason: "no-skills" };
    const raw = asked.raw;
    if (readMcpSkillEntry(raw)?.uri !== address) return { ok: false, reason: "invalid" };
    const now = this.host.now();
    const target = mcpServerTarget(server);
    return this.change((records): McpSkillAdd => {
      const record = records[id];
      if (!record || record.target !== target) return { ok: false, reason: "not-approved" };
      const before: McpSkillsRecord = record.skills ?? { at: now.toISOString(), failed: false, clipped: false, entries: [], added: [] };
      if (!before.added.includes(address) && before.added.length >= MCP_SKILL_LIMITS.added) return { ok: false, reason: "full" };
      const entry = readMcpSkillEntry(raw)!;
      const next = fitMcpSkillsRecord({
        ...before,
        entries: combineMcpSkillEntries([entry, ...before.entries.filter((other) => other.uri !== address)]),
        added: before.added.includes(address) ? before.added : [...before.added, address],
      });
      // "Added" is said only of what is kept.
      if (!next.entries.some((other) => other.uri === address)) return { ok: false, reason: "full" };
      record.skills = next;
      return { ok: true };
    });
  }

  /**
   * One file of a skill, checked: the bytes its manifest names — size and
   * SHA-256 —, read from this server and no other, after the same look at
   * the server as before any use. Bytes that differ are not used, and the
   * skill's entry is read again (`skills/get`), so that what changed is
   * shown as changed. What passed is kept in memory, by its digest.
   */
  async readSkillFile(id: string, skillUri: string, file: { uri: string; bytes: number; sha256: string }, signal?: AbortSignal): Promise<McpSkillRead> {
    const checked = await this.check(id, signal);
    if (!checked.ok) return checked.reason === "failed" ? { ok: false, reason: "failed", failure: checked.failure } : { ok: false, reason: checked.reason };
    const key = `${id}\n${file.uri}\n${file.sha256}`;
    const kept = this.skillFiles.get(key);
    if (kept) return { ok: true, bytes: kept };
    const server = await this.registered(id);
    let result: Record<string, unknown>;
    try {
      result = await this.running(server, signal, (link, stop) => link.client.readResource(file.uri, stop));
    } catch (error) {
      return { ok: false, reason: "failed", failure: this.failed(id, error).failure };
    }
    const bytes = mcpResourceBytes(result, file.uri);
    if (!bytes || !mcpSkillFileMatches(file, bytes)) {
      await this.refreshSkillEntry(server, skillUri, signal).catch(() => undefined);
      return { ok: false, reason: "digest" };
    }
    this.keepSkillFile(key, bytes);
    return { ok: true, bytes };
  }

  /** One skill's entry read again, after its bytes did not match: kept as the server lists it now, or gone where it knows it no more. */
  private async refreshSkillEntry(server: McpRegisteredServer, uri: string, signal?: AbortSignal): Promise<void> {
    let raw: unknown = null;
    let gone = false;
    try {
      raw = await this.running(server, signal, (link, stop) => link.client.skill(uri, stop));
    } catch (error) {
      if (!unknownAddress(asMcpError(error).failure)) return;
      gone = true;
    }
    if (!gone && readMcpSkillEntry(raw)?.uri !== uri) return;
    const target = mcpServerTarget(server);
    await this.change((records) => {
      const record = records[server.id];
      if (!record?.skills || record.target !== target) return;
      const fresh = gone ? null : readMcpSkillEntry(raw);
      const entries = record.skills.entries.flatMap((entry) => (entry.uri !== uri ? [entry] : fresh ? [fresh] : []));
      record.skills = fitMcpSkillsRecord({
        ...record.skills,
        entries: combineMcpSkillEntries(fresh && !entries.includes(fresh) ? [fresh, ...entries] : entries),
        added: gone ? record.skills.added.filter((address) => address !== uri) : record.skills.added,
      });
    });
  }

  private keepSkillFile(key: string, bytes: Uint8Array): void {
    // Two readings of one file that ended together: the first one is kept, the bytes are the same.
    if (this.skillFiles.has(key) || bytes.length > MCP_SKILL_CACHE_BYTES) return;
    // The oldest go first, until the new one fits.
    for (const [old, value] of this.skillFiles) {
      if (this.skillFileBytes + bytes.length <= MCP_SKILL_CACHE_BYTES) break;
      this.skillFiles.delete(old);
      this.skillFileBytes -= value.length;
    }
    this.skillFiles.set(key, bytes);
    this.skillFileBytes += bytes.length;
  }

  /** What was kept of a server's skills goes with the server — removed, or registered anew. */
  private forgetSkillFiles(id: string): void {
    for (const [key, value] of this.skillFiles) {
      if (!key.startsWith(`${id}\n`)) continue;
      this.skillFiles.delete(key);
      this.skillFileBytes -= value.length;
    }
  }

  /** Ends every connection: the vault closed, or the app does. */
  dispose(): void {
    for (const id of [...this.links.keys()]) this.drop(id);
  }
}
