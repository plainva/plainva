import type { HttpRequestSpec, ProviderEndpoint, ModelRequest } from "./providers.js";
import { buildRequest } from "./providers.js";
import { createSseParser, createStreamDecoder, type StreamEvent, type StopReason } from "./streams.js";
import { parseRetryAfterMs } from "../sync/httpRetry.js";

/**
 * The shells' native AI egress, as the core sees it (ADR 0017): the desktop
 * implements it with the Rust commands `ai_http` / `ai_http_cancel`, the phone
 * with the `AiNet` plugin. Keys go in, never out.
 */

export type EgressChunk =
  | { type: "open"; status: number }
  | { type: "data"; text: string }
  /** `retryAfter` is the provider's Retry-After header, when it sent one. */
  | { type: "httpError"; status: number; body: string; retryAfter?: string | null }
  | { type: "failed"; code: string; message: string }
  | { type: "done" }
  | { type: "cancelled" };

/**
 * The texts of the native confirmation for a new server, in the app's
 * language. The shells add the address themselves, below the message, so
 * the dialog always shows where requests will go.
 */
export interface EndpointConfirmText {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
}

export interface AiEgress {
  /** Sends the request; chunks arrive in order; resolves after the last one. */
  send(requestId: string, spec: HttpRequestSpec, onChunk: (chunk: EgressChunk) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
  /** Write-only: there is no way to read a key back. */
  setKey(endpointId: string, key: string): Promise<void>;
  hasKey(endpointId: string): Promise<boolean>;
  deleteKey(endpointId: string): Promise<void>;
  /**
   * Adds a recipient the user typed in. The shell confirms it NATIVELY — the
   * web view cannot widen the allowlist on its own. False when declined.
   */
  addEndpoint(endpointId: string, baseUrl: string): Promise<boolean>;
  removeEndpoint(endpointId: string): Promise<void>;
}

/** Why a model call failed, in terms the UI can act on (§11.4). */
export type ModelFailure =
  | { kind: "no_key" }
  | { kind: "invalid_key"; status: number }
  | { kind: "rate_limited"; status: number; retryAfterSeconds?: number }
  | { kind: "overloaded"; status: number }
  | { kind: "context_too_long"; status: number }
  | { kind: "not_found"; status: number; message: string }
  | { kind: "refused_by_provider"; status: number; message: string }
  | { kind: "unknown_endpoint"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "stream_broken"; message: string }
  | { kind: "provider_error"; message: string; code?: string }
  /**
   * The system's model is not there (plan P2c): the device is not eligible,
   * Apple Intelligence is off, the model is still loading or can be loaded,
   * the app is in the background — `reason` names which, for the settings to say.
   */
  | { kind: "platform_unavailable"; reason: string };

export interface ModelCallResult {
  stop: StopReason | "cancelled" | null;
  failure?: ModelFailure;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

/** A provider's error body, shortened to its message where it has one. */
export function providerErrorMessage(body: string): string {
  const text = body.slice(0, 2000);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const inner = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    if (typeof inner === "string" && inner.trim()) return inner.trim().slice(0, 500);
  } catch {
    // not JSON: the text itself
  }
  return text.trim().slice(0, 500);
}

export function failureFromHttp(status: number, body: string, retryAfter?: string | null): ModelFailure {
  const message = providerErrorMessage(body);
  if (status === 401 || status === 403) return { kind: "invalid_key", status };
  if (status === 429) {
    const waitMs = parseRetryAfterMs(retryAfter ?? null);
    return waitMs === null ? { kind: "rate_limited", status } : { kind: "rate_limited", status, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }
  if (status === 529 || status === 503) return { kind: "overloaded", status };
  if (status === 404) return { kind: "not_found", status, message };
  if (status === 413 || /context|too long|maximum.*tokens|token limit/i.test(message)) return { kind: "context_too_long", status };
  return { kind: "refused_by_provider", status, message };
}

export function failureFromChunk(code: string, message: string): ModelFailure {
  switch (code) {
    case "no_key":
      return { kind: "no_key" };
    case "unknown_endpoint":
    case "url_not_allowed":
      return { kind: "unknown_endpoint", message };
    case "idle_timeout":
      return { kind: "stream_broken", message };
    // The platform plugins' own codes (plan P2c): no HTTP status, the same meanings.
    case "platform_unavailable":
      return { kind: "platform_unavailable", reason: message };
    case "context_too_long":
      return { kind: "context_too_long", status: 0 };
    case "rate_limited":
      return { kind: "rate_limited", status: 0 };
    case "overloaded":
      return { kind: "overloaded", status: 0 };
    case "platform_refused":
      return { kind: "refused_by_provider", status: 0, message };
    case "platform_error":
      return { kind: "provider_error", message };
    default:
      return { kind: "offline", message };
  }
}

/**
 * One model call: build the request, stream it through the egress, decode the
 * provider's events into Plainva's. `onEvent` sees every text delta, complete
 * tool call and reasoning part in order; the result says how it ended.
 */
export async function runModelCall(
  egress: AiEgress,
  endpoint: ProviderEndpoint,
  request: ModelRequest,
  onEvent: (event: StreamEvent) => void,
  options: { requestId: string; signal?: AbortSignal },
): Promise<ModelCallResult> {
  const spec = buildRequest(endpoint, request);
  const parser = createSseParser();
  const decoder = createStreamDecoder(endpoint.api);
  const result: ModelCallResult = { stop: null, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const handle = (event: StreamEvent) => {
    if (event.type === "usage") {
      result.usage.inputTokens = event.inputTokens ?? result.usage.inputTokens;
      result.usage.outputTokens = event.outputTokens ?? result.usage.outputTokens;
      result.usage.cacheReadTokens = event.cacheReadTokens ?? result.usage.cacheReadTokens;
      result.usage.cacheWriteTokens = event.cacheWriteTokens ?? result.usage.cacheWriteTokens;
    } else if (event.type === "stop") {
      result.stop = event.reason;
    } else if (event.type === "error") {
      result.failure = { kind: "provider_error", message: event.message, code: event.code };
    }
    onEvent(event);
  };
  if (options.signal?.aborted) return { ...result, stop: "cancelled" };
  const abort = () => void egress.cancel(options.requestId);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await egress.send(options.requestId, spec, (chunk) => {
      switch (chunk.type) {
        case "data":
          for (const message of parser.push(chunk.text)) for (const event of decoder.push(message)) handle(event);
          return;
        case "done":
          for (const message of parser.finish()) for (const event of decoder.push(message)) handle(event);
          return;
        case "httpError":
          result.failure = failureFromHttp(chunk.status, chunk.body, chunk.retryAfter);
          return;
        case "failed":
          result.failure = failureFromChunk(chunk.code, chunk.message);
          return;
        case "cancelled":
          result.stop = "cancelled";
          return;
        case "open":
          return;
      }
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  return result;
}

/**
 * A request whose answer is one JSON document (the model list of the
 * connection test). The egress still delivers it in chunks; they are joined.
 */
export async function fetchProviderJson(
  egress: AiEgress,
  spec: HttpRequestSpec,
  requestId: string,
): Promise<{ ok: true; json: unknown } | { ok: false; failure: ModelFailure }> {
  let text = "";
  let failure: ModelFailure | undefined;
  await egress.send(requestId, spec, (chunk) => {
    if (chunk.type === "data") text += chunk.text;
    else if (chunk.type === "httpError") failure = failureFromHttp(chunk.status, chunk.body, chunk.retryAfter);
    else if (chunk.type === "failed") failure = failureFromChunk(chunk.code, chunk.message);
    else if (chunk.type === "cancelled") failure = { kind: "offline", message: "cancelled" };
  });
  if (failure) return { ok: false, failure };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, failure: { kind: "provider_error", message: "the answer was not JSON" } };
  }
}
