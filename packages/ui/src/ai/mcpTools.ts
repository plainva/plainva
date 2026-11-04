import {
  EFFECT_DECLINED,
  asMcpError,
  mcpCallDecision,
  mcpElicitOutcome,
  mcpElicitReply,
  mcpFailureText,
  mcpIssuesOf,
  mcpOfferedTools,
  mcpQuestionsOff,
  mcpResultView,
  mcpServerStanding,
  type McpCallRefusal,
  type McpQuestions,
  type McpServerState,
  type McpToolEffect,
  type RunMcp,
  type RunMcpQuestions,
  type ToolExecutor,
  type ToolOutcome,
} from "@plainva/core";
import type { McpCheck } from "./mcpRuntime";
import type { McpAuditOutcome } from "./mcpStores";

/**
 * The tools of foreign MCP servers in a conversation (plan KI-Harness P4.5):
 * one implementation for both shells. The request itself is the shell's
 * native code; everything that decides whether there is one is here, in the
 * order of trust:
 *
 * 1. the server as it stands NOW — registered, approved, switched on in this
 *    vault — and the tool as the user granted it;
 * 2. the server's listing, loaded again unless it is still fresh, against the
 *    approved one: a difference blocks the server, and the call does not go;
 * 3. what the conversation has read from the vault: all of it must lie in
 *    folders the user allowed for this server, and none of it may be kept
 *    from the cloud — a foreign server is a cloud recipient, wherever it runs;
 * 4. the user, who sees the server, the tool and the arguments in full.
 *
 * What comes back is a stranger's text: one bounded piece of data, fenced.
 */

/** One call a server may ask the user something during (plan KI-Harness P9-4a): what Plainva's card names it by. */
export interface McpQuestionSource {
  callId: string;
  serverId: string;
  serverLabel: string;
  tool: string;
  title: string;
}

/** The arguments of one call, as JSON; larger is no question a person could read. */
export const MCP_ARGUMENTS_LIMIT = 32_000;

export interface McpCallQuestion {
  /** The id of the model's call: the question stands for that step until it is answered. */
  callId: string;
  serverId: string;
  serverLabel: string;
  /** The server's own name of the tool, and its title for a person. */
  tool: string;
  title: string;
  args: Record<string, unknown>;
  /** What the call can do at the service, as the approved listing says it: the question's words follow it. */
  effect: McpToolEffect;
}

export interface McpToolsHost {
  /** The servers of this vault as they stand now. */
  servers(): Promise<McpServerState[]>;
  /** Loads a server's listing again unless it is fresh, and compares it with the approved one. */
  check(serverId: string, signal?: AbortSignal): Promise<McpCheck>;
  /** The notes this conversation has read so far, by path; `more` when it read notes that are not kept by path. */
  carried(): Promise<{ paths: readonly string[]; more: boolean }>;
  /** Whether one of these notes must not reach this server — a cloud recipient. A rule that cannot be read counts as "must not". */
  keptFromCloud(serverId: string, paths: readonly string[]): Promise<boolean>;
  /**
   * The conversation carries something a rule keeps from every cloud that no
   * path names (plan P6): an entry of the vault's memory, given to a model on
   * this device. Absent where the caller has no such thing to carry.
   */
  keptByRule?(): boolean;
  /** Shows the call and waits for the user. False when declined, or when nobody is there to ask. */
  ask(question: McpCallQuestion, signal?: AbortSignal): Promise<boolean>;
  call(serverId: string, tool: string, args: Record<string, unknown>, inputSchema: unknown, signal?: AbortSignal, questions?: McpQuestions): Promise<Record<string, unknown>>;
  /**
   * Where the user can be asked what a server asks during a call (plan
   * P9-4a): Plainva's card, one question at a time. Used only for a server
   * the vault lets ask; absent where nobody can be asked, and then no server
   * is offered to.
   */
  questions?(source: McpQuestionSource): McpQuestions;
  /** One line for the vault's log of calls: who, what, how it ended, how much — never what was said. */
  log(entry: { server: string; tool: string; outcome: McpAuditOutcome; sent: number; received: number }): void;
}

/** What a run did with foreign servers, gathered while it runs: names and outcomes — never content. */
export const newRunMcp = (): RunMcp => ({ calls: [] });

export const MCP_BLOCKED =
  "Plainva stopped using this service: what it says about its tools changed after the user approved it. Do not try again. Tell the user that the service has to be looked at again in the settings.";
const MCP_GONE = "This service is not available in this vault. Answer without it.";
const MCP_KEPT = "This conversation carries something that must not leave this device — a note, or an entry of the memory —, so nothing is sent to a service from here. Answer without it, and say so.";
const MCP_UNKNOWN =
  "This conversation has read more notes than can be checked one by one, so nothing is sent to a service from here. Answer without it, and tell the user that a new conversation can use the service.";

const REFUSAL: Record<McpCallRefusal, string> = {
  "server-new": "The user has not approved this service on this device. Answer without it.",
  "server-blocked": MCP_BLOCKED,
  "tool-withheld": "This tool cannot be offered under its name. Answer without it.",
  "tool-not-granted": "The user has not allowed this tool. Answer without it.",
  "path-outside-grant":
    "This service may not be given what this conversation has read from the vault. The user can allow folders for it in the settings. Until then, answer without it and say so.",
};

export function createMcpExecutor(inner: ToolExecutor, host: McpToolsHost, log: RunMcp): ToolExecutor {
  return {
    async execute(tool, args, call, signal) {
      const foreign = tool.foreign;
      if (!foreign) return inner.execute(tool, args, call, signal);
      const input = (args ?? {}) as Record<string, unknown>;
      const sent = JSON.stringify(input).length;
      // How the server's questions to the user went, if it asked any: numbers only.
      const asked: RunMcpQuestions = { answered: 0, declined: 0, cancelled: 0, refused: 0 };
      const done = (outcome: McpAuditOutcome, received: number, result: ToolOutcome): ToolOutcome => {
        const questions = asked.answered + asked.declined + asked.cancelled + asked.refused > 0 ? { questions: { ...asked } } : {};
        log.calls.push({ server: foreign.server, tool: foreign.tool, outcome, ...questions });
        host.log({ server: foreign.server, tool: foreign.tool, outcome, sent, received });
        return result;
      };
      const refuse = (text: string) => done("refused", 0, { content: text, isError: true });

      // 1. The server and the tool as they stand now — not as they stood when the conversation began.
      const servers = await host.servers();
      const server = servers.find((s) => s.id === foreign.server);
      if (!server) return refuse(MCP_GONE);
      const standing = mcpServerStanding(server);
      if (standing === "blocked") return done("blocked", 0, { content: MCP_BLOCKED, isError: true });
      if (standing !== "ready") return refuse(standing === "new" ? REFUSAL["server-new"] : MCP_GONE);
      const offered = mcpOfferedTools(servers).find((t) => t.exposed === tool.name);
      if (!offered) return refuse(REFUSAL["tool-not-granted"]);
      if (sent > MCP_ARGUMENTS_LIMIT) return refuse("The arguments are too large for one call. Send less.");

      // 2. The listing again, against the approved one.
      const check = await host.check(server.id, signal);
      if (!check.ok) {
        if (check.reason === "blocked") return done("blocked", 0, { content: MCP_BLOCKED, isError: true });
        if (check.reason === "failed") return done("failed", 0, { content: `${mcpFailureText(check.failure)} The call was not made.`, isError: true });
        return refuse(REFUSAL["server-new"]);
      }

      // 3. What the conversation carries.
      const carried = await host.carried();
      const decision = mcpCallDecision({
        serverId: server.id,
        review: server.review,
        grant: server.grant,
        tool: offered.descriptor,
        issues: mcpIssuesOf(servers),
        vaultPaths: carried.paths,
      });
      if (!decision.allowed) return refuse(REFUSAL[decision.reason]);
      // Notes that were read but are not kept by path could lie anywhere and carry any rule: nothing is assumed of them.
      if (carried.more) return refuse(MCP_UNKNOWN);
      if (host.keptByRule?.()) return refuse(MCP_KEPT);
      if (carried.paths.length > 0 && (await host.keptFromCloud(server.id, carried.paths))) return refuse(MCP_KEPT);

      // 4. The user — asked in the words of what the call can do there (plan P5-6): reading, changing, or destroying.
      const question: McpCallQuestion = { callId: call.id, serverId: server.id, serverLabel: server.label, tool: offered.name, title: offered.title, args: input, effect: offered.effect };
      if (!(await host.ask(question, signal))) return done("declined", 0, { content: EFFECT_DECLINED, isError: true, declined: true });

      // 5. Questions on the way (plan P9-4a): only where this vault lets the server ask, and only through Plainva's card.
      const asking = server.grant.questions && host.questions ? host.questions({ callId: call.id, serverId: server.id, serverLabel: server.label, tool: offered.name, title: offered.title }) : undefined;
      const questions: McpQuestions | undefined = asking && {
        modes: asking.modes,
        ask: async (question, waiting) => {
          const answer = await asking.ask(question, waiting);
          asked[mcpElicitOutcome(question, mcpElicitReply(question, answer))]++;
          return answer;
        },
      };

      let result: Record<string, unknown>;
      try {
        result = await host.call(server.id, offered.name, input, offered.descriptor.inputSchema, signal, questions);
      } catch (error) {
        const failure = asMcpError(error).failure;
        // A server that wanted to ask the user and may not: the model learns where the user can allow it.
        if (mcpQuestionsOff(failure)) {
          return done("questions-off", 0, { content: mcpFailureText(failure), isError: true });
        }
        // A server's own error text is a stranger's words: behind the app's sentence, and in the fence with it.
        if (failure.kind === "rpc" && failure.message) {
          return done("failed", failure.message.length, { content: `${mcpFailureText(failure)}\n${failure.message}`, isError: true, origin: { kind: "tool", tool: offered.name, server: server.id } });
        }
        return done("failed", 0, { content: mcpFailureText(failure), isError: true });
      }
      const view = mcpResultView(server.id, offered.name, result);
      const left = view.dropped.images + view.dropped.audio + view.dropped.other;
      const leftOut = left === 1 ? "[One part of the result that is no text was left out.]" : `[${left} parts of the result that are no text were left out.]`;
      const notes = [...(view.truncated ? ["[The result was longer; this is its beginning.]"] : []), ...(left > 0 ? [leftOut] : [])];
      const text = view.payload.data || "(The tool returned no text.)";
      return done(view.isError ? "tool-error" : "answered", view.payload.data.length, {
        content: notes.length ? `${text}\n\n${notes.join("\n")}` : text,
        origin: view.payload.origin,
        ...(view.isError ? { isError: true } : {}),
      });
    },
  };
}
