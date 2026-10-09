import { appendTurn, withoutTools, type Conversation, type Part, type ToolCallPart, type ToolResultPart } from "./conversation.js";
import { runModelCall, type AiEgress, type ModelCallResult, type ModelFailure } from "./egress.js";
import { retryDelayMs } from "../sync/httpRetry.js";
import type { ProviderEndpoint } from "./providers.js";
import { isEffectTool, ruleOfTwo, runTraits, type RunContextTraits } from "./ruleOfTwo.js";
import type { StreamEvent } from "./streams.js";
import { DISPATCH_TOOL, dispatchedArgs, FIND_TOOL, META_TOOL_NAMES, parseToolInput, toolByName, type ToolManifest } from "./tools.js";
import { fenceUntrusted, payload, type PayloadOrigin } from "./trust.js";
import { fitsWindow } from "./window.js";

/**
 * The orchestrator (§20): model call → tool calls → results → model call …
 * until the model answers, a guard stops the run, or the user presses STOP.
 *
 * Guards (ADR 0019): limits for steps, tool calls and output tokens with a
 * warning at 80 %; a loop guard for the same call repeated; a circuit breaker
 * after three failing tools in a row; the Rule of Two decides whether each
 * outside effect needs its own approval. Every turn is appended, never edited.
 *
 * A run never ends with an unanswered tool call: whatever stops it, every
 * call of the last assistant turn gets a result ("not run: …" for those that
 * did not run), so the conversation stays valid for the next message.
 *
 * Further tools (ADR 0019): a conversation's tool list is fixed, so a tool it
 * names in `more` is called through `call_tool`. The call is resolved here,
 * before anything else looks at it — its arguments are validated against the
 * tool it names, and every rule that holds for a tool called directly (the
 * Rule of Two, a skill's narrowing, the approval of an outside effect) meets
 * that tool and not the dispatcher. The dispatcher is a spelling, never a way
 * around a rule.
 */

/**
 * Raw third-party text a tool hands over instead of showing it to the model
 * (plan §13.4, the quarantined processor): a message's body, an appointment's
 * description. A reader without tools reports on it, further out in the
 * executor chain; a chain that has no such reader drops it. It never reaches
 * a conversation and never leaves the run loop in an event.
 */
export interface QuarantinedText {
  title: string;
  text: string;
  /** Addresses the text names, each once: only these can come back in a report. */
  links: { text: string; url: string }[];
  /** What the caller wants to know of it. */
  question: string;
  origin: PayloadOrigin;
  /** The text is the beginning of something longer. */
  truncated?: boolean;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Where the content came from; tier 3 results are fenced as data. */
  origin?: PayloadOrigin;
  /**
   * The user was asked and said no — to a kind of data this session had not
   * approved yet, for instance. An answer, not a tool that failed: it does not
   * count towards the circuit breaker.
   */
  declined?: boolean;
  quarantine?: QuarantinedText;
  /**
   * The same result as values, for a caller that is a program (a script, plan
   * P5.5): built from the very pieces `content` is written from — each one
   * past the same gate —, so the two can never say different things. A model
   * never gets it; it reads `content`.
   */
  data?: unknown;
}

export interface ToolExecutor {
  execute(tool: ToolManifest, args: unknown, call: ToolCallPart, signal?: AbortSignal): Promise<ToolOutcome>;
}

export interface RunLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxOutputTokens: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = { maxSteps: 12, maxToolCalls: 24, maxOutputTokens: 32_000 };

/**
 * What the model is told when the user said no to an outside effect. A "no" is an answer, not a tool that
 * failed: it does not count towards the circuit breaker, and a transcript shows the step as not allowed.
 */
export const EFFECT_DECLINED = "The user did not approve this action.";

/**
 * A rate limit or an overloaded provider is the provider asking to come back
 * later, not a failed request: the call is tried up to three times before the
 * run fails, as the providers' own SDKs do. Never when the provider asks for
 * a longer pause than this — the user hears about it instead of watching a
 * spinner — and never once any output has arrived.
 */
export const MODEL_CALL_ATTEMPTS = 3;
export const MAX_RETRY_WAIT_MS = 20_000;

/** How long to wait before attempt `attempt + 1`, or null when not to retry. */
export function retryWaitMs(failure: ModelFailure | undefined, attempt: number, random: () => number = Math.random): number | null {
  if (!failure || (failure.kind !== "rate_limited" && failure.kind !== "overloaded") || attempt >= MODEL_CALL_ATTEMPTS) return null;
  if (failure.kind === "rate_limited" && failure.retryAfterSeconds !== undefined) {
    const asked = failure.retryAfterSeconds * 1000;
    return asked > MAX_RETRY_WAIT_MS ? null : asked;
  }
  return retryDelayMs(attempt, null, { baseDelayMs: 2000, maxDelayMs: MAX_RETRY_WAIT_MS, random });
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export type RunStop =
  | { kind: "answered" }
  | { kind: "cancelled" }
  | { kind: "failed"; failure: ModelFailure }
  | { kind: "limit"; which: keyof RunLimits }
  | { kind: "loop"; tool: string }
  | { kind: "circuit_breaker"; tool: string }
  | { kind: "max_tokens" }
  | { kind: "refusal" };

export type RunEvent =
  | { type: "model"; event: StreamEvent }
  | { type: "tool_start"; call: ToolCallPart }
  | { type: "tool_done"; call: ToolCallPart; outcome: ToolOutcome; ms: number }
  | { type: "budget_warning"; which: keyof RunLimits; used: number; limit: number }
  /** The provider asked to come back later; the same call goes out again after `waitMs`. */
  | { type: "retry"; attempt: number; waitMs: number; failure: ModelFailure }
  | { type: "turn"; conversation: Conversation };

export interface RunInput {
  conversation: Conversation;
  egress: AiEgress;
  endpoint: ProviderEndpoint;
  model: string;
  executor: ToolExecutor;
  context: RunContextTraits;
  limits?: RunLimits;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /**
   * Asked before an effect tool runs — one that changes something or whose
   * call leaves the device (a page fetched, a search) — when the Rule of Two
   * demands it. `call.args` are the validated arguments. Without this callback
   * such a call is refused: nobody was there to approve it.
   */
  approveEffect?: (call: ToolCallPart, tool: ToolManifest) => Promise<boolean>;
  /**
   * Tools of foreign MCP servers for this run (plan KI-Harness P4.5): built
   * from the listings the user approved, never part of the registry. They
   * count only where the conversation's `more` list names them, are reached
   * only through the dispatcher, and never go to a provider as tools.
   */
  foreign?: readonly ToolManifest[];
  /**
   * The vault's scripts as tools of this run (plan KI-Harness P5.5): built
   * from the scripts the user approved on this device. Like a foreign tool,
   * a script counts only under a name the conversation was started with and
   * is reached only through the dispatcher.
   */
  scripts?: readonly ToolManifest[];
  newRequestId?: () => string;
  now?: () => string;
  /** Mark the stable prefix for provider-side prompt caching. */
  cache?: boolean;
  /** The model's window, where it is small (platform models, plan P2c): the request is cut to it. */
  contextTokens?: number;
  /**
   * The model takes no tools — its user said so of a model on this device
   * (plan P7): none are sent, whatever the conversation was started with.
   */
  toolless?: boolean;
  /**
   * The window the user stated for a model on this device (plan P7): a
   * request that cannot fit it is not sent — a local server would cut it
   * without a word.
   */
  window?: number;
  /** Test seams: the pause before a retried call, and its jitter. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  steps: number;
}

export interface RunResult {
  conversation: Conversation;
  stop: RunStop;
  usage: RunUsage;
}

function notRun(call: ToolCallPart, why: string): ToolResultPart {
  return { type: "tool_result", callId: call.id, name: call.name, content: `Not run: ${why}.`, isError: true };
}

export type ResolvedCall = { tool: ToolManifest; args: unknown; dispatched: boolean } | { error: string };

/**
 * The tool a call means: one of the conversation's own, or — through
 * `call_tool` — one of its further tools. Anything else is answered with what
 * the model can do instead, never run.
 */
export function resolveToolCall(call: Pick<ToolCallPart, "name" | "args">, tools: readonly ToolManifest[], more: readonly ToolManifest[]): ResolvedCall {
  const own = tools.find((t) => t.name === call.name);
  if (!own) {
    // A further tool called by its own name: say how it is called.
    if (more.some((t) => t.name === call.name) && tools.some((t) => t.name === DISPATCH_TOOL)) {
      return { error: `${call.name} is called through ${DISPATCH_TOOL}, with its name and its arguments as ${DISPATCH_TOOL}'s arguments.` };
    }
    return { error: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}.` };
  }
  if (own.name !== DISPATCH_TOOL) return { tool: own, args: call.args, dispatched: false };
  const parsed = parseToolInput(own, call.args);
  if (!parsed.ok) return { error: `Invalid arguments: ${parsed.error}` };
  const name = (parsed.value as { name: string }).name.trim();
  // One of the conversation's own tools named here runs as well: the same tool, the same rules.
  const target = more.find((t) => t.name === name) ?? tools.find((t) => t.name === name && !META_TOOL_NAMES.includes(t.name));
  if (!target) return { error: `No tool "${name}" can be called here. ${tools.some((t) => t.name === FIND_TOOL) ? `${FIND_TOOL} lists what there is.` : `Available: ${tools.map((t) => t.name).join(", ")}.`}` };
  return { tool: target, args: dispatchedArgs(parsed.value), dispatched: true };
}

export async function runAgent(input: RunInput): Promise<RunResult> {
  const limits = input.limits ?? DEFAULT_RUN_LIMITS;
  const now = input.now ?? (() => new Date().toISOString());
  const newId = input.newRequestId ?? (() => `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const known = (names: readonly string[] | undefined) => (names ?? []).map((name) => toolByName(name)).filter((t): t is ToolManifest => Boolean(t));
  const tools = input.toolless ? [] : known(input.conversation.tools);
  // Further tools are only reachable where the dispatcher is one of the conversation's tools. A foreign tool is one of
  // them only under a name the conversation was started with, and never under the name of a tool of the app's own.
  const named = new Set(input.conversation.more ?? []);
  const foreign = (input.foreign ?? []).filter((t) => Boolean(t.foreign) && named.has(t.name) && !toolByName(t.name));
  // A script is one of them on the same terms; a foreign tool that took a script's name does not stand in for it.
  const scripts = (input.scripts ?? []).filter((t) => Boolean(t.script) && named.has(t.name) && !toolByName(t.name) && !foreign.some((f) => f.name === t.name));
  const more = tools.some((t) => t.name === DISPATCH_TOOL) ? [...known(input.conversation.more).filter((t) => !tools.includes(t)), ...foreign, ...scripts] : [];
  // What the run can reach decides its class, however a tool is spelled.
  const verdict = ruleOfTwo(runTraits([...tools, ...more], input.context));
  const usage: RunUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: 0, steps: 0 };
  const warned = new Set<keyof RunLimits>();
  const seenCalls = new Map<string, number>();
  let failuresInRow = 0;
  let conversation = input.conversation;

  const warn = (which: keyof RunLimits, used: number) => {
    if (!warned.has(which) && used >= limits[which] * 0.8) {
      warned.add(which);
      input.onEvent?.({ type: "budget_warning", which, used, limit: limits[which] });
    }
  };
  const answerAll = (calls: readonly ToolCallPart[], results: ToolResultPart[], why: string) => {
    const answered = new Set(results.map((r) => r.callId));
    const all = [...results, ...calls.filter((c) => !answered.has(c.id)).map((c) => notRun(c, why))];
    conversation = appendTurn(conversation, { role: "user", parts: all, at: now() });
    input.onEvent?.({ type: "turn", conversation });
  };

  while (true) {
    if (input.signal?.aborted) return { conversation, stop: { kind: "cancelled" }, usage };
    if (usage.steps >= limits.maxSteps) return { conversation, stop: { kind: "limit", which: "maxSteps" }, usage };
    // A model that takes no tools reads the conversation's words: what was called earlier is not sent to it again.
    const sent = input.toolless ? withoutTools(conversation) : conversation;
    if (input.window) {
      // Held against the stated window before every call: tool results grow a conversation within one run.
      const fit = fitsWindow(sent, tools, input.window);
      if (!fit.fits) return { conversation, stop: { kind: "failed", failure: { kind: "window_too_small", needed: fit.needed, window: input.window } }, usage };
    }
    usage.steps++;
    warn("maxSteps", usage.steps);

    const parts: Part[] = [];
    let text = "";
    const flushText = () => {
      if (text) parts.push({ type: "text", text });
      text = "";
    };
    let result: ModelCallResult;
    for (let attempt = 1; ; attempt++) {
      let heard = false;
      result = await runModelCall(
        input.egress,
        input.endpoint,
        {
          model: input.model,
          conversation: sent,
          tools,
          maxOutputTokens: Math.max(256, limits.maxOutputTokens - usage.outputTokens),
          cache: input.cache,
          ...(input.contextTokens ? { contextTokens: input.contextTokens } : {}),
        },
        (event) => {
          heard = true;
          if (event.type === "text") text += event.text;
          else if (event.type === "reasoning") {
            flushText();
            parts.push(event.part);
          } else if (event.type === "tool_call") {
            flushText();
            parts.push(event.call);
          }
          input.onEvent?.({ type: "model", event });
        },
        { requestId: newId(), signal: input.signal },
      ).catch((error: unknown): ModelCallResult => ({
        // The egress itself can break (the key store refuses, the bridge
        // fails): a failed call like any other, never a run that throws.
        stop: null,
        failure: { kind: "offline", message: error instanceof Error ? error.message : String(error) },
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }));
      const waitMs = heard || input.signal?.aborted ? null : retryWaitMs(result.failure, attempt, input.random);
      if (waitMs === null) break;
      input.onEvent?.({ type: "retry", attempt, waitMs, failure: result.failure! });
      await (input.sleep ?? pause)(waitMs, input.signal);
      if (input.signal?.aborted) break;
    }
    flushText();
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.cacheReadTokens += result.usage.cacheReadTokens;
    usage.cacheWriteTokens += result.usage.cacheWriteTokens;
    warn("maxOutputTokens", usage.outputTokens);

    const calls = parts.filter((p): p is ToolCallPart => p.type === "tool_call");
    if (parts.length > 0) {
      conversation = appendTurn(conversation, { role: "assistant", parts, provider: input.endpoint.id, model: input.model, at: now() });
      input.onEvent?.({ type: "turn", conversation });
    }
    const stopEarly = (stop: RunStop, why: string): RunResult => {
      if (calls.length) answerAll(calls, [], why);
      return { conversation, stop, usage };
    };
    if (result.stop === "cancelled" || input.signal?.aborted) return stopEarly({ kind: "cancelled" }, "the user stopped the run");
    if (result.failure) return stopEarly({ kind: "failed", failure: result.failure }, "the request failed");
    if (result.stop === "refusal") return stopEarly({ kind: "refusal" }, "the model refused");
    if (calls.length === 0) {
      return { conversation, stop: result.stop === "max_tokens" ? { kind: "max_tokens" } : { kind: "answered" }, usage };
    }

    const results: ToolResultPart[] = [];
    for (const call of calls) {
      if (input.signal?.aborted) {
        answerAll(calls, results, "the user stopped the run");
        return { conversation, stop: { kind: "cancelled" }, usage };
      }
      if (usage.toolCalls >= limits.maxToolCalls) {
        answerAll(calls, results, "the tool-call limit of this run is reached");
        return { conversation, stop: { kind: "limit", which: "maxToolCalls" }, usage };
      }
      const signature = `${call.name}:${JSON.stringify(call.args)}`;
      const repeats = (seenCalls.get(signature) ?? 0) + 1;
      seenCalls.set(signature, repeats);
      if (repeats >= 3) {
        answerAll(calls, results, "the same call was repeated too often");
        return { conversation, stop: { kind: "loop", tool: call.name }, usage };
      }
      usage.toolCalls++;
      warn("maxToolCalls", usage.toolCalls);

      const resolved = resolveToolCall(call, tools, more);
      // What ran, as everything outside the wire sees it: a dispatched call under the name and arguments of its tool.
      const meant: ToolCallPart = "tool" in resolved && resolved.dispatched ? { ...call, name: resolved.tool.name, args: resolved.args } : call;
      input.onEvent?.({ type: "tool_start", call: meant });
      const started = Date.now();
      let outcome: ToolOutcome;
      // A "no" from the user is an answer, not a tool that failed: it does not count towards the circuit breaker.
      let declined = false;
      if ("error" in resolved) {
        outcome = { content: resolved.error, isError: true };
      } else {
        const tool = resolved.tool;
        const parsed = parseToolInput(tool, resolved.args);
        if (!parsed.ok) {
          outcome = { content: `Invalid arguments${resolved.dispatched ? ` for ${tool.name}` : ""}: ${parsed.error}`, isError: true };
        } else if (isEffectTool(tool) && verdict.approvalPerEffect && !(await input.approveEffect?.({ ...meant, args: parsed.value }, tool))) {
          declined = true;
          outcome = { content: EFFECT_DECLINED, isError: true };
        } else {
          try {
            outcome = await input.executor.execute(tool, parsed.value, meant, input.signal);
          } catch (error) {
            outcome = { content: `The tool failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
          }
        }
      }
      // Text handed over for a reader in quarantine stays behind here, whoever did or did not read it.
      if (outcome.quarantine) {
        outcome = { ...outcome };
        delete outcome.quarantine;
      }
      if (outcome.declined) declined = true;
      if (!declined) failuresInRow = outcome.isError ? failuresInRow + 1 : 0;
      input.onEvent?.({ type: "tool_done", call: meant, outcome, ms: Date.now() - started });
      // What names an origin is fenced as data — a failure too: one that quotes a stranger (the head of a message whose text
      // no reader could report on) is still a stranger's words, and a failed tool is no way around the fence.
      const content = outcome.origin ? fenceUntrusted(payload(outcome.content, outcome.origin)) : outcome.content;
      results.push({
        type: "tool_result",
        callId: call.id,
        name: call.name,
        content,
        ...(outcome.isError ? { isError: true } : {}),
        ...(meant.name !== call.name ? { tool: meant.name } : {}),
      });
      if (failuresInRow >= 3) {
        answerAll(calls, results, "three tools in a row failed");
        return { conversation, stop: { kind: "circuit_breaker", tool: meant.name }, usage };
      }
    }
    answerAll(calls, results, "");
  }
}
