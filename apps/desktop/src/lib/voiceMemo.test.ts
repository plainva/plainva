import { describe, expect, it, vi } from "vitest";
import {
  extensionForRecording,
  pickRecordingType,
  startVoiceMemo,
  VoiceMemoError,
  voiceMemoFileName,
  type VoiceMemoPorts,
} from "@plainva/ui";

/**
 * Recording a voice memo (plan Journal-Erweiterungen, X4).
 *
 * Against a stand-in recorder, because a real microphone exists on no build
 * machine — and because the three ways a take can end badly (refused, no
 * device, broke mid-take) are exactly the ones a device never reproduces on
 * demand. What runs at a real microphone for the first time is the hardware
 * path; everything else is pinned here.
 */

/** A `MediaRecorder` that does what the interface promises and nothing else. */
class FakeRecorder {
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  state = "inactive";
  started = 0;
  stopped = 0;
  paused = 0;
  resumed = 0;

  constructor(readonly stream: MediaStream, readonly mimeType: string) {}

  start() { this.started += 1; this.state = "recording"; }
  pause() { this.paused += 1; this.state = "paused"; }
  resume() { this.resumed += 1; this.state = "recording"; }
  /** A device that is pulled mid-take never fires `onstop` - it errors instead. */
  breaks = false;

  stop() {
    this.stopped += 1;
    this.state = "inactive";
    if (this.breaks) { this.onerror?.({ error: new Error("device gone") }); return; }
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function harness(overrides: Partial<VoiceMemoPorts> = {}) {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  let recorder: FakeRecorder | null = null;
  const ports: VoiceMemoPorts = {
    getStream: async () => stream,
    isTypeSupported: (mime) => mime === "audio/webm;codecs=opus",
    createRecorder: (s, mime) => {
      recorder = new FakeRecorder(s, mime);
      return recorder as unknown as MediaRecorder;
    },
    ...overrides,
  };
  return { ports, tracks, get recorder() { return recorder; } };
}

describe("which format this platform records in", () => {
  it("prefers Opus in WebM, and falls back through what a WebView may have", () => {
    expect(pickRecordingType((m) => m === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    // Safari has only this one.
    expect(pickRecordingType((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingType(() => false)).toBeNull();
    // A WebView that throws on the question cannot record that type.
    expect(pickRecordingType(() => { throw new Error("nope"); })).toBeNull();
  });

  it("names the file after the container the recorder actually used", () => {
    expect(extensionForRecording("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForRecording("audio/mp4")).toBe("m4a");
    expect(extensionForRecording("audio/ogg;codecs=opus")).toBe("ogg");
    // An unknown type is still written; WebM is what a WebView produces.
    expect(extensionForRecording("audio/weird")).toBe("webm");
  });

  it("writes the date and the minute into the name, so a day of memos sorts itself", () => {
    expect(voiceMemoFileName(new Date(2026, 8, 22, 9, 5), "Sprachnotiz", "m4a")).toBe("Sprachnotiz 2026-09-22 0905.m4a");
    expect(voiceMemoFileName(new Date(2026, 11, 1, 23, 59), "Voice memo", "webm")).toBe("Voice memo 2026-12-01 2359.webm");
  });
});

describe("a take", () => {
  it("hands back the bytes and the type, and lets go of the microphone", async () => {
    const h = harness();
    const recorder = await startVoiceMemo(h.ports);
    expect(recorder.state).toBe("recording");
    const result = await recorder.stop();
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.mime).toBe("audio/webm;codecs=opus");
    expect(result.extension).toBe("webm");
    // Every track is stopped — otherwise the recording light stays on.
    expect(h.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it("pauses and resumes without ending", async () => {
    const h = harness();
    const recorder = await startVoiceMemo(h.ports);
    recorder.pause();
    expect(recorder.state).toBe("paused");
    recorder.resume();
    expect(recorder.state).toBe("recording");
    expect(h.recorder?.paused).toBe(1);
    expect(h.recorder?.resumed).toBe(1);
    expect(h.recorder?.stopped).toBe(0);
  });

  it("writes nothing when it is discarded, and still lets go of the microphone", async () => {
    const h = harness();
    const recorder = await startVoiceMemo(h.ports);
    recorder.discard();
    expect(h.recorder?.stopped).toBe(1);
    expect(h.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    // Nothing resolves afterwards: there is no result to attach.
    expect(recorder.state).toBe("idle");
  });
});

describe("when it cannot record", () => {
  it("says the person refused, which is worth offering again", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const h = harness({ getStream: () => Promise.reject(denied) });
    await expect(startVoiceMemo(h.ports)).rejects.toMatchObject({ reason: "denied" });
  });

  it("says the device cannot, which is not", async () => {
    const missing = Object.assign(new Error("none"), { name: "NotFoundError" });
    const h = harness({ getStream: () => Promise.reject(missing) });
    await expect(startVoiceMemo(h.ports)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("says so before touching the microphone when no format is supported", async () => {
    let asked = 0;
    const h = harness({ isTypeSupported: () => false, getStream: async () => { asked += 1; throw new Error("unreachable"); } });
    await expect(startVoiceMemo(h.ports)).rejects.toBeInstanceOf(VoiceMemoError);
    expect(asked).toBe(0);
  });

  it("reports a take that broke mid-recording instead of hanging", async () => {
    const h = harness();
    const recorder = await startVoiceMemo(h.ports);
    // The device is pulled: the recorder errors and never fires `onstop`, so
    // nothing would resolve the promise the button is waiting on.
    h.recorder!.breaks = true;
    await expect(recorder.stop()).rejects.toMatchObject({ reason: "failed" });
  });
});
