import { toBase64 } from "../crypto/cryptoPrimitives.js";
import type { HttpRequestSpec, ProviderEndpoint } from "./providers.js";
import { EMPTY_USAGE, type ConversationUsage } from "./history.js";

/**
 * Transcribing a voice note (plan KI-Harness P1.5, §10.7, E28): the recording
 * goes to a provider with an audio route in its own format — WebM/Opus or
 * M4A, as the recorder wrote it, nothing converted. OpenAI and servers that
 * speak its protocol have a transcription endpoint (multipart, the file as
 * it is); Gemini hears audio as part of a model request. Everything else has
 * no route: a hint, not a lock — a custom server that offers the endpoint is
 * reached the OpenAI way.
 */

export type TranscriptionRoute = "openai-transcriptions" | "gemini-inline";

/** Built-in endpoints known to have no audio route. */
const NO_AUDIO_ROUTE: ReadonlySet<string> = new Set(["anthropic", "openrouter", "ollama", "lmstudio"]);

export function transcriptionRoute(endpoint: ProviderEndpoint): TranscriptionRoute | null {
  if (NO_AUDIO_ROUTE.has(endpoint.id)) return null;
  if (endpoint.api === "gemini") return "gemini-inline";
  if (endpoint.api === "openai-responses" || endpoint.api === "openai-chat") return "openai-transcriptions";
  return null;
}

/**
 * The largest recording the egress carries: its request limit is 16 MB, and
 * Gemini gets the file as base64 (a third larger) inside JSON.
 */
export const TRANSCRIPTION_MAX_BYTES = 11 * 1024 * 1024;

export interface AudioFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** What the model is told with the audio (Gemini); the OpenAI endpoint transcribes by itself. */
export const TRANSCRIBE_INSTRUCTION =
  "Transcribe this voice note verbatim, in the language it is spoken in. Answer with the transcript only: no introduction, no quotation marks, no timestamps.";

const encoder = new TextEncoder();

/** A header value that cannot end the header: quotes and line breaks removed. */
function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}

/** multipart/form-data, as RFC 7578 has it: text fields, then the one file. */
export function multipartBody(boundary: string, fields: Record<string, string>, file: { field: string; name: string; mime: string; bytes: Uint8Array }): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${headerSafe(name)}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${headerSafe(file.field)}"; filename="${headerSafe(file.name)}"\r\nContent-Type: ${headerSafe(file.mime)}\r\n\r\n`,
    ),
  );
  parts.push(file.bytes);
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A boundary that cannot occur in the parts it separates by chance. */
export function newBoundary(random: () => number = Math.random): string {
  let tail = "";
  for (let i = 0; i < 24; i++) tail += Math.floor(random() * 36).toString(36);
  return `----plainva${tail}`;
}

/** The request for one recording on one route. */
export function transcriptionRequest(endpoint: ProviderEndpoint, route: TranscriptionRoute, model: string, audio: AudioFile, boundary = newBoundary()): HttpRequestSpec {
  if (route === "gemini-inline") {
    return {
      endpointId: endpoint.id,
      url: `${endpoint.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: {
        contents: [{ role: "user", parts: [{ text: TRANSCRIBE_INSTRUCTION }, { inlineData: { mimeType: audio.mime, data: toBase64(audio.bytes) } }] }],
      },
      auth: endpoint.needsKey ? { header: "x-goog-api-key" } : null,
      stream: false,
    };
  }
  const body = multipartBody(boundary, { model, response_format: "json" }, { field: "file", name: audio.name, mime: audio.mime, bytes: audio.bytes });
  return {
    endpointId: endpoint.id,
    url: `${endpoint.baseUrl}/audio/transcriptions`,
    method: "POST",
    headers: {},
    rawBody: { base64: toBase64(body), contentType: `multipart/form-data; boundary=${boundary}` },
    auth: endpoint.needsKey ? { header: "authorization", scheme: "Bearer" } : null,
    stream: false,
  };
}

/** The transcript in a provider's answer; null when there is none. */
export function transcriptOf(route: TranscriptionRoute, json: unknown): string | null {
  const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
  if (route === "openai-transcriptions") {
    const text = record(json)?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  }
  const candidates = record(json)?.candidates;
  const first = Array.isArray(candidates) ? record(candidates[0]) : null;
  const parts = record(first?.content)?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part) => record(part)?.text)
    .filter((t): t is string => typeof t === "string")
    .join("")
    .trim();
  return text || null;
}

/**
 * The transcript as it goes under the recording: a quotation, line by line,
 * after a blank line — Markdown any editor renders and nothing else reads as
 * structure.
 */
export function transcriptBlock(transcript: string): string {
  const lines = transcript
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  return `\n\n${lines.map((line) => (line ? `> ${line}` : ">")).join("\n")}\n`;
}

/** What the provider counted, where it says so (OpenAI's transcription models, Gemini); nothing otherwise. */
export function transcriptionUsage(json: unknown): ConversationUsage {
  const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
  const openai = record(record(json)?.usage);
  const gemini = record(record(json)?.usageMetadata);
  return {
    ...EMPTY_USAGE,
    inputTokens: count(openai?.input_tokens ?? gemini?.promptTokenCount),
    outputTokens: count(openai?.output_tokens ?? gemini?.candidatesTokenCount),
  };
}
