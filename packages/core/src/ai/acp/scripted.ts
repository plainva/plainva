import type { AcpPort } from "./connection.js";

/**
 * An agent in a script, for tests in every package (plan KI-Harness P4.6): a
 * port that behaves like an agent's program — the handshake, a sign-in, a
 * session, turns that report, ask, read and write — and that can misbehave
 * the ways a real one can: another revision, a sign-in it insists on, lines
 * that are no messages, requests for what Plainva never offered, an exit in
 * the middle of a turn.
 *
 * It keeps what it was sent and what it was answered, so a test can say what
 * reached the agent and what did not.
 */

export type ScriptedAcpStep =
  /** Streams text. */
  | { say: string; role?: "agent" | "thought" | "user" }
  /** Announces a tool call (`tool_call`), as the agent would send it. */
  | { tool: Record<string, unknown> }
  /** Changes one (`tool_call_update`). */
  | { toolUpdate: Record<string, unknown> }
  | { plan: unknown[] }
  /** Asks the user (`session/request_permission`) and waits for the answer. */
  | { ask: { toolCall: Record<string, unknown>; options: unknown[] } }
  /** Asks the host for a file and waits. */
  | { read: { path: string; line?: number; limit?: number } }
  /** Asks the host to write a file and waits. */
  | { write: { path: string; content: string } }
  /** Any request of the agent's own, and waits: a terminal, a method that does not exist. */
  | { request: { method: string; params: Record<string, unknown> } }
  /** Any notification. */
  | { notify: { method: string; params: Record<string, unknown> } }
  /** A line exactly as given: something that is no message. */
  | { raw: string }
  /** Waits until the host stops the turn. */
  | { wait: "cancel" }
  /** The program ends here, in the middle of the turn. */
  | { exit: number | null };

export interface ScriptedAcpOptions {
  /** What the agent calls itself; null says nothing. */
  info?: { name: string; title?: string; version?: string } | null;
  /** The revision it answers the handshake with. */
  version?: unknown;
  /** Its sign-in methods, as it would send them. */
  authMethods?: unknown[];
  /** It wants a sign-in before it opens a session. */
  needsAuth?: boolean;
  /** One script per turn, in order; a turn beyond the last says "Done.". */
  turns?: ScriptedAcpStep[][];
  /** The program cannot be started: `start` rejects with this word. */
  startFails?: string;
  /** What it puts into `session/new`'s answer beside the id. */
  sessionExtras?: Record<string, unknown>;
  /** It never answers `session/new`. */
  hangsOnSession?: boolean;
  /** After a stop it never ends the turn. */
  ignoresCancel?: boolean;
}

export interface ScriptedAcpAnswer {
  method: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface ScriptedAcpAgent {
  port: AcpPort;
  /** Every message the host sent, parsed, in order. */
  received: Record<string, unknown>[];
  /** What the host answered the agent's own requests with, in the order they were asked. */
  answers: ScriptedAcpAnswer[];
  /** The id of the session it opened. */
  session: string;
  /** How often the host stopped a turn. */
  cancels: number;
  /** Whether a sign-in happened (set by `authenticate`, or by a test that plays the terminal). */
  signedIn: boolean;
  running: boolean;
  /** Whether the host ended the program itself. */
  stopped: boolean;
  starts: number;
  /** Says something outside a turn. */
  emit(message: Record<string, unknown>): void;
  /** Ends the program from outside, as a crash would. */
  crash(code: number | null): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function scriptedAcpAgent(options: ScriptedAcpOptions = {}): ScriptedAcpAgent {
  let onLine: ((line: string) => void) | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  let nextId = 1000;
  let turn = 0;
  const waiting = new Map<number, { method: string; resolve: () => void }>();
  let cancelWaiters: (() => void)[] = [];

  const agent: ScriptedAcpAgent = {
    port: {
      async start(line, exit) {
        if (options.startFails) throw new Error(options.startFails);
        onLine = line;
        onExit = exit;
        agent.running = true;
        agent.starts++;
      },
      async write(line) {
        if (!agent.running) throw new Error("the program is not running");
        let message: unknown;
        try {
          message = JSON.parse(line) as unknown;
        } catch {
          return;
        }
        if (!isRecord(message)) return;
        agent.received.push(message);
        void handle(message);
      },
      async stop() {
        agent.stopped = true;
        end(null);
      },
    },
    received: [],
    answers: [],
    session: "sess-1",
    cancels: 0,
    signedIn: false,
    running: false,
    stopped: false,
    starts: 0,
    emit(message) {
      send(message);
    },
    crash(code) {
      end(code);
    },
  };

  const send = (message: Record<string, unknown>) => {
    if (agent.running) onLine?.(JSON.stringify(message));
  };
  const end = (code: number | null) => {
    if (!agent.running) return;
    agent.running = false;
    for (const entry of waiting.values()) entry.resolve();
    waiting.clear();
    for (const wake of cancelWaiters) wake();
    cancelWaiters = [];
    onExit?.(code);
  };
  const update = (body: Record<string, unknown>) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: agent.session, update: body } });
  const ask = (method: string, params: Record<string, unknown>) =>
    new Promise<void>((resolve) => {
      const id = nextId++;
      waiting.set(id, { method, resolve });
      send({ jsonrpc: "2.0", id, method, params });
    });

  async function run(steps: readonly ScriptedAcpStep[]): Promise<void> {
    for (const step of steps) {
      if (!agent.running) return;
      // A pause between steps: a real agent's messages arrive one after the other, not in one call.
      await Promise.resolve();
      if ("say" in step) update({ sessionUpdate: step.role === "thought" ? "agent_thought_chunk" : step.role === "user" ? "user_message_chunk" : "agent_message_chunk", content: { type: "text", text: step.say } });
      else if ("tool" in step) update({ sessionUpdate: "tool_call", ...step.tool });
      else if ("toolUpdate" in step) update({ sessionUpdate: "tool_call_update", ...step.toolUpdate });
      else if ("plan" in step) update({ sessionUpdate: "plan", entries: step.plan });
      else if ("ask" in step) await ask("session/request_permission", { sessionId: agent.session, toolCall: step.ask.toolCall, options: step.ask.options });
      else if ("read" in step) await ask("fs/read_text_file", { sessionId: agent.session, ...step.read });
      else if ("write" in step) await ask("fs/write_text_file", { sessionId: agent.session, ...step.write });
      else if ("request" in step) await ask(step.request.method, step.request.params);
      else if ("notify" in step) send({ jsonrpc: "2.0", method: step.notify.method, params: step.notify.params });
      else if ("raw" in step) {
        if (agent.running) onLine?.(step.raw);
      } else if ("wait" in step) {
        if (agent.cancels === 0) await new Promise<void>((resolve) => cancelWaiters.push(resolve));
      } else if ("exit" in step) {
        end(step.exit);
        return;
      }
    }
  }

  async function handle(message: Record<string, unknown>): Promise<void> {
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : null;
    if (method === null) {
      // An answer to one of the agent's own requests.
      if (typeof id !== "number") return;
      const asked = waiting.get(id);
      if (!asked) return;
      waiting.delete(id);
      const error = isRecord(message.error) ? { code: Number(message.error.code), message: String(message.error.message) } : undefined;
      agent.answers.push({ method: asked.method, ...(error ? { error } : { result: isRecord(message.result) ? message.result : {} }) });
      asked.resolve();
      return;
    }
    const reply = (result: Record<string, unknown>) => send({ jsonrpc: "2.0", id, result });
    const refuse = (code: number, text: string) => send({ jsonrpc: "2.0", id, error: { code, message: text } });
    switch (method) {
      case "initialize":
        reply({
          protocolVersion: options.version === undefined ? 1 : options.version,
          agentCapabilities: { loadSession: false, promptCapabilities: { image: false, audio: false, embeddedContext: true } },
          ...(options.info === null ? {} : { agentInfo: options.info ?? { name: "scripted-agent", title: "Scripted Agent", version: "1.0.0" } }),
          authMethods: options.authMethods ?? [],
        });
        return;
      case "authenticate":
        agent.signedIn = true;
        reply({});
        return;
      case "session/new":
        if (options.hangsOnSession) return;
        if (options.needsAuth && !agent.signedIn) {
          refuse(-32000, "Authentication required");
          return;
        }
        reply({ sessionId: agent.session, ...options.sessionExtras });
        return;
      case "session/prompt": {
        const steps = options.turns?.[turn] ?? [{ say: "Done." }];
        turn++;
        const before = agent.cancels;
        await run(steps);
        if (!agent.running) return;
        if (agent.cancels > before && options.ignoresCancel) return;
        reply({ stopReason: agent.cancels > before ? "cancelled" : "end_turn" });
        return;
      }
      case "session/cancel":
        agent.cancels++;
        for (const wake of cancelWaiters) wake();
        cancelWaiters = [];
        return;
      default:
        if (id !== undefined) refuse(-32601, "Method not found");
    }
  }

  return agent;
}
