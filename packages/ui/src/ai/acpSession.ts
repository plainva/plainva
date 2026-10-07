import {
  ACP_KNOWN_AGENTS,
  ACP_START_DECLINED,
  acpAgentLabel,
  acpAgentTarget,
  acpAuthorId,
  acpCommandText,
  acpFileUri,
  acpKnownAgentOf,
  acpLoginProblem,
  acpStartProblem,
  acpVaultPath,
  asAcpError,
  createAcpClient,
  gateDecision,
  isAcpAgentId,
  suggestAcpAgentId,
  type AcpAuthMethod,
  type AcpClient,
  type AcpFailure,
  type AcpFileRead,
  type AcpFileWrite,
  type AcpLoginProblem,
  type AcpMcpServer,
  type AcpNativeHost,
  type AcpPermissionOption,
  type AcpPermissionRequest,
  type AcpPlanEntry,
  type AcpPromptBlock,
  type AcpStartProblem,
  type AcpStopReason,
  type AcpToolKind,
  type AcpToolStatus,
  type AcpToolUpdate,
  type AcpUpdate,
  type EndpointConfirmText,
} from "@plainva/core";
import { AcpFileRefusal, acpGate, acpPlanNoteWrite, acpPlanWrite, acpProposeRound, acpReadFile, acpSpelledPath, type AcpFileRefusalReason, type AcpVaultAccess } from "./acpFiles";
import type { AcpAgentSeen, AcpDeviceStore, AcpSessionEnd, AcpSessionEntry, AcpVaultStore } from "./acpStores";

/**
 * External agents in the assistant's session (plan KI-Harness P4.6): the
 * agents this DEVICE knows, and the one session an agent has in the open
 * VAULT.
 *
 * An agent is another maker's program. It is started in the vault's folder,
 * signs in by itself, reads what it likes and sends it where it likes — the
 * send overview and the privacy rules of the vault do not reach it, and the
 * surfaces say so before a session starts and for as long as it runs. What
 * this class holds to is the other half: what the agent asks PLAINVA for.
 * A file it asks the app for passes the vault's rules or is refused; a file
 * it asks the app to write is never written — a change becomes a suggestion
 * round under the agent's name, a new note a draft the user creates or throws
 * away (plan P5-6); a question it asks is the user's to answer; and a
 * terminal is not there to ask for.
 */

/**
 * The drafts of the vault a session runs in, as far as an agent reaches them
 * (plan P5-6). A note the agent wrote that does not exist yet waits there
 * like every other draft — on its card in the session and in the list of
 * everything that waits, also after the session ended.
 */
export interface AcpDrafts {
  /** Whether a note of this writer at this path can wait: there is room, or it takes the place of the writer's own earlier draft there. */
  room(authorId: string, path: string): Promise<boolean>;
  /** Leaves the note as a draft, in place of this writer's earlier draft at this path and under that one's id. */
  leave(note: { author: { id: string; label: string }; path: string; content: string; defused: number }): Promise<{ ok: true; id: string } | { ok: false; problem: "full" | "invalid" }>;
}

/** What became of the drafts a vault holds, as a session needs it: which still wait, and how the others ended. */
export interface AcpDraftsNow {
  waiting: ReadonlySet<string>;
  ended: ReadonlyMap<string, "created" | "discarded">;
}

export interface AiAcpHost {
  /** The shell's native side. */
  native: AcpNativeHost;
  /** The device's record of agents, in the app's data. */
  store: AcpDeviceStore;
  /** The app's version, as an agent is told who hosts it. */
  version(): Promise<string>;
  /**
   * Plainva's own tools as a program the agent may start (the helper every
   * MCP client on this computer starts): where the user switched them on;
   * null otherwise. Handing it over grants nothing — the app asks the user
   * which folders this client may read, as for every client.
   */
  toolbox(): Promise<AcpMcpServer | null>;
}

/** The open vault, as an agent's session needs it. */
export interface AcpVaultSide {
  access: AcpVaultAccess;
  store: AcpVaultStore;
  /** The note open in the shell right now — its path in the vault —, or null. */
  activeNote(): string | null;
  /** Where a note the agent wrote waits; the assistant's session hands it in. */
  drafts: AcpDrafts;
}

/** An agent as the settings and the start show it. */
export interface AiAcpAgent {
  id: string;
  label: string;
  /** The file that is started and its arguments — what the user confirmed. */
  program: string;
  args: string[];
  /** The name of the known agent this is, by its program; null for a command of the user's own. */
  known: string | null;
  /** What Plainva saw of its changes on this device, the last time it changed anything. */
  seen?: AcpAgentSeen;
}

/** An agent Plainva knows by name that is installed here and not added yet. */
export interface AiAcpFound {
  key: string;
  name: string;
  program: string;
  args: string[];
}

export type AcpSessionEvent =
  /** A change the agent wrote through the app waits in the note's margin. */
  | { type: "proposed"; path: string; blocks: number; defused: number }
  /** A note the agent wrote waits as a draft for the user to create it. */
  | { type: "new"; path: string }
  | { type: "created"; path: string }
  | { type: "discarded"; path: string }
  /** The agent reports a change it made itself: it is in the vault already. */
  | { type: "direct"; path: string }
  /** Plainva did not do what the agent asked for with a file. `path` is the vault's where the request meant one, else what the agent named. */
  | { type: "refused"; what: "read" | "write"; reason: AcpFileRefusalReason | "failed"; path: string }
  /** A turn ended for another reason than being done. */
  | { type: "stopped"; reason: Exclude<AcpStopReason, "end_turn"> }
  /** A turn failed with an error of the agent's own. */
  | { type: "failed"; message: string }
  /** The open note was not named to the agent: it is kept from the cloud. */
  | { type: "note-kept"; path: string };

export type AcpThreadItem =
  | { kind: "user"; id: number; text: string; note: string | null }
  | { kind: "agent"; id: number; text: string }
  | { kind: "tool"; id: number; toolId: string; title: string; toolKind: AcpToolKind; status: AcpToolStatus; files: string[]; outside: number }
  | { kind: "plan"; id: number; entries: AcpPlanEntry[] }
  | { kind: "event"; id: number; event: AcpSessionEvent };

export type AcpPhase =
  /** The program is coming up and a session is being opened. */
  | "starting"
  /** The agent wants a sign-in. */
  | "auth"
  /** A sign-in is under way: in a terminal, or by the agent itself. */
  | "signing-in"
  | "ready"
  /** A turn runs. */
  | "running"
  | "ended";

export type AcpSessionProblem =
  /** The program could not be started. */
  | { kind: "start"; word: AcpStartProblem }
  /** The program ended by itself. */
  | { kind: "exited"; code: number | null }
  /** It speaks another revision of the protocol. */
  | { kind: "version" }
  | { kind: "timeout" }
  /** Its answers could not be read. */
  | { kind: "protocol" }
  /** It answered with an error of its own. */
  | { kind: "agent"; message: string };

/** Why a sign-in did not happen. */
export type AcpAuthProblem = AcpLoginProblem | "declined" | "failed" | "no-method";

export interface AcpQuestion {
  /** The agent's own words for what it wants to do. */
  title: string;
  toolKind: AcpToolKind;
  /** Files of the vault it names. */
  files: string[];
  options: AcpPermissionOption[];
}

export interface AcpCounts {
  turns: number;
  read: number;
  proposed: number;
  created: number;
  direct: number;
  refused: number;
}

export interface AiAcpSession {
  agentId: string;
  label: string;
  phase: AcpPhase;
  /** What the agent calls itself. Its own claim, for display. */
  agentName: string | null;
  /** Whether Plainva's own tools were handed to the agent for this session. */
  tools: "offered" | "off";
  thread: AcpThreadItem[];
  question: AcpQuestion | null;
  /** The drafts this session left that still wait, by their id: the cards the session shows. */
  waiting: string[];
  authMethods: AcpAuthMethod[];
  authProblem: AcpAuthProblem | null;
  /** Where no terminal could be opened: the command to run in one's own. */
  manualSignIn: string | null;
  problem: AcpSessionProblem | null;
  counts: AcpCounts;
}

export interface AiAcpState {
  /** This shell hosts agents at all. */
  available: boolean;
  loaded: boolean;
  /** A vault is open. */
  vault: boolean;
  /** The open vault is an encrypted workspace: no agent is started there. */
  encrypted: boolean;
  agents: AiAcpAgent[];
  found: AiAcpFound[];
  session: AiAcpSession | null;
  /** The last sessions in this vault, newest first. */
  sessions: AcpSessionEntry[];
}

export const NO_ACP: AiAcpState = { available: false, loaded: false, vault: false, encrypted: false, agents: [], found: [], session: null, sessions: [] };

export type AcpAddResult = { ok: true; id: string } | { ok: false; problem: "declined" | "failed" };

type Translate = (key: string, vars?: Record<string, string>) => string;

export interface AcpClock {
  now(): Date;
  /** Runs something a little later: how reports that arrive in a burst become one repaint. */
  later?(run: () => void): void;
}

/** A session's thread keeps this many lines; the oldest go first. */
const THREAD_CAP = 600;
/** One piece of an agent's text in the thread grows no longer than this; what follows starts a new piece. */
const ITEM_TEXT_CAP = 200_000;
const EMPTY_COUNTS: AcpCounts = { turns: 0, read: 0, proposed: 0, created: 0, direct: 0, refused: 0 };
const CHANGING: readonly AcpToolKind[] = ["edit", "delete", "move"];

interface Live {
  agent: AiAcpAgent;
  /** The vault the session was started in: it reads, proposes and logs there, whatever is open when it ends. */
  vault: AcpVaultSide;
  root: string;
  client: AcpClient | null;
  view: AiAcpSession;
  nextItem: number;
  turn: AbortController | null;
  asks: { request: AcpPermissionRequest; resolve(optionId: string | null): void }[];
  /** What the agent wrote through the app in the turn that runs, by vault path: proposed once, when the turn ends. */
  drafts: Map<string, string>;
  /** Everything it wrote through the app in this session and nobody accepted yet: what it reads back. */
  own: Map<string, string>;
  /** The notes it wrote that wait as drafts, by vault path: the id of each one's draft. */
  news: Map<string, string>;
  /** Paths it reported as changed by itself in the turn that runs. */
  direct: Set<string>;
  /** The client is being replaced after a sign-in: its end is not the session's. */
  restarting: boolean;
  ended: boolean;
}

export class AiAcp {
  private vault: AcpVaultSide | null = null;
  private current: AiAcpState;
  private live: Live | null = null;
  /** Counts the vaults: an answer that arrives for a vault that was closed is dropped. */
  private generation = 0;
  private repaint = false;

  constructor(
    private readonly host: AiAcpHost | undefined,
    private readonly clock: AcpClock,
    private readonly t: Translate,
    private readonly publish: (state: AiAcpState) => void,
  ) {
    this.current = host ? { ...NO_ACP, available: true } : NO_ACP;
  }

  get state(): AiAcpState {
    return this.current;
  }

  private set(next: Partial<AiAcpState>): void {
    this.current = { ...this.current, ...next };
    this.publish(this.current);
  }

  /** Publishes the session as it is now. */
  private show(): void {
    const live = this.live;
    this.set({ session: live ? { ...live.view, thread: [...live.view.thread], waiting: [...live.news.values()], counts: { ...live.view.counts } } : null });
  }

  /** The same, a little later: a burst of reports is one repaint. */
  private showSoon(): void {
    if (this.repaint) return;
    this.repaint = true;
    const run = () => {
      this.repaint = false;
      this.show();
    };
    if (this.clock.later) this.clock.later(run);
    else setTimeout(run, 40);
  }

  /** Another vault, or none: a session belongs to the vault it was started in, and ends with it. */
  attach(vault: AcpVaultSide | null): void {
    const live = this.live;
    if (live) void this.finish(live, "closed", null).catch(() => undefined);
    this.live = null;
    this.vault = vault;
    this.generation++;
    this.set({ vault: Boolean(vault), encrypted: vault ? vault.access.encrypted() : false, session: null, sessions: [], loaded: false });
    if (this.host) void this.refresh();
  }

  /** Reads everything again — the native registry, the device's record, what is installed — and publishes it. */
  async refresh(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const generation = this.generation;
    try {
      const [registered, records, sessions] = await Promise.all([host.native.agents(), host.store.load().catch(() => ({})), this.vault ? this.vault.store.sessions().catch(() => []) : Promise.resolve([])]);
      const agents: AiAcpAgent[] = registered.map((entry) => {
        const record = (records as Record<string, { label: string; target: string; seen?: AcpAgentSeen }>)[entry.id];
        // A record belongs to the command it was made for: another one under the same id starts without a name and without a past.
        const mine = record && record.target === acpAgentTarget(entry) ? record : undefined;
        const known = acpKnownAgentOf(entry);
        return { id: entry.id, label: mine?.label ?? known?.name ?? entry.id, program: entry.program, args: entry.args, known: known?.name ?? null, ...(mine?.seen ? { seen: mine.seen } : {}) };
      });
      const open = ACP_KNOWN_AGENTS.filter((known) => !registered.some((entry) => acpKnownAgentOf(entry)?.key === known.key));
      const names = open.flatMap((known) => known.programs);
      const files = names.length ? await host.native.detect(names).catch(() => names.map(() => null)) : [];
      const found: AiAcpFound[] = [];
      let at = 0;
      for (const known of open) {
        const file = known.programs.map((_, index) => files[at + index] ?? null).find((entry) => entry !== null) ?? null;
        at += known.programs.length;
        if (file) found.push({ key: known.key, name: known.name, program: file, args: [...known.args] });
      }
      if (generation !== this.generation) return;
      this.set({ available: true, loaded: true, agents, found, sessions: [...sessions].reverse(), encrypted: this.vault ? this.vault.access.encrypted() : false });
    } catch {
      if (generation !== this.generation) return;
      // A native side that does not answer — a browser build has none — hosts nothing, and the surfaces show nothing for it.
      this.set({ available: false, loaded: true, agents: [], found: [] });
    }
  }

  /* ---- what the settings do ------------------------------------------------------------------ */

  /**
   * Adds an agent: the native side shows its whole command in a dialog of the
   * system and remembers it only on a yes. `wanted` is the id an agent Plainva
   * knows by name gets while it is free — what it proposes is then signed
   * `acp:gemini`, not with a word made from its label.
   */
  async add(label: string, command: { program: string; args: readonly string[] }, text: EndpointConfirmText, wanted?: string): Promise<AcpAddResult> {
    const host = this.host;
    if (!host) return { ok: false, problem: "failed" };
    try {
      const taken = (await host.native.agents()).map((agent) => agent.id);
      const id = wanted && isAcpAgentId(wanted) && !taken.includes(wanted) ? wanted : suggestAcpAgentId(label, taken);
      if (!(await host.native.add(id, command, text))) return { ok: false, problem: "declined" };
      const registered = (await host.native.agents()).find((agent) => agent.id === id);
      const records = await host.store.load().catch(() => ({}));
      await host.store.save({ ...records, [id]: { label: acpAgentLabel(label, id), addedAt: this.clock.now().toISOString(), target: registered ? acpAgentTarget(registered) : "" } });
      await this.refresh();
      return { ok: true, id };
    } catch {
      await this.refresh();
      return { ok: false, problem: "failed" };
    }
  }

  /** Forgets an agent on this device; its session, if it has one, ends first. */
  async remove(id: string): Promise<void> {
    const host = this.host;
    if (!host) return;
    if (this.live?.agent.id === id) {
      await this.end();
      this.dismiss();
    }
    await host.native.remove(id).catch(() => undefined);
    const records = await host.store.load().catch(() => ({}) as Record<string, never>);
    if (id in records) {
      const { [id]: _gone, ...rest } = records as Record<string, { label: string; addedAt: string; target: string }>;
      await host.store.save(rest).catch(() => undefined);
    }
    await this.refresh();
  }

  /* ---- a session ------------------------------------------------------------------------------ */

  /** Starts an agent in the open vault and opens its session. One session at a time. */
  async start(agentId: string): Promise<void> {
    const host = this.host;
    const vault = this.vault;
    if (!host || !vault || this.live || vault.access.encrypted()) return;
    const agent = this.current.agents.find((entry) => entry.id === agentId);
    if (!agent) return;
    const live: Live = {
      agent,
      vault,
      root: vault.access.root,
      client: null,
      view: {
        agentId: agent.id,
        label: agent.label,
        phase: "starting",
        agentName: null,
        tools: "off",
        thread: [],
        question: null,
        waiting: [],
        authMethods: [],
        authProblem: null,
        manualSignIn: null,
        problem: null,
        counts: { ...EMPTY_COUNTS },
      },
      nextItem: 1,
      turn: null,
      asks: [],
      drafts: new Map(),
      own: new Map(),
      news: new Map(),
      direct: new Set(),
      restarting: false,
      ended: false,
    };
    this.live = live;
    this.show();
    await this.connect(live);
  }

  /** Starts the program and opens a session; where the agent wants a sign-in first, the session says so and waits. */
  private async connect(live: Live): Promise<void> {
    const host = this.host;
    if (!host || live.ended) return;
    const version = (await host.version().catch(() => "")) || "0";
    const client = createAcpClient(
      // The words of the question the system asks before the first start in this folder; what is started and where, the native side adds itself.
      host.native.port(live.agent.id, live.root, {
        title: this.t("ai.agent.start.confirmTitle"),
        message: this.t("ai.agent.start.confirmMessage", { agent: live.agent.label }),
        confirm: this.t("ai.agent.start.action"),
        cancel: this.t("common.cancel"),
      }),
      {
        update: (update) => this.onUpdate(live, update),
        permission: (request, signal) => this.onQuestion(live, request, signal),
        readFile: (request) => this.onRead(live, request),
        writeFile: (request) => this.onWrite(live, request),
        exit: (code) => this.onExit(live, client, code),
      },
      // The agent learns who hosts it and in which version — nothing else about this device.
      { client: { name: "plainva", title: "Plainva", version } },
    );
    live.client = client;
    live.restarting = false;
    live.view.phase = "starting";
    this.show();
    try {
      const opened = await client.open();
      live.view.agentName = opened.agent ? opened.agent.title || opened.agent.name : null;
      live.view.authMethods = opened.authMethods;
      const toolbox = await host.toolbox().catch(() => null);
      live.view.tools = toolbox ? "offered" : "off";
      this.show();
      await client.newSession({ cwd: live.root, mcpServers: toolbox ? [toolbox] : [] });
      if (live.ended || live.client !== client) return;
      live.view.phase = "ready";
      live.view.authProblem = null;
      live.view.manualSignIn = null;
      this.show();
    } catch (error) {
      if (live.ended || live.client !== client) return;
      const failure = asAcpError(error).failure;
      if (failure.kind === "auth") {
        live.view.phase = "auth";
        if (live.view.authMethods.length === 0) live.view.authProblem = "no-method";
        this.show();
        return;
      }
      if (failure.kind === "unreachable" && failure.detail === ACP_START_DECLINED) {
        // The user's no in the system's dialog: nothing was started, and there is no session to show or to log.
        live.ended = true;
        live.client = null;
        await client.close().catch(() => undefined);
        if (this.live === live) {
          this.live = null;
          this.show();
        }
        return;
      }
      await this.finish(live, "failed", problemOf(failure));
    }
  }

  /** Signs in by a method the agent named: the agent does it itself, or its own program does in a terminal. */
  async signIn(methodId: string): Promise<void> {
    const host = this.host;
    const live = this.live;
    if (!host || !live || live.view.phase !== "auth") return;
    const method = live.view.authMethods.find((entry) => entry.id === methodId);
    if (!method || !live.client) return;
    live.view.phase = "signing-in";
    live.view.authProblem = null;
    live.view.manualSignIn = null;
    this.show();
    if (method.kind === "agent") {
      const client = live.client;
      try {
        await client.authenticate(method.id);
        const toolbox = await host.toolbox().catch(() => null);
        await client.newSession({ cwd: live.root, mcpServers: toolbox ? [toolbox] : [] });
        if (live.ended || live.client !== client) return;
        live.view.tools = toolbox ? "offered" : "off";
        live.view.phase = "ready";
      } catch (error) {
        if (live.ended || live.client !== client) return;
        const failure = asAcpError(error).failure;
        if (failure.kind === "exited") return;
        live.view.phase = "auth";
        live.view.authProblem = failure.kind === "cancelled" ? "cancelled" : "failed";
      }
      this.show();
      return;
    }
    try {
      const code = await host.native.login(live.agent.id, live.root, method.args, method.env);
      if (live.ended) return;
      if (code !== 0) {
        live.view.phase = "auth";
        live.view.authProblem = "declined";
        this.show();
        return;
      }
    } catch (error) {
      if (live.ended) return;
      const word = acpLoginProblem(error);
      live.view.phase = "auth";
      live.view.authProblem = word;
      // No terminal to open: the person runs the same command in their own, and comes back.
      if (word === "no-terminal") live.view.manualSignIn = acpCommandText(live.agent.program, [...live.agent.args, ...method.args]);
      this.show();
      return;
    }
    // The protocol's way after a sign-in in a terminal: the agent is started anew and asked again.
    await this.restart(live);
  }

  /** Stops waiting for a sign-in in a terminal. */
  cancelSignIn(): void {
    void this.host?.native.cancelLogin().catch(() => undefined);
  }

  /** Starts the agent anew and asks for a session again — after a sign-in the person made somewhere else. */
  async retry(): Promise<void> {
    const live = this.live;
    if (!live || (live.view.phase !== "auth" && live.view.phase !== "signing-in")) return;
    await this.restart(live);
  }

  private async restart(live: Live): Promise<void> {
    live.restarting = true;
    const old = live.client;
    live.client = null;
    await old?.close().catch(() => undefined);
    if (live.ended) return;
    await this.connect(live);
  }

  /** One turn: the user's words go to the agent, with the open note named where the user wants it and its rules allow it. */
  async send(text: string, options: { note?: boolean } = {}): Promise<void> {
    const live = this.live;
    const said = text.trim();
    if (!live || !live.client || live.view.phase !== "ready" || !said) return;
    const client = live.client;
    const vault = live.vault;
    const blocks: AcpPromptBlock[] = [{ type: "text", text: said }];
    let named: string | null = null;
    const open = options.note ? vault.activeNote() : null;
    if (open) {
      // Naming a note is telling the agent about it: a note kept from the cloud or from the internet is not named.
      const allowed = await vault.access
        .policyOf(open)
        .then((policy) => gateDecision(policy, acpGate(live.agent.id)).allowed)
        .catch(() => false);
      if (allowed) {
        blocks.push({ type: "resource_link", uri: acpFileUri(live.root, open), name: open.slice(open.lastIndexOf("/") + 1) });
        named = open;
      } else this.event(live, { type: "note-kept", path: open });
    }
    if (live.ended || live.view.phase !== "ready") return;
    this.push(live, { kind: "user", id: live.nextItem++, text: said, note: named });
    live.view.phase = "running";
    live.view.counts.turns++;
    live.turn = new AbortController();
    live.drafts.clear();
    live.direct.clear();
    this.show();
    let reason: AcpStopReason | null = null;
    let failure: AcpFailure | null = null;
    try {
      reason = await client.prompt(blocks, live.turn.signal);
    } catch (error) {
      failure = asAcpError(error).failure;
    }
    live.turn = null;
    // What the agent wrote through the app in this turn becomes one round per note — also where the turn was stopped or failed: it was told the writes were taken.
    await this.settle(live);
    if (live.ended) return;
    if (reason && reason !== "end_turn") this.event(live, { type: "stopped", reason });
    if (failure && failure.kind === "rpc") this.event(live, { type: "failed", message: failure.message });
    else if (failure && failure.kind !== "exited" && failure.kind !== "cancelled") this.event(live, { type: "failed", message: "" });
    live.view.phase = "ready";
    this.show();
  }

  /** Stops the turn that runs. */
  stop(): void {
    this.live?.turn?.abort();
  }

  /** The user's answer to the agent's question: one of its options, or none of them. */
  answer(optionId: string | null): void {
    const live = this.live;
    const asked = live?.asks.shift();
    if (!live || !asked) return;
    asked.resolve(optionId);
    live.view.question = live.asks[0] ? questionOf(live, live.asks[0].request) : null;
    this.show();
  }

  /**
   * The drafts of a vault changed (plan P5-6): somebody created or threw away
   * a note this session's agent wrote — on its card here, or in the list of
   * everything that waits. The session says so in its thread, and the agent
   * no longer reads its own text back for that path: a note that was created
   * is in the vault, stamp and all, and one that was thrown away is nowhere.
   */
  draftsChanged(drafts: AcpDrafts, now: AcpDraftsNow): void {
    const live = this.live;
    if (!live || live.vault.drafts !== drafts || live.news.size === 0) return;
    let changed = false;
    for (const [path, id] of [...live.news]) {
      if (now.waiting.has(id)) continue;
      const ended = now.ended.get(id);
      live.news.delete(path);
      live.own.delete(path);
      if (ended === "created") live.view.counts.created++;
      if (ended) this.event(live, { type: ended, path });
      changed = true;
    }
    if (changed) this.show();
  }

  /** Ends the session: the agent's program stops. What it wrote stays to be read until the session is closed. */
  async end(): Promise<void> {
    const live = this.live;
    if (live) await this.finish(live, "closed", null);
  }

  /** Clears a session that ended. */
  dismiss(): void {
    const live = this.live;
    if (!live || !live.ended) return;
    this.live = null;
    this.show();
  }

  /** The end of what the agent's program wrote to its error stream: text for a person. */
  log(): Promise<string> {
    const live = this.live;
    return live && this.host ? this.host.native.log(live.agent.id).catch(() => "") : Promise.resolve("");
  }

  dispose(): void {
    const live = this.live;
    if (live) void this.finish(live, "closed", null).catch(() => undefined);
  }

  /* ---- what an agent does ---------------------------------------------------------------------- */

  private push(live: Live, item: AcpThreadItem): void {
    live.view.thread.push(item);
    if (live.view.thread.length > THREAD_CAP) live.view.thread.splice(0, live.view.thread.length - THREAD_CAP);
  }

  private event(live: Live, event: AcpSessionEvent): void {
    this.push(live, { kind: "event", id: live.nextItem++, event });
  }

  private onUpdate(live: Live, update: AcpUpdate): void {
    if (live.ended) return;
    if (update.kind === "text") {
      // What the agent thinks to itself and what it repeats of the user's words is not shown: the thread is what was said.
      if (update.role !== "agent") return;
      const last = live.view.thread[live.view.thread.length - 1];
      if (last && last.kind === "agent" && last.text.length + update.text.length <= ITEM_TEXT_CAP) live.view.thread[live.view.thread.length - 1] = { ...last, text: last.text + update.text };
      else this.push(live, { kind: "agent", id: live.nextItem++, text: update.text.slice(0, ITEM_TEXT_CAP) });
    } else if (update.kind === "tool") {
      this.onTool(live, update.tool);
    } else if (update.kind === "plan") {
      const at = live.view.thread.findIndex((item) => item.kind === "plan");
      // An agent sends its whole plan each time: the thread keeps one, where it first stood.
      if (at >= 0) live.view.thread[at] = { kind: "plan", id: live.view.thread[at]!.id, entries: update.entries };
      else if (update.entries.length) this.push(live, { kind: "plan", id: live.nextItem++, entries: update.entries });
    } else return;
    this.showSoon();
  }

  /** The files of the vault a tool call names, in the vault's own paths, and how many it names outside. */
  private filesOf(live: Live, tool: AcpToolUpdate): { files: string[]; outside: number } {
    const files: string[] = [];
    let outside = 0;
    const named = [...(tool.locations ?? []).map((location) => location.path), ...(tool.content ?? []).flatMap((entry) => (entry.type === "diff" ? [entry.path] : []))];
    for (const path of named) {
      const mapped = acpVaultPath(live.root, path);
      if (!mapped.ok) outside += mapped.problem === "outside" ? 1 : 0;
      else if (!files.includes(mapped.path) && files.length < 8) files.push(mapped.path);
    }
    return { files, outside };
  }

  private onTool(live: Live, tool: AcpToolUpdate): void {
    const at = live.view.thread.findIndex((item) => item.kind === "tool" && item.toolId === tool.id);
    const before = at >= 0 ? (live.view.thread[at] as Extract<AcpThreadItem, { kind: "tool" }>) : null;
    const named = this.filesOf(live, tool);
    const next: Extract<AcpThreadItem, { kind: "tool" }> = {
      kind: "tool",
      id: before?.id ?? live.nextItem++,
      toolId: tool.id,
      title: tool.title ?? before?.title ?? "",
      toolKind: tool.toolKind ?? before?.toolKind ?? "other",
      status: tool.status ?? before?.status ?? "pending",
      files: [...new Set([...(before?.files ?? []), ...named.files])].slice(0, 8),
      outside: Math.max(before?.outside ?? 0, named.outside),
    };
    if (at >= 0) live.view.thread[at] = next;
    else this.push(live, next);
    // A change the agent says it finished, to a note it did not hand to the app in this turn: it wrote it itself.
    if (next.status === "completed" && before?.status !== "completed" && CHANGING.includes(next.toolKind)) {
      for (const path of next.files) {
        if (live.drafts.has(path) || live.direct.has(path)) continue;
        live.direct.add(path);
        live.view.counts.direct++;
        this.event(live, { type: "direct", path });
      }
    }
  }

  private onQuestion(live: Live, request: AcpPermissionRequest, signal: AbortSignal): Promise<string | null> {
    if (live.ended || signal.aborted) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      const entry = { request, resolve };
      signal.addEventListener(
        "abort",
        () => {
          // The turn was stopped, or the program ended: the question is moot.
          const index = live.asks.indexOf(entry);
          if (index < 0) return;
          live.asks.splice(index, 1);
          live.view.question = live.asks[0] ? questionOf(live, live.asks[0].request) : null;
          resolve(null);
          this.show();
        },
        { once: true },
      );
      live.asks.push(entry);
      if (live.asks.length === 1) {
        live.view.question = questionOf(live, request);
        this.show();
      }
    });
  }

  private refused(live: Live, what: "read" | "write", error: unknown, named: string): void {
    live.view.counts.refused++;
    const refusal = error instanceof AcpFileRefusal ? error : null;
    this.event(live, { type: "refused", what, reason: refusal?.reason ?? "failed", path: refusal?.path ?? named.slice(0, 300) });
    this.showSoon();
  }

  private async onRead(live: Live, request: AcpFileRead): Promise<string> {
    if (live.ended) throw new AcpFileRefusal("outside");
    try {
      const read = await acpReadFile(live.vault.access, live.agent.id, request, (path) => live.own.get(path));
      live.view.counts.read++;
      return read.content;
    } catch (error) {
      this.refused(live, "read", error, request.path);
      throw error;
    }
  }

  private async onWrite(live: Live, request: AcpFileWrite): Promise<void> {
    if (live.ended) throw new AcpFileRefusal("outside");
    try {
      // Planned now, so that the agent hears at once what Plainva does not take; proposed when the turn ends, so that one note gets one round.
      const plan = await acpPlanWrite(live.vault.access, live.agent.id, request);
      // A new note waits as a draft, and the list of drafts never drops one to make room: the agent hears when it is full.
      if (plan.kind === "new" && !(await live.vault.drafts.room(acpAuthorId(live.agent.id), plan.path).catch(() => false))) throw new AcpFileRefusal("waiting", plan.path);
      live.own.set(plan.path, request.content);
      live.drafts.set(plan.path, request.content);
    } catch (error) {
      this.refused(live, "write", error, request.path);
      throw error;
    }
  }

  /** The end of a turn: every note the agent wrote through the app in it gets one round, or waits as a new note. */
  private async settle(live: Live): Promise<void> {
    const vault = live.vault;
    const drafts = [...live.drafts];
    live.drafts.clear();
    for (const [path, content] of drafts) {
      try {
        // Against the note as it is NOW: the user may have typed while the agent worked.
        const { exists } = await acpSpelledPath(vault.access, path);
        const plan = await acpPlanNoteWrite(vault.access, live.agent.id, path, exists, content);
        if (plan.kind === "round") {
          await acpProposeRound(vault.access, live.agent.id, plan, {
            note: this.t("ai.agent.roundNote", { agent: live.agent.label }),
            defused: this.t("ai.lint.defused"),
            author: this.t("ai.agent.author", { agent: live.agent.label }),
          });
          live.view.counts.proposed++;
          this.event(live, { type: "proposed", path, blocks: plan.chunks.length, defused: plan.defused });
        } else if (plan.kind === "new") {
          // A draft like every other (plan P5-6): signed with the agent's id on this device and the user's name for it,
          // in place of the one it left at this path before.
          const left = await vault.drafts.leave({
            author: { id: acpAuthorId(live.agent.id), label: this.t("ai.agent.author", { agent: live.agent.label }) },
            path,
            content: plan.content,
            defused: plan.defused,
          });
          if (!left.ok) {
            live.own.delete(path);
            this.event(live, { type: "refused", what: "write", reason: left.problem === "full" ? "waiting" : "failed", path });
          } else {
            const waiting = live.news.has(path);
            live.news.set(path, left.id);
            if (!waiting) this.event(live, { type: "new", path });
          }
        } else {
          // The note says this already: nothing of the agent's waits for it any more.
          live.own.delete(path);
        }
      } catch (error) {
        const refusal = error instanceof AcpFileRefusal ? error : null;
        this.event(live, { type: "refused", what: "write", reason: refusal?.reason ?? "failed", path });
      }
    }
  }

  private onExit(live: Live, client: AcpClient, code: number | null): void {
    // A client that was replaced after a sign-in, or closed by the session itself, ends without ending the session.
    if (live.client !== client || live.restarting || live.ended) return;
    void this.finish(live, "exited", { kind: "exited", code });
  }

  /** Ends a session: stops what runs, proposes what was written, writes the vault's log line and what was seen of the agent. */
  private async finish(live: Live, end: AcpSessionEnd, problem: AcpSessionProblem | null): Promise<void> {
    if (live.ended) return;
    live.ended = true;
    live.turn?.abort();
    for (const asked of live.asks.splice(0)) asked.resolve(null);
    live.view.question = null;
    const client = live.client;
    live.client = null;
    await client?.close().catch(() => undefined);
    await this.settle(live).catch(() => undefined);
    live.view.phase = "ended";
    live.view.problem = problem;
    const counts = live.view.counts;
    const at = this.clock.now().toISOString();
    const through = counts.proposed + live.news.size + counts.created;
    // A session that never came up is not one the vault's log needs a line for.
    if (counts.turns > 0 || end !== "failed") {
      await live.vault.store.log({ at, agent: live.agent.id, label: live.agent.label, turns: counts.turns, read: counts.read, proposed: counts.proposed, created: counts.created, direct: counts.direct, refused: counts.refused, end }).catch(() => undefined);
    }
    if (this.host && (through > 0 || counts.direct > 0)) {
      // Which way an agent's changes take is the one thing about it nobody can promise: the list shows what happened here.
      const records = await this.host.store.load().catch(() => null);
      const record = records?.[live.agent.id];
      if (records && record) await this.host.store.save({ ...records, [live.agent.id]: { ...record, seen: { at, proposed: through, direct: counts.direct } } }).catch(() => undefined);
    }
    if (this.live === live) this.show();
    void this.refresh();
  }
}

function problemOf(failure: AcpFailure): AcpSessionProblem {
  switch (failure.kind) {
    case "unreachable":
      return { kind: "start", word: acpStartProblem(failure.detail ?? "") };
    case "exited":
      return { kind: "exited", code: failure.code };
    case "version":
      return { kind: "version" };
    case "timeout":
      return { kind: "timeout" };
    case "rpc":
      return { kind: "agent", message: failure.message };
    default:
      return { kind: "protocol" };
  }
}

function questionOf(live: Live, request: AcpPermissionRequest): AcpQuestion {
  const files: string[] = [];
  for (const path of [...(request.tool.locations ?? []).map((location) => location.path), ...(request.tool.content ?? []).flatMap((entry) => (entry.type === "diff" ? [entry.path] : []))]) {
    const mapped = acpVaultPath(live.root, path);
    if (mapped.ok && !files.includes(mapped.path) && files.length < 8) files.push(mapped.path);
  }
  // A question about a call the thread already shows takes that call's words where it brings none of its own.
  const shown = live.view.thread.find((item) => item.kind === "tool" && item.toolId === request.tool.id) as Extract<AcpThreadItem, { kind: "tool" }> | undefined;
  return { title: request.tool.title ?? shown?.title ?? "", toolKind: request.tool.toolKind ?? shown?.toolKind ?? "other", files: files.length ? files : (shown?.files ?? []), options: request.options };
}
