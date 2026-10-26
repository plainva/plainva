import { acpNoSuchMethod, createAcpConnection, type AcpPort } from "./connection.js";
import {
  ACP_ERROR_INVALID_PARAMS,
  AcpError,
  AcpRefusal,
  acpInitializeParams,
  readAcpConfigOptions,
  readAcpFileRead,
  readAcpFileWrite,
  readAcpInitialize,
  readAcpPermissionRequest,
  readAcpSessionSetup,
  readAcpStopReason,
  readAcpUpdate,
  type AcpClientInfo,
  type AcpConfigOption,
  type AcpFileRead,
  type AcpFileWrite,
  type AcpMcpServer,
  type AcpModes,
  type AcpOpened,
  type AcpPermissionRequest,
  type AcpPromptBlock,
  type AcpSessionOpened,
  type AcpStopReason,
  type AcpUpdate,
} from "./protocol.js";

/**
 * One agent, from its start to its end (plan KI-Harness P4.6): the handshake,
 * a sign-in the agent does itself, one session in a folder, turns in it.
 *
 * What an agent may ask of Plainva is exactly four things, and each lands in
 * a handler of the host: a report of what it does, a question to the user, a
 * file to read, a file to write. A terminal is not among them — Plainva told
 * the agent it offers none, and a request for one is answered like any method
 * that does not exist. A request that names another session than the one this
 * client opened is refused before a handler sees it.
 *
 * What the user may set for the session (plan P9-7) — its settings, or its
 * modes in the older way — the client keeps as the agent last said them, and
 * it asks the agent for a change only to a setting and a value the agent
 * offered: like an option of its question, nothing else is a choice.
 */

export interface AcpHost {
  /** The agent reports what it does. */
  update(update: AcpUpdate): void;
  /**
   * The session's settings as the agent's answer to `session/new` names them
   * (plan P9-7), told where that answer is read: what the agent reports right
   * behind it is measured against them.
   */
  opened?(settings: AcpSessionSettings): void;
  /**
   * The agent asks the user. Resolve with the id of the option the user chose,
   * or with null where they chose none. `signal` ends when the turn is
   * stopped: the question is then moot, and the agent is told so.
   */
  permission(request: AcpPermissionRequest, signal: AbortSignal): Promise<string | null>;
  /** The agent wants the text of a file. Throw an `AcpRefusal` where Plainva does not hand it over. */
  readFile(request: AcpFileRead): Promise<string>;
  /** The agent wants to write a file. Throw an `AcpRefusal` where Plainva does not take it. */
  writeFile(request: AcpFileWrite): Promise<void>;
  /** The program ended. */
  exit(code: number | null): void;
}

export interface AcpTimeouts {
  /** The handshake: a first start may fetch the agent's own parts. */
  open: number;
  /** A new session: the agent starts its tool servers, and one of them may be waiting for the user's leave. */
  session: number;
  /** A sign-in the agent does itself: a browser may be open. */
  authenticate: number;
  /** How long a stopped turn is waited for before it counts as stopped anyway. */
  stop: number;
}

/**
 * A change of a setting or a mode (plan P9-7) has no time limit: another model
 * may have to be reached first, the protocol has no way to call it off, and an
 * answer that came after a limit would be taken for the agent's own doing.
 */
export const ACP_TIMEOUTS: AcpTimeouts = { open: 60_000, session: 300_000, authenticate: 300_000, stop: 10_000 };

/** Reports kept while a session is being opened (plan P9-7): an agent sends a few — its commands, its settings. */
export const ACP_EARLY_UPDATES = 64;
/** The sessions whose early reports are kept: one of them will be the session's. */
export const ACP_EARLY_SESSIONS = 4;

/** Reports that carry the whole of what they report: the newest of each stands for those before it. */
const WHOLE_STATE: ReadonlySet<AcpUpdate["kind"]> = new Set(["config", "commands", "mode"]);

/** A host's error is its own: what the client keeps stays the agent's word. */
function tell(call: () => void): void {
  try {
    call();
  } catch {
    // Nothing to do here: the client's state is already what the agent said.
  }
}

/** What the user may set for a session, as the agent last said it. */
export interface AcpSessionSettings {
  /** Its settings; null where it offers none. */
  config: AcpConfigOption[] | null;
  /** Its modes in the older way, only where it offers no settings. */
  modes: AcpModes | null;
}

export interface AcpClientOptions {
  client: AcpClientInfo;
  timeouts?: Partial<AcpTimeouts>;
}

export interface AcpSessionSetup {
  /** The folder the agent works in: absolute, the vault's. */
  cwd: string;
  mcpServers: readonly AcpMcpServer[];
}

export interface AcpClient {
  /** Starts the program and shakes hands. Asked once; later calls answer from what was learned. */
  open(signal?: AbortSignal): Promise<AcpOpened>;
  /** Asks the agent to sign in by a method it named itself. */
  authenticate(methodId: string, signal?: AbortSignal): Promise<void>;
  /** Opens the one session of this client. Rejects with the failure "auth" where the agent wants a sign-in first. */
  newSession(setup: AcpSessionSetup, signal?: AbortSignal): Promise<AcpSessionOpened>;
  /** What the user may set for the session, as the agent last said it. */
  settings(): AcpSessionSettings;
  /**
   * Asks the agent to change one of its settings to one of its values;
   * resolves with every setting as the agent says it is now. Rejects without
   * asking where the setting or the value is not one the agent offered.
   */
  setConfigOption(configId: string, value: string | boolean, signal?: AbortSignal): Promise<AcpConfigOption[]>;
  /** Asks the agent to work in another of its modes (the older way). Rejects without asking for a mode it did not offer. */
  setMode(modeId: string, signal?: AbortSignal): Promise<void>;
  /** One turn: resolves when the agent is done with it, with why it stopped. Stopping the signal stops the turn. */
  prompt(blocks: readonly AcpPromptBlock[], signal?: AbortSignal): Promise<AcpStopReason>;
  /** Ends the program. */
  close(): Promise<void>;
  /** The session this client opened; null before. */
  sessionId(): string | null;
}

/** A setting at the value a bare answer names, where the setting still offers it; as it was where not. */
function taken(option: AcpConfigOption, value: string | boolean): AcpConfigOption {
  if (option.type === "boolean") return typeof value === "boolean" ? { ...option, current: value } : option;
  return typeof value === "string" && option.values.some((offered) => offered.value === value) ? { ...option, current: value } : option;
}

export function createAcpClient(port: AcpPort, host: AcpHost, options: AcpClientOptions): AcpClient {
  const timeouts = { ...ACP_TIMEOUTS, ...options.timeouts };
  let opened: AcpOpened | null = null;
  let opening: Promise<AcpOpened> | null = null;
  let session: string | null = null;
  let config: AcpConfigOption[] | null = null;
  let modes: AcpModes | null = null;
  /**
   * Reports that came while the answer to `session/new` was on its way: an
   * agent may send its commands right behind that answer, and both can be read
   * before the answer is (plan P9-7). They are kept — a few — until the
   * session's id is known; then those of this session count, in their order.
   * A report of the settings, the commands or the mode carries the whole of
   * it: only the newest of each kind is kept for a session, and no other
   * report takes its place; reports for more than a few sessions are not kept.
   */
  let early: { sessionId: string; update: AcpUpdate }[] | null = null;
  /** The questions the agent waits on: all of them end when the turn is stopped. */
  const asking = new Set<AbortController>();

  const own = (sessionId: string) => {
    if (session === null || sessionId !== session) throw new AcpRefusal(ACP_ERROR_INVALID_PARAMS, "Unknown session.");
  };

  const connection = createAcpConnection(port, {
    async request(method, params) {
      switch (method) {
        case "session/request_permission": {
          const request = readAcpPermissionRequest(params);
          // Nothing a person could choose from: the agent is told nobody chose.
          if (!request) return { outcome: { outcome: "cancelled" } };
          own(request.sessionId);
          const stop = new AbortController();
          asking.add(stop);
          try {
            const chosen = await host.permission(request, stop.signal);
            // Only a choice the agent offered is one: an id from anywhere else is no answer.
            if (chosen === null || stop.signal.aborted || !request.options.some((option) => option.id === chosen)) return { outcome: { outcome: "cancelled" } };
            return { outcome: { outcome: "selected", optionId: chosen } };
          } finally {
            asking.delete(stop);
          }
        }
        case "fs/read_text_file": {
          const request = readAcpFileRead(params);
          own(request.sessionId);
          return { content: await host.readFile(request) };
        }
        case "fs/write_text_file": {
          const request = readAcpFileWrite(params);
          own(request.sessionId);
          await host.writeFile(request);
          return {};
        }
        default:
          // A terminal, a question in a form, anything newer: not offered, so not there.
          throw acpNoSuchMethod();
      }
    },
    notification(method, params) {
      if (method !== "session/update") return;
      const read = readAcpUpdate(params);
      if (!read) return;
      if (session === null) {
        if (!early) return;
        const kind = read.update.kind;
        if (!early.some((kept) => kept.sessionId === read.sessionId) && new Set(early.map((kept) => kept.sessionId)).size >= ACP_EARLY_SESSIONS) return;
        if (WHOLE_STATE.has(kind)) {
          early = early.filter((kept) => kept.sessionId !== read.sessionId || kept.update.kind !== kind);
          early.push(read);
        } else if (early.filter((kept) => !WHOLE_STATE.has(kept.update.kind)).length < ACP_EARLY_UPDATES) early.push(read);
        return;
      }
      if (read.sessionId === session) take(read.update);
    },
    exit(code) {
      for (const stop of [...asking]) stop.abort();
      host.exit(code);
    },
  });

  /** A report of the session: what it says of the settings is kept, and the host hears it. */
  const take = (update: AcpUpdate) => {
    if (update.kind === "config") {
      config = update.options;
      // Settings take the place of the older modes from the first report of them on, as the protocol says.
      modes = null;
    } else if (update.kind === "mode") {
      // The older way counts only where the agent offers no settings, and only for a mode it offered.
      if (config !== null || !modes || !modes.available.some((mode) => mode.id === update.current)) return;
      modes = { ...modes, current: update.current };
    }
    host.update(update);
  };

  const open = (signal?: AbortSignal): Promise<AcpOpened> => {
    if (opened) return Promise.resolve(opened);
    opening ??= (async () => {
      await connection.start();
      const result = await connection.request("initialize", acpInitializeParams(options.client), { timeoutMs: timeouts.open, ...(signal ? { signal } : {}) });
      opened = readAcpInitialize(result);
      return opened;
    })().catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };

  return {
    open,
    async authenticate(methodId, signal) {
      const known = await open(signal);
      // A method the agent did not name, or one that is done in a terminal, is not asked for here.
      if (!known.authMethods.some((method) => method.id === methodId && method.kind === "agent")) throw new AcpError({ kind: "protocol", detail: "no such sign-in" });
      await connection.request("authenticate", { methodId }, { timeoutMs: timeouts.authenticate, ...(signal ? { signal } : {}) });
    },
    async newSession(setup, signal) {
      await open(signal);
      if (session !== null) throw new AcpError({ kind: "protocol", detail: "a session is open" });
      // Each attempt keeps only what comes while it waits.
      early = [];
      let answered = false;
      // The answer takes effect where it is read: what the agent reported before it counts first, then the answer
      // stands — and the host learns it there, before what the agent reports right behind it.
      const install = (result: Record<string, unknown>) => {
        const answer = readAcpSessionSetup(result);
        answered = true;
        session = answer.sessionId;
        const waiting = early ?? [];
        early = null;
        for (const read of waiting) if (read.sessionId === session) tell(() => take(read.update));
        config = answer.config;
        modes = answer.modes;
        const settings = { config, modes };
        tell(() => host.opened?.(settings));
      };
      const result = await connection.request(
        "session/new",
        { cwd: setup.cwd, mcpServers: setup.mcpServers.map((server) => ({ name: server.name, command: server.command, args: [...server.args], env: server.env.map((entry) => ({ name: entry.name, value: entry.value })) })) },
        { timeoutMs: timeouts.session, ...(signal ? { signal } : {}), onResult: install },
      );
      // An answer that could not be read where it came is read here, where its error fails the call.
      if (!answered) install(result);
      return { sessionId: session!, config, modes };
    },
    settings: () => ({ config, modes }),
    async setConfigOption(configId, value, signal) {
      const sessionId = session;
      if (sessionId === null) throw new AcpError({ kind: "protocol", detail: "no session" });
      const option = config?.find((entry) => entry.id === configId);
      const offered = option ? (option.type === "boolean" ? typeof value === "boolean" : typeof value === "string" && option.values.some((entry) => entry.value === value)) : false;
      if (!option || !offered) throw new AcpError({ kind: "protocol", detail: "no such setting" });
      // The agent answers with every setting as it is now — an answer without them is taken at its word for this one,
      // while the value is still one it offers —, and the host hears it where it is read: a report the agent sends right
      // behind it comes after it.
      const answered = (result: Record<string, unknown>) => {
        const next = readAcpConfigOptions(result.configOptions);
        const options = next ?? (config ?? []).map((entry) => (entry.id !== configId ? entry : taken(entry, value)));
        config = options;
        if (next) modes = null;
        tell(() => host.update({ kind: "config", options, answer: true }));
      };
      await connection.request("session/set_config_option", { sessionId, configId, value, ...(typeof value === "boolean" ? { type: "boolean" } : {}) }, { ...(signal ? { signal } : {}), onResult: answered });
      return config ?? [];
    },
    async setMode(modeId, signal) {
      const sessionId = session;
      if (sessionId === null) throw new AcpError({ kind: "protocol", detail: "no session" });
      if (config !== null || !modes || !modes.available.some((mode) => mode.id === modeId)) throw new AcpError({ kind: "protocol", detail: "no such mode" });
      // Taken where the answer is read, before what the agent reports behind it.
      const answered = () => {
        if (!modes) return;
        modes = { ...modes, current: modeId };
        tell(() => host.update({ kind: "mode", current: modeId, answer: true }));
      };
      await connection.request("session/set_mode", { sessionId, modeId }, { ...(signal ? { signal } : {}), onResult: answered });
    },
    async prompt(blocks, signal) {
      const sessionId = session;
      if (sessionId === null) throw new AcpError({ kind: "protocol", detail: "no session" });
      if (signal?.aborted) return "cancelled";
      const turn = connection.request("session/prompt", { sessionId, prompt: blocks.map((block) => ({ ...block })) });
      if (!signal) return readAcpStopReason(await turn);
      let stopTimer: ReturnType<typeof setTimeout> | undefined;
      const stopped = new Promise<"cancelled">((resolve) => {
        const onAbort = () => {
          // The protocol's way to stop a turn: say so, answer every open question with "nobody chose", and wait for the turn to end.
          for (const stop of [...asking]) stop.abort();
          void connection.notify("session/cancel", { sessionId });
          // An agent that does not end the turn is not waited for forever.
          stopTimer = setTimeout(() => resolve("cancelled"), timeouts.stop);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void turn.then(
          () => signal.removeEventListener("abort", onAbort),
          () => signal.removeEventListener("abort", onAbort),
        );
      });
      try {
        const first = await Promise.race([turn.then((result) => ({ result })), stopped.then((reason) => ({ reason }))]);
        if ("reason" in first) {
          // The late answer of a turn nobody waits for any more must not be an unhandled rejection.
          turn.catch(() => undefined);
          return first.reason;
        }
        return signal.aborted ? "cancelled" : readAcpStopReason(first.result);
      } catch (error) {
        // A turn the user stopped is a stopped turn, whatever the agent made of the stop; a program that ended says so itself.
        if (signal.aborted) return "cancelled";
        throw error;
      } finally {
        if (stopTimer !== undefined) clearTimeout(stopTimer);
      }
    },
    async close() {
      for (const stop of [...asking]) stop.abort();
      await connection.close();
    },
    sessionId: () => session,
  };
}
