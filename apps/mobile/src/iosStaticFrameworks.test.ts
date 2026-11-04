import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A framework without code is not shipped: App Store Connect rejected two Labs
 * builds carrying ONNX Runtime's framework in App.app/Frameworks (ITMS-90208,
 * 2026-10-01). Its binary is a static archive; Xcode drops that code when it
 * embeds the framework of a Swift package's binary target and injects an empty
 * stub built for the app's deployment target, while the framework's Info.plist
 * keeps its lower MinimumOSVersion. The app target removes such frameworks, and
 * the archive check of the workflows applies Apple's rule before the upload.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, "..", ...parts), "utf8");

describe("frameworks without code stay out of the iOS bundle", () => {
  const project = read("ios", "App", "App.xcodeproj", "project.pbxproj");

  it("the app target removes them after everything is embedded", () => {
    const start = project.indexOf("/* App */ = {\n\t\t\tisa = PBXNativeTarget;");
    expect(start).toBeGreaterThan(-1);
    const phases = project.slice(project.indexOf("buildPhases = (", start), project.indexOf(");", project.indexOf("buildPhases = (", start)));
    const order = [...phases.matchAll(/\/\* ([^*]+) \*\//g)].map((m) => m[1]);
    expect(order[order.length - 1]).toBe("Remove frameworks without code");
    const phase = project.slice(project.indexOf("/* Remove frameworks without code */ = {"));
    expect(phase).toMatch(/isa = PBXShellScriptBuildPhase;/);
    // Xcode drops a static framework's code and injects an empty stub: no exported symbol, no code.
    expect(phase).toContain("nm -gUj");
    expect(phase).toContain("ar archive");
    expect(phase).toContain("rm -rf");
  });

  it("the archive check applies Apple's rule before the upload: code in every framework, its binary no newer than its Info.plist", () => {
    const check = read("scripts", "verify-ios-share-archive.py");
    expect(check).toContain("def slice_facts(");
    expect(check).toContain("LC_BUILD_VERSION");
    expect(check).toMatch(/assert minimum is None or minimum <= declared/);
    expect(check).toMatch(/assert code > 0/);
    expect(check).toContain("ITMS-90208");
  });
});
