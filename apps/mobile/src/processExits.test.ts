import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boundedProcessExit, formatDiagnosticsExport, scrubExitText } from "@plainva/ui";
import { classifyProcessExit, mergeProcessExits, processExitLabelKey, topFrames, type ProcessExitRecord } from "./services/processExits";

/**
 * Android 17's memory limiter kills silently (plan 2026-09-04, P1). What the
 * app keeps of the system's exit record decides whether "was it memory?" is
 * ever answerable — so the classification and the folding are pinned here.
 */
describe("process exits", () => {
  it("recognises the memory limiter by its description, whatever the reason code", () => {
    expect(classifyProcessExit({ reason: 13, description: "MemoryLimiter:AnonSwap" })).toBe("memory-limiter");
    expect(classifyProcessExit({ reason: 2, description: "MemoryLimiter:AnonSwap" })).toBe("memory-limiter");
  });

  it("names the exits a person can act on, and keeps the rest as closed or other", () => {
    expect(classifyProcessExit({ reason: 3 })).toBe("low-memory");
    expect(classifyProcessExit({ reason: 9 })).toBe("excessive-resources");
    expect(classifyProcessExit({ reason: 4 })).toBe("crash");
    expect(classifyProcessExit({ reason: 5 })).toBe("crash");
    expect(classifyProcessExit({ reason: 6 })).toBe("anr");
    // Closed by the person, updated, exited on its own: kept for the export, not shown (F51).
    expect(classifyProcessExit({ reason: 10 })).toBe("user");
    expect(classifyProcessExit({ reason: 11 })).toBe("user");
    expect(classifyProcessExit({ reason: 16 })).toBe("other");
    expect(classifyProcessExit({ reason: 1 })).toBe("other");
    expect(classifyProcessExit({ reason: 13, description: "" })).toBe("other");
  });

  it("adds only exits newer than the last look, newest first, and keeps ten", () => {
    const known: ProcessExitRecord[] = [{ at: "2026-09-01T10:00:00.000Z", kind: "crash" }];
    const t = (iso: string) => new Date(iso).getTime();
    const fresh = [
      { reason: 13, description: "MemoryLimiter:AnonSwap", timestamp: t("2026-09-04T08:00:00.000Z"), importance: 400 },
      { reason: 10, description: null, timestamp: t("2026-09-04T07:00:00.000Z"), importance: 400 }, // closed by the person
      { reason: 6, description: null, timestamp: t("2026-08-30T07:00:00.000Z"), importance: 400 }, // older than the last look
    ];
    const out = mergeProcessExits(known, fresh, t("2026-09-01T12:00:00.000Z"));
    expect(out.records.map((r) => r.kind)).toEqual(["memory-limiter", "user", "crash"]);
    expect(out.records[0]).toEqual({ at: "2026-09-04T08:00:00.000Z", kind: "memory-limiter", description: "MemoryLimiter:AnonSwap" });
    expect(out.seenUntil).toBe(t("2026-09-04T08:00:00.000Z"));

    const many = Array.from({ length: 14 }, (_, i) => ({ reason: 4, description: null, timestamp: t("2026-09-05T00:00:00.000Z") + i * 1000, importance: 100 }));
    expect(mergeProcessExits([], many, 0).records).toHaveLength(10);
  });

  it("leaves the marker alone when the system has nothing new", () => {
    const out = mergeProcessExits([], [], 42);
    expect(out).toEqual({ records: [], seenUntil: 42 });
  });

  it("names every kind for the user", () => {
    expect(processExitLabelKey("memory-limiter")).toBe("settingsSync.diagExitMemory");
    expect(processExitLabelKey("low-memory")).toBe("settingsSync.diagExitMemory");
    expect(processExitLabelKey("crash")).toBe("settingsSync.diagExitCrash");
    expect(processExitLabelKey("anr")).toBe("settingsSync.diagExitAnr");
    // ANR is Android's word; an iPhone's hang has its own (F51).
    expect(classifyProcessExit({ reason: 100 })).toBe("hang");
    expect(processExitLabelKey("hang")).toBe("settingsSync.diagExitHang");
  });
});

/**
 * What the export carries of an exit (release list F51): the build, and for an
 * ANR or a crash the frames - never a path, an address, a mail address or a
 * file name, never an exception's message, and only so much of it.
 */
describe("process exits in the diagnostics export (F51)", () => {
  const t = (iso: string) => new Date(iso).getTime();

  it("keeps the build and the frames, and never a crash's description", () => {
    const out = mergeProcessExits([], [
      { reason: 6, description: "Input dispatching timed out (MainActivity is not responding. Waited 5000ms)", timestamp: t("2026-11-17T08:00:00.000Z"), importance: 100,
        build: "0.8.7.8 (154)", frames: ["main: at android.os.MessageQueue.nativePollOnce(Native Method)", "CapacitorPlugins: at com.plainva.app.AtomicFilePlugin.write(AtomicFilePlugin.java:88)"] },
      { reason: 4, description: "java.io.FileNotFoundException: /data/user/0/com.plainva.app/files/vaults/v1/Tagebuch.md", timestamp: t("2026-11-17T07:00:00.000Z"), importance: 100,
        exception: "java.lang.OutOfMemoryError", frames: ["at com.plainva.app.WebDavHttpPlugin$1.onResponse:271"] },
    ], 0);
    expect(out.records[0]).toEqual({
      at: "2026-11-17T08:00:00.000Z", kind: "anr", build: "0.8.7.8 (154)",
      description: "Input dispatching timed out (MainActivity is not responding. Waited 5000ms)",
      frames: ["main: at android.os.MessageQueue.nativePollOnce(Native Method)", "CapacitorPlugins: at com.plainva.app.AtomicFilePlugin.write(AtomicFilePlugin.java:88)"],
    });
    expect(out.records[1]).toEqual({ at: "2026-11-17T07:00:00.000Z", kind: "crash", exception: "java.lang.OutOfMemoryError", frames: ["at com.plainva.app.WebDavHttpPlugin$1.onResponse:271"] });
  });

  it.each([
    ["a path", "Failed at /data/user/0/com.plainva.app/files/vaults/v1/Tagebuch/Juni.md", "Failed at <path>", "Juni"],
    ["a URL", "GET https://dav.example.org/remote.php/dav/files/anna/Notes/x.md failed", "GET <url> failed", "anna"],
    ["a mail address", "IMAP login for anna.schmidt@example.org refused", "IMAP login for <email> refused", "anna"],
    ["a bare file name", "Cannot open Arztbrief 2026.pdf now", "Cannot open Arztbrief <file> now", "2026.pdf"],
    ["a Windows path", "C:\\Users\\Anna\\Vault\\Notiz.md locked", "<path> locked", "Anna"],
  ])("scrubs %s", (_name, raw, expected, leak) => {
    expect(scrubExitText(raw)).toBe(expected);
    expect(scrubExitText(raw)).not.toContain(leak);
  });

  it("keeps a native library's name, which names no note", () => {
    expect(scrubExitText("native: #00 pc 000a1b /apex/com.android.runtime/lib64/bionic/libc.so (syscall+28)")).toBe("native: #00 pc 000a1b libc.so (syscall+28)");
  });

  it("keeps at most ten exits, of the ones nobody acts on three, and bounds each", () => {
    const closed = Array.from({ length: 8 }, (_, i) => ({ reason: 10, description: null, timestamp: t("2026-11-17T09:00:00.000Z") + i, importance: 100 }));
    const anrs = Array.from({ length: 9 }, (_, i) => ({ reason: 6, description: `Input dispatching timed out ${"x".repeat(5000)}`, timestamp: t("2026-11-17T08:00:00.000Z") + i, importance: 100,
      frames: Array.from({ length: 200 }, (_, f) => `main: at a.B.c${f}(B.java:${f})`) }));
    const { records } = mergeProcessExits([], [...closed, ...anrs], 0);
    expect(records).toHaveLength(10);
    expect(records.filter((r) => r.kind === "user")).toHaveLength(3);
    for (const record of records.filter((r) => r.kind === "anr")) {
      expect(record.description!.length).toBeLessThanOrEqual(201);
      expect(record.frames!.length).toBeLessThanOrEqual(32);
    }
    const text = formatDiagnosticsExport({ appVersion: "0.9.0", tauriVersion: "-", os: "android", language: "de", processExits: records });
    expect(text).toContain("## How the system ended the app");
    // The export stays small: ten exits with their frames, well under the bridge's part.
    expect(text.length).toBeLessThan(96 * 1024);
  });

  it("the export says so when there is none, and carries no section where none is read", () => {
    expect(formatDiagnosticsExport({ appVersion: "0.9.0", tauriVersion: "-", os: "android", language: "de", processExits: [] })).toContain("(none recorded)");
    expect(formatDiagnosticsExport({ appVersion: "0.9.0", tauriVersion: "-", os: "ios", language: "de" })).not.toContain("How the system ended the app");
  });

  it("the Android plugin keeps the build, the ANR's frames and a crash's class and frames, never its message", () => {
    const java = readFileSync(new URL("../android/app/src/main/java/com/plainva/app/ProcessExitPlugin.java", import.meta.url), "utf8");
    expect(java).toMatch(/setProcessStateSummary\(/);
    expect(java).toMatch(/getProcessStateSummary\(\)/);
    expect(java).toMatch(/getTraceInputStream\(\)/);
    expect(java).toMatch(/"CapacitorPlugins"/);
    expect(java).toMatch(/Thread\.setDefaultUncaughtExceptionHandler\(/);
    // The app ends as before: the previous handler always gets the crash.
    expect(java).toMatch(/finally \{\s*if \(previous != null\) previous\.uncaughtException\(thread, error\);/);
    expect(java).not.toMatch(/getMessage\(\)|getLocalizedMessage\(\)|printStackTrace/);
    // Nothing that must allocate is opened when the crash comes: the file and the buffer exist from the start.
    expect(java).toMatch(/final RandomAccessFile out = new RandomAccessFile\(file, "rw"\);\s*final byte\[\] buffer = new byte\[CRASH_BYTES\];/);
  });
});

describe("iOS: the system's diagnostics through MetricKit (F51)", () => {
  const swift = () => readFileSync(new URL("../ios/App/App/ProcessExitPlugin.swift", import.meta.url), "utf8");

  it("is subscribed early, takes in what came before and is registered", () => {
    expect(readFileSync(new URL("../ios/App/App/AppDelegate.swift", import.meta.url), "utf8")).toMatch(/ExitDiagnostics\.shared\.start\(\)/);
    expect(swift()).toMatch(/MXMetricManager\.shared\.add\(self\)/);
    expect(swift()).toMatch(/pastDiagnosticPayloads/);
    expect(swift()).toMatch(/pastPayloads/);
    expect(readFileSync(new URL("../ios/App/App/MainViewController.swift", import.meta.url), "utf8")).toMatch(/registerPluginInstance\(ProcessExitPlugin\(\)\)/);
    expect(readFileSync(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8")).toMatch(/ProcessExitPlugin\.swift in Sources/);
    expect(swift()).toContain('CAPPluginMethod(name: "lastExits", returnType: CAPPluginReturnPromise)');
  });

  it("keeps only the named fields: never the raw tree, a composed message or the memory regions", () => {
    const source = swift();
    expect(source).not.toMatch(/exceptionReason|composedMessage|virtualMemoryRegionInfo/);
    // The tree is read only to take binary name and offset; it is never stored.
    expect(source.match(/jsonRepresentation\(\)/g)).toHaveLength(1);
    expect(source).toMatch(/static let maxFrames = 12/);
    expect(source).toMatch(/static let maxExits = 10/);
    expect(source).toMatch(/static let hangReason = 100/);
    // One serial queue writes one file, replaced atomically.
    expect(source).toMatch(/DispatchQueue\(label: "com\.plainva\.exit-diagnostics"\)/);
    expect(source).toMatch(/data\.write\(to: url, options: \.atomic\)/);
    expect(source).not.toMatch(/UsageDescription/);
  });

  it.each([
    ["a bundle path", "Namespace SIGNAL, Code 0x9 /private/var/containers/Bundle/Application/1A2B/Plainva.app/Plainva", "Namespace SIGNAL, Code 0x9 <path>"],
    ["a data path", "Namespace RUNNINGBOARD, Code 0xdead10cc held lock /var/mobile/Containers/Data/Application/X/Documents/vaults/v1/Notiz.md", "Namespace RUNNINGBOARD, Code 0xdead10cc held lock <path>"],
  ])("scrubs the termination reason with %s", (_name, raw, expected) => {
    expect(scrubExitText(raw)).toBe(expected);
  });

  it("the export carries the daily counts, without a time of day", () => {
    const text = formatDiagnosticsExport({ appVersion: "0.9.0", tauriVersion: "-", os: "ios", language: "de", processExits: [],
      dailyExits: [{ day: "2026-11-16", memory: 3, other: 1 }] });
    expect(text).toContain("## Daily counts of exits by the system (per day, no time of day)");
    expect(text).toContain("- 2026-11-16: 3 memory, 1 other");
  });
});

describe("the screen 'Ended by the system' shows the top of the stack (F51)", () => {
  it("each exit shows its exception and frames, the main thread first", () => {
    const screen = readFileSync(new URL("./screens/SyncDiagnosticsScreen.tsx", import.meta.url), "utf8");
    expect(screen).toMatch(/<code className="m-exit-frames">\{topFrames\(e\)\.join\("\\n"\)\}<\/code>/);
    // The order lives beside the records (`topFrames` in processExits.ts), tested below with a real ANR.
    expect(readFileSync(new URL("./services/processExits.ts", import.meta.url), "utf8")).toMatch(/frame\.startsWith\("main: "\)/);
    expect(readFileSync(new URL("./mobile.css", import.meta.url), "utf8")).toMatch(/\.m-exit-frames \{/);
  });
});

describe("only what is known to name nothing of the person's gets through (second review)", () => {
  const exit = (description: string, frames: string[] = []) =>
    boundedProcessExit({ at: "2026-11-17T08:00:00.000Z", kind: "anr", description, frames });

  it.each([
    ["a path with spaces", "Failed at /storage/emulated/0/Documents/Mein Vault/Arzt Brief Juni.md"],
    ["a folder in brackets", "Input dispatching timed out at /storage/emulated/0/Projekt (alt)/Plan.md"],
    ["a URL", "Input dispatching timed out https://dav.example.org/remote.php/dav/files/anna/"],
    ["a mail address", "user request after error anna.schmidt@example.org"],
    ["a file name", "remove task Arztbrief 2026.pdf"],
    ["an unknown text", "something the system said about Tagebuch"],
  ])("drops a description with %s whole", (_name, description) => {
    expect(exit(description).description).toBeUndefined();
  });

  it("keeps the system's own words in the shapes it uses", () => {
    expect(exit("Input dispatching timed out (com.plainva.app/com.plainva.app.MainActivity is not responding. Waited 5000ms for MotionEvent)").description).toMatch(/^Input dispatching timed out/);
    expect(exit("MemoryLimiter:AnonSwap").description).toBe("MemoryLimiter:AnonSwap");
    expect(exit("Namespace SIGNAL, Code 0x9").description).toBe("Namespace SIGNAL, Code 0x9");
    expect(exit("3.2 s").description).toBe("3.2 s");
  });

  it("keeps frames in the shapes the plugins write, and drops any other", () => {
    const frames = exit("MemoryLimiter:AnonSwap", [
      "main: at android.os.MessageQueue.nativePollOnce(Native Method)",
      "CapacitorPlugins: at com.plainva.app.AtomicFilePlugin.write(AtomicFilePlugin.java:88)",
      "at com.plainva.app.WebDavHttpPlugin$1.onResponse:271",
      "main: native: #00 pc 000a1b /apex/com.android.runtime/lib64/bionic/libc.so (syscall+28)",
      "Plainva +123456",
      "main: at java.io.FileInputStream.open(/data/user/0/com.plainva.app/files/vaults/v1/Notiz.md)",
      "Arzt Brief Juni",
    ]).frames;
    expect(frames).toEqual([
      "main: at android.os.MessageQueue.nativePollOnce(Native Method)",
      "CapacitorPlugins: at com.plainva.app.AtomicFilePlugin.write(AtomicFilePlugin.java:88)",
      "at com.plainva.app.WebDavHttpPlugin$1.onResponse:271",
      "main: native: #00 pc 000a1b libc.so (syscall+28)",
      "Plainva +123456",
    ]);
  });

  it("a termination reason that carries a path is dropped whole", () => {
    expect(exit("Namespace SIGNAL, Code 0x9 /private/var/containers/Bundle/Application/1A2B/Plainva.app/Plainva").description).toBeUndefined();
  });
});

describe("costs and keys (second review)", () => {
  const java = () => readFileSync(new URL("../android/app/src/main/java/com/plainva/app/ProcessExitPlugin.java", import.meta.url), "utf8");
  const swift = () => readFileSync(new URL("../ios/App/App/ProcessExitPlugin.swift", import.meta.url), "utf8");

  it("Android reads only exits after what was seen, and off the plugin thread", () => {
    expect(java()).toMatch(/JsNumbers\.wholeOr\(call, "since", 0L\)/);
    expect(java()).toMatch(/new Thread\(\(\) -> call\.resolve\(readExits\(since\)\), "plainva-exits"\)\.start\(\)/);
    const body = java().slice(java().indexOf("private JSObject readExits("));
    expect(body.indexOf("if (info.getTimestamp() <= since) continue;")).toBeGreaterThan(-1);
    expect(body.indexOf("if (info.getTimestamp() <= since) continue;")).toBeLessThan(body.indexOf("anrFrames(info)"));
  });

  it("the daily counts are asked for only on iOS", () => {
    const bridge = readFileSync(new URL("./platform/processExit.ts", import.meta.url), "utf8");
    expect(bridge).toMatch(/export async function lastProcessExitDays\(\)[^{]*\{\s*if \(Capacitor\.getPlatform\(\) !== "ios"\) return \[\];/);
  });

  it("iOS keeps one key per diagnosis, and its folder out of the iCloud backup", () => {
    expect(swift()).toMatch(/for \(index, crash\) in \(payload\.crashDiagnostics \?\? \[\]\)\.enumerated\(\)/);
    expect(swift()).toMatch(/for \(index, hang\) in \(payload\.hangDiagnostics \?\? \[\]\)\.enumerated\(\)/);
    expect(swift()).toMatch(/values\.isExcludedFromBackup = true/);
    expect(swift()).toMatch(/self\.excludeFromBackup\(\)/);
  });

  it("the crash handler says honestly that its record is best effort, and always hands on", () => {
    expect(java()).toMatch(/the record can therefore be missing/);
    expect(java()).toMatch(/finally \{\s*if \(previous != null\) previous\.uncaughtException\(thread, error\);/);
  });
});


describe("the real ANR from the maintainer's phone (2026-11-17)", () => {
  // The main thread as the native side hands it on: each frame line, prefixed with its thread.
  const frames = readFileSync(new URL("./__fixtures__/anr-main-thread-2026-11-17.txt", import.meta.url), "utf8")
    .split("\n").map((line) => line.trim()).filter((line) => line.startsWith("at ") || line.startsWith("native: "))
    .map((line) => `main: ${line}`);

  it("every frame of it gets through, in the shape the dump writes it", () => {
    expect(frames).toHaveLength(25);
    const kept = boundedProcessExit({ at: "2026-11-17T12:00:00.000Z", kind: "anr", frames }).frames ?? [];
    expect(kept).toHaveLength(25);
    expect(kept).toContain("main: at java.lang.String.fastSubstring(Native method)");
    expect(kept).toContain("main: at com.getcapacitor.MessageHandler.postMessage(MessageHandler.java:54)");
    expect(kept).toContain("main: at android.os.Handler.handleCallback(unavailable:0)");
    expect(kept).toContain("main: at WV.m03.run(chromium-SystemWebViewGoogle6432.aab-stable-810303803:94)");
    expect(kept.some((frame) => frame.startsWith("main: native: #00 pc 000a5a20  libc.so"))).toBe(true);
  });

  it("the screen's eight lines name the place: the Java frames first, each method once", () => {
    const kept = boundedProcessExit({ at: "2026-11-17T12:00:00.000Z", kind: "anr", frames }).frames ?? [];
    const shown = topFrames({ frames: kept });
    expect(shown).toHaveLength(8);
    expect(shown[0]).toBe("main: at java.lang.String.fastSubstring(Native method)");
    expect(shown).toContain("main: at com.getcapacitor.MessageHandler.postMessage(MessageHandler.java:54)");
  });

  it("the Android plugin keeps enough frames for it", () => {
    const java = readFileSync(new URL("../android/app/src/main/java/com/plainva/app/ProcessExitPlugin.java", import.meta.url), "utf8");
    expect(java).toMatch(/private static final int MAX_FRAMES = 32;/);
  });
});
