import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A static framework is linked into the app, never shipped in it: App Store
 * Connect rejected the Labs build that carried ONNX Runtime's static framework
 * in App.app/Frameworks (ITMS-90208, 2026-10-01). Xcode copies the framework
 * of a Swift package's binary target into the bundle whatever its binary is,
 * so the app target strips static ones itself, and the archive check of the
 * workflows fails on one that slips through — before the upload, not after.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, "..", ...parts), "utf8");

describe("static frameworks stay out of the iOS bundle", () => {
  const project = read("ios", "App", "App.xcodeproj", "project.pbxproj");

  it("the app target strips them after everything is embedded", () => {
    const start = project.indexOf("/* App */ = {\n\t\t\tisa = PBXNativeTarget;");
    expect(start).toBeGreaterThan(-1);
    const phases = project.slice(project.indexOf("buildPhases = (", start), project.indexOf(");", project.indexOf("buildPhases = (", start)));
    const order = [...phases.matchAll(/\/\* ([^*]+) \*\//g)].map((m) => m[1]);
    expect(order[order.length - 1]).toBe("Strip static frameworks");
    const phase = project.slice(project.indexOf("/* Strip static frameworks */ = {"));
    expect(phase).toMatch(/isa = PBXShellScriptBuildPhase;/);
    expect(phase).toContain("ar archive");
    expect(phase).toContain("rm -rf");
  });

  it("the archive check refuses a static framework before the upload", () => {
    const check = read("scripts", "verify-ios-share-archive.py");
    expect(check).toContain("def is_static(");
    expect(check).toContain("ITMS-90208");
    expect(check).toMatch(/assert not is_static\(binary\)/);
  });
});
