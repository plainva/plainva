import { appendTurn, type Conversation, type Part, type ToolCallPart, type ToolResultPart } from "./conversation.js";
import { runModelCall, type AiEgress, type ModelCallResult, type ModelFailure } from "./egress.js";
import { retryDelayMs } from "../sync/httpRetry.js";
import type { ProviderEndpoint } from "./providers.js";
import { ruleOfTwo, runTraits, type RunContextTraits } from "./ruleOfTwo.js";
import type { StreamEvent } from "./streams.js";
import { parseToolInput, toolByName, type ToolManifest } from "./tools.js";
import { fenceUntrusted, payload, type PayloadOrigin } from "./trust.js";

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
 */

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Where the content came from; tier 3 results are fenced as data. */
  origin?: PayloadOrigin;
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
  /** Asked before an effect tool runs when the Rule of Two demands it. */
  approveEffect?: (call: ToolCallPart, tool: ToolManifest) => Promise<boolean>;
  newRequestId?: () => string;
  now?: () => string;
  /** Mark the stable prefix for provider-side prompt caching. */
  cache?: boolean;
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

const EFFECT_RISKS = new Set(["write", "critical", "external", "script"]);

function notRun(call: ToolCallPart, why: string): ToolResultPart {
  return { type: "tool_result", callId: call.id, name: call.name, content: `Not run: ${why}.`, isError: true };
}

export async function runAgent(input: RunInput): Promise<RunResult> {
  const limits = input.limits ?? DEFAULT_RUN_LIMITS;
  const now = input.now ?? (() => new Date().toISOString());
  const newId = input.newRequestId ?? (() => `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const tools = input.conversation.tools.map((name) => toolByName(name)).filter((t): t is ToolManifest => Boolean(t));
  const verdict = ruleOfTwo(runTraits(tools, input.context));
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
          conversation,
          tools,
          maxOutputTokens: Math.max(256, limits.maxOutputTokens - usage.outputTokens),
          cache: input.cache,
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

      input.onEvent?.({ type: "tool_start", call });
      const started = Date.now();
      const tool = tools.find((t) => t.name === call.name);
      let outcome: ToolOutcome;
      if (!tool) {
        outcome = { content: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}.`, isError: true };
      } else {
        const parsed = parseToolInput(tool, call.args);
        if (!parsed.ok) {
          outcome = { content: `Invalid arguments: ${parsed.error}`, isError: true };
        } else if (EFFECT_RISKS.has(tool.risk) && verdict.approvalPerEffect && !(await input.approveEffect?.(call, tool))) {
          outcome = { content: "The user did not approve this action.", isError: true };
        } else {
          try {
            outcome = await input.executor.execute(tool, parsed.value, call, input.signal);
          } catch (error) {
            outcome = { content: `The tool failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
          }
        }
      }
      failuresInRow = outcome.isError ? failuresInRow + 1 : 0;
      input.onEvent?.({ type: "tool_done", call, outcome, ms: Date.now() - started });
      const content = outcome.origin && !outcome.isError ? fenceUntrusted(payload(outcome.content, outcome.origin)) : outcome.content;
      results.push({ type: "tool_result", callId: call.id, name: call.name, content, ...(outcome.isError ? { isError: true } : {}) });
      if (failuresInRow >= 3) {
        answerAll(calls, results, "three tools in a row failed");
        return { conversation, stop: { kind: "circuit_breaker", tool: call.name }, usage };
      }
    }
    answerAll(calls, results, "");
  }
}
