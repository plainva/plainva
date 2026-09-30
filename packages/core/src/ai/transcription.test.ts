import { describe, expect, it } from "vitest";
import { BUILTIN_ENDPOINTS, type ProviderEndpoint } from "./providers.js";
import { parseModelList } from "./models.js";
import { AI_AUDIO_PROFILE, readAiAppSettings } from "./registry.js";
import {
  multipartBody,
  newBoundary,
  TRANSCRIBE_INSTRUCTION,
  transcriptBlock,
  transcriptionRequest,
  transcriptionRoute,
  transcriptionUsage,
  transcriptOf,
} from "./transcription.js";

const endpoint = (id: string): ProviderEndpoint => BUILTIN_ENDPOINTS.find((e) => e.id === id)!;
const decode = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
const audio = { name: "Voice 2026-09-24 0812.m4a", mime: "audio/mp4", bytes: new Uint8Array([0, 1, 2, 255]) };

/** Plan KI-Harness P1.5 (§10.7, E28): a voice note becomes a transcript, in its own format. */
describe("transcribing a recording", () => {
  it("knows which providers have an audio route — a hint, and a custom server is tried the OpenAI way", () => {
    expect(transcriptionRoute(endpoint("openai"))).toBe("openai-transcriptions");
    expect(transcriptionRoute(endpoint("gemini"))).toBe("gemini-inline");
    for (const id of ["anthropic", "openrouter", "ollama", "lmstudio"]) expect(transcriptionRoute(endpoint(id))).toBeNull();
    const custom: ProviderEndpoint = { id: "custom-whisper", api: "openai-chat", baseUrl: "http://localhost:8000/v1", needsKey: false };
    expect(transcriptionRoute(custom)).toBe("openai-transcriptions");
  });

  it("sends the file as it is, as multipart form data, to the transcription endpoint", () => {
    const spec = transcriptionRequest(endpoint("openai"), "openai-transcriptions", "gpt-4o-transcribe", audio, "----plainvaTEST");
    expect(spec.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(spec.body).toBeUndefined();
    expect(spec.auth).toEqual({ header: "authorization", scheme: "Bearer" });
    expect(spec.rawBody!.contentType).toBe("multipart/form-data; boundary=----plainvaTEST");
    const text = decode(spec.rawBody!.base64);
    expect(text).toContain('Content-Disposition: form-data; name="model"\r\n\r\ngpt-4o-transcribe\r\n');
    expect(text).toContain('Content-Disposition: form-data; name="response_format"\r\n\r\njson\r\n');
    expect(text).toContain('Content-Disposition: form-data; name="file"; filename="Voice 2026-09-24 0812.m4a"\r\nContent-Type: audio/mp4\r\n\r\n');
    expect(text.endsWith("\r\n------plainvaTEST--\r\n")).toBe(true);
  });

  it("carries the recording's bytes unchanged, and a file name cannot break its header", () => {
    const body = multipartBody("b", {}, { field: "file", name: 'x"\r\nevil.m4a', mime: "audio/mp4", bytes: new Uint8Array([7, 0, 200]) });
    const text = new TextDecoder("latin1").decode(body);
    expect(text).toContain('filename="x___evil.m4a"');
    const start = text.indexOf("\r\n\r\n") + 4;
    expect([...body.slice(start, start + 3)]).toEqual([7, 0, 200]);
    expect(newBoundary(() => 0.5)).toMatch(/^----plainva[0-9a-z]{24}$/);
  });

  it("gives Gemini the audio inline, with the instruction, as one request that does not stream", () => {
    const spec = transcriptionRequest(endpoint("gemini"), "gemini-inline", "gemini-2.5-flash", audio);
    expect(spec.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(spec.stream).toBe(false);
    expect(spec.rawBody).toBeUndefined();
    expect(spec.body).toEqual({
      contents: [{ role: "user", parts: [{ text: TRANSCRIBE_INSTRUCTION }, { inlineData: { mimeType: "audio/mp4", data: "AAEC/w==" } }] }],
    });
  });

  it("reads the transcript and what was counted from either answer", () => {
    expect(transcriptOf("openai-transcriptions", { text: "  Call Tom.  ", usage: { input_tokens: 40, output_tokens: 5 } })).toBe("Call Tom.");
    expect(transcriptOf("openai-transcriptions", { text: "" })).toBeNull();
    expect(transcriptOf("gemini-inline", { candidates: [{ content: { parts: [{ text: "Call " }, { text: "Tom." }] } }] })).toBe("Call Tom.");
    expect(transcriptOf("gemini-inline", { candidates: [] })).toBeNull();
    expect(transcriptionUsage({ usage: { input_tokens: 40, output_tokens: 5 } })).toMatchObject({ inputTokens: 40, outputTokens: 5 });
    expect(transcriptionUsage({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } })).toMatchObject({ inputTokens: 12, outputTokens: 3 });
    expect(transcriptionUsage("nothing")).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it("puts the transcript under the recording as a quotation, line by line", () => {
    expect(transcriptBlock("First line.\r\n\r\nSecond line.  ")).toBe("\n\n> First line.\n>\n> Second line.\n");
  });

  it("keeps the profile Audio beside the chat profiles, and marks the models that transcribe", () => {
    const settings = readAiAppSettings({ profiles: { audio: { providerId: "openai", model: " gpt-4o-transcribe " }, balanced: { providerId: "anthropic", model: "m" } }, defaultProfile: "audio" });
    expect(settings.profiles[AI_AUDIO_PROFILE]).toEqual({ providerId: "openai", model: "gpt-4o-transcribe" });
    // Never the default for a conversation.
    expect(settings.defaultProfile).toBe("balanced");
    const list = parseModelList(endpoint("openai"), { data: [{ id: "gpt-4o-transcribe" }, { id: "whisper-1" }, { id: "gpt-5" }] });
    expect(list.filter((m) => m.transcribe).map((m) => m.id)).toEqual(["gpt-4o-transcribe", "whisper-1"]);
    expect(list.filter((m) => m.chat).map((m) => m.id)).toEqual(["gpt-5"]);
  });
});
