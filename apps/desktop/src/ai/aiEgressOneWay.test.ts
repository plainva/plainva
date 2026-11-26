import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every request to a model leaves the device through ONE place (plan Umsetzung 0.9.x, B7, review S1): the native
 * egress each shell makes is handed to the AI session and to nothing else, and the session wraps it once
 * (`departingEgress` around `localOnlyEgress`) — the place where a run learns that something of it left the device,
 * so that "nothing was sent" is a fact of the run. Read from the sources: a new way to the native egress — a second
 * caller of `ai_http`, of the phone's `AiNet` plugin, or of the egress factories — fails here, before it could send
 * past that count.
 */
const ROOT = resolve(__dirname, "../../../..");
const SOURCES = ["packages/ui/src", "packages/core/src", "apps/desktop/src", "apps/mobile/src"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const sources = SOURCES.flatMap((dir) => files(join(ROOT, dir))).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
/** The places that name it, test harnesses aside. */
const where = (pattern: RegExp) => sources.filter((file) => pattern.test(file.text) && !/Harness\.ts$|harness\.ts$|TestHost\.ts$/.test(file.path)).map((file) => file.path).sort();

describe("the one way out of the device for a model request", () => {
  it("the desktop's native call is made in its egress alone", () => {
    expect(where(/["']ai_http["']/)).toEqual(["apps/desktop/src/services/ai/desktopAiEgress.ts"]);
  });

  it("the phone's native plugin is reached in its egress alone", () => {
    expect(where(/registerPlugin<[^>]*>\(\s*["']AiNet["']/)).toEqual(["apps/mobile/src/platform/aiNet.ts"]);
  });

  it("each shell's egress is made once, and handed to the AI session", () => {
    for (const [factory, file] of [
      ["createDesktopAiEgress", "apps/desktop/src/services/ai/desktopAi.ts"],
      ["createMobileAiEgress", "apps/mobile/src/services/ai/mobileAi.ts"],
    ] as const) {
      const calls = where(new RegExp(`\\b${factory}\\(`)).filter((path) => !path.endsWith("Egress.ts") && !path.endsWith("aiNet.ts"));
      expect(calls, factory).toEqual([file]);
      const text = sources.find((source) => source.path === file)!.text;
      expect(text.match(new RegExp(`\\b${factory}\\(`, "g"))).toHaveLength(1);
      expect(text).toMatch(new RegExp(`new AiSession\\(\\{\\s*egress:\\s*${factory}\\(`));
    }
  });

  it("the session takes the shell's egress in one place, the counted one", () => {
    const session = sources.find((source) => source.path === "packages/ui/src/ai/aiSession.ts")!.text;
    expect(session.match(/\bhost\.egress\b/g)).toHaveLength(1);
    expect(session).toMatch(/this\.out = departingEgress\(\s*localOnlyEgress\(host\.egress,/);
  });
});
