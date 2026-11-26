import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every request to a model leaves the device through ONE place (plan Umsetzung 0.9.x, B7, review S1): the native
 * egress each shell makes is handed to the AI session and to nothing else, and the session puts the device's switch
 * in front of it once (`localOnlyEgress`). What a run says about sending is a fact of that run alone: each run gets
 * an egress of its own (`runDepartures`, counting with `departingEgress`) and hands it explicitly to every request it
 * makes — the model call, the reader without tools, a page's processing, and the question embedded for the search.
 * Read from the sources: a new way to the native egress, or a request inside a run that does not take the run's
 * egress, fails here.
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

  it("the session takes the shell's egress in one place, behind the device's switch", () => {
    const session = text("packages/ui/src/ai/aiSession.ts");
    expect(session.match(/\bhost\.egress\b/g)).toHaveLength(1);
    expect(session).toMatch(/this\.out = localOnlyEgress\(host\.egress,/);
    // Counted for a run only: the session's own egress counts for nobody.
    expect(session.match(/\bdepartingEgress\(/g)).toHaveLength(2);
    expect(session).toMatch(/private runDepartures\(\): RunDepartures \{\s*const to: string\[\] = \[\];\s*const egress = departingEgress\(this\.out,/);
  });
});

/** The body of a method of the session, from its head to the line that closes it. */
function method(source: string, head: string): string {
  const start = source.indexOf(head);
  expect(start, head).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}
const text = (path: string) => sources.find((source) => source.path === path)!.text;

describe("every request of a run goes through that run's own egress", () => {
  const session = text("packages/ui/src/ai/aiSession.ts");
  const run = method(session, "  private async runMessage(");
  const execute = method(session, "  private async execute(input: {");

  it("a run and its execution reach no other egress than the run's", () => {
    for (const [name, body] of [["runMessage", run], ["execute", execute]] as const) {
      expect(body, name).not.toMatch(/this\.out\b|host\.egress|this\.egress\b/);
      for (const given of body.match(/\begress: [^,\n}]+/g) ?? []) expect(["egress: run.egress", "egress: input.departures.egress"], `${name}: ${given}`).toContain(given);
    }
    expect(run).toMatch(/const run = this\.runDepartures\(\);/);
    // The model call, the reader without tools, a page's processing, and the context (its search).
    expect(execute).toMatch(/runAgent\(\{[\s\S]*?egress: input\.departures\.egress,/);
    expect(run.match(/egress: run\.egress,/g)?.length).toBeGreaterThanOrEqual(3);
    expect(run).toMatch(/this\.contextOf\([^)]*\{\s*egress: run\.egress,/);
  });

  it("every execution is handed the departures of a run", () => {
    const calls = session.match(/this\.execute\(\{\s*departures: [^,]+,/g) ?? [];
    expect(calls.length).toBe((session.match(/this\.execute\(\{/g) ?? []).length);
  });

  it("the question goes to a search model through the egress it is handed, never the host's", () => {
    const contextOf = method(session, "  private async contextOf(");
    expect(contextOf).toMatch(/vault\.candidates\([^;]*conversation\.egress\)/);
    expect(text("packages/ui/src/ai/aiVaultHost.ts")).toMatch(/gatherCandidates\(input\.retrieval, question, activePath, recipient, egress\)/);
    expect(text("packages/ui/src/ai/aiVaultHost.ts")).toMatch(/semanticCandidates\(question, 20, \{ cloudQuestion, egress \}\)/);
    const embeddings = text("packages/ui/src/ai/localEmbeddings.ts");
    expect(method(embeddings, "  async semanticCandidates(")).toMatch(/indexer\.rankedSearch\([^;]*\{ egress: options\.egress \}\)/);
    expect(embeddings).toMatch(/const egress = via\?\.egress \?\? host\.egress;/);
    expect(method(text("packages/core/src/ai/embeddings/pipeline.ts"), "  async rankedSearch(")).toMatch(/this\.engine\.embed\(\[question\], "query", signal, via\)/);
    const provider = text("packages/core/src/ai/embeddings/providerEngine.ts");
    expect(provider).toMatch(/await send\(embeddingRequest\([^;]*signal, via\)/);
    // The shells hand the options on as they are, the egress with them.
    expect(text("apps/desktop/src/services/ai/desktopAi.ts")).toMatch(/semanticCandidates: async \(question, limit, options\) => \(await input\.semantic\?\.\(\)\?\.semanticCandidates\(question, limit, options\)\)/);
    expect(text("apps/mobile/src/services/ai/mobileAi.ts")).toMatch(/semanticCandidates: async \(question, limit, options\) => \(await embeddingsRef\.current\?\.semanticCandidates\(question, limit, options\)\)/);
  });
});
