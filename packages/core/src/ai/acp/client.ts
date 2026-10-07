import { acpNoSuchMethod, createAcpConnection, type AcpPort } from "./connection.js";
import {
  ACP_ERROR_INVALID_PARAMS,
  AcpError,
  AcpRefusal,
  acpInitializeParams,
  readAcpFileRead,
  readAcpFileWrite,
  readAcpInitialize,
  readAcpNewSession,
  readAcpPermissionRequest,
  readAcpStopReason,
  readAcpUpdate,
  type AcpClientInfo,
  type AcpFileRead,
  type AcpFileWrite,
  type AcpMcpServer,
  type AcpOpened,
  type AcpPermissionRequest,
  type AcpPromptBlock,
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
 */

export interface AcpHost {
  /** The agent reports what it does. */
  update(update: AcpUpdate): void;
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

export const ACP_TIMEOUTS: AcpTimeouts = { open: 60_000, session: 300_000, authenticate: 300_000, stop: 10_000 };

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
  newSession(setup: AcpSessionSetup, signal?: AbortSignal): Promise<string>;
  /** One turn: resolves when the agent is done with it, with why it stopped. Stopping the signal stops the turn. */
  prompt(blocks: readonly AcpPromptBlock[], signal?: AbortSignal): Promise<AcpStopReason>;
  /** Ends the program. */
  close(): Promise<void>;
  /** The session this client opened; null before. */
  sessionId(): string | null;
}

export function createAcpClient(port: AcpPort, host: AcpHost, options: AcpClientOptions): AcpClient {
  const timeouts = { ...ACP_TIMEOUTS, ...options.timeouts };
  let opened: AcpOpened | null = null;
  let opening: Promise<AcpOpened> | null = null;
  let session: string | null = null;
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
      if (!read || read.sessionId !== session) return;
      host.update(read.update);
    },
    exit(code) {
      for (const stop of [...asking]) stop.abort();
      host.exit(code);
    },
  });

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
      const result = await connection.request(
        "session/new",
        { cwd: setup.cwd, mcpServers: setup.mcpServers.map((server) => ({ name: server.name, command: server.command, args: [...server.args], env: server.env.map((entry) => ({ name: entry.name, value: entry.value })) })) },
        { timeoutMs: timeouts.session, ...(signal ? { signal } : {}) },
      );
      session = readAcpNewSession(result);
      return session;
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
