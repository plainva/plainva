import { describe, expect, it } from "vitest";
import type { EgressRecipient } from "../egressGate.js";
import { DEFAULT_AI_POLICY, effectivePolicy } from "../policy.js";
import { manifestOf, scopeGrowth, widenScope } from "./manifest.js";
import { buildContextPackage, sentStamps, type ContextBuildHost, type ContextBuildInput, type ContextPackage, type SituationInput } from "./package.js";
import { SITUATION_SOURCE } from "./sensitiveHints.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const local: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };
const situation: SituationInput = { now: "2026-10-01 09:00", weekday: "Thursday", calendarDay: "2026-10-01", journalDay: "2026-10-01", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
const IBAN = "DE89 3704 0044 0532 0130 00";

const files: Record<string, string> = {
  "Finance/Rent.md": `# Rent\n\nThe rent goes to ${IBAN} every month. The landlord's portal password: Sommer2026!`,
  "Finance/Rent copy.md": `# Rent\n\nThe rent goes to ${IBAN} every month. The landlord's portal password: Sommer2026!`,
  "Health/Checkup.md": "# Check-up\n\nThe doctor says the diagnosis is fine; the next rent payment is due on the first.",
  "Home/Plants.md": "# Plants\n\nWater the rent-a-plant ferns on Sundays.",
};

function host(extra: Partial<ContextBuildHost> = {}): ContextBuildHost {
  return {
    policyOf: async (path) => effectivePolicy(path, {}, [], DEFAULT_AI_POLICY),
    resolveLink: async () => null,
    readNote: async (path) => (files[path] === undefined ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text: files[path]! }),
    ...extra,
  };
}

const found = (...paths: string[]) => [paths.map((path, i) => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), signals: { lexical: 1 - i * 0.05 } }))];
const input = (over: Partial<ContextBuildInput> = {}): ContextBuildInput => ({
  question: "where does the rent go",
  recipient: cloud,
  situation,
  candidates: found("Finance/Rent.md", "Health/Checkup.md"),
  pins: [],
  ...over,
});
const ref = (pack: ContextPackage, path: string) => pack.refs.find((r) => r.path === path)!;

/** Plan KI-Harness P2b-6: what the patterns see rides on its source; the reader decides. */
describe("sensitivity hints in the package", () => {
  it("names what it saw in the text going to a cloud, and sends it unchanged unless the reader chose otherwise", async () => {
    const pack = await buildContextPackage(input(), host());
    expect(ref(pack, "Finance/Rent.md").sensitive).toEqual(["credential", "account"]);
    expect(ref(pack, "Health/Checkup.md").sensitive).toEqual(["health"]);
    expect(pack.part.text).toContain(IBAN);
    expect(pack.redactions.sensitive).toBe(0);
    expect(pack.sensitive).toEqual(["credential", "account", "health"]);
  });

  it("redacts the numbers and secrets of a chosen source; the health words stay, and the overview counts the rest", async () => {
    const pack = await buildContextPackage(input({ redact: new Set(["Finance/Rent.md", "Health/Checkup.md"]) }), host());
    expect(pack.part.text).not.toContain("DE89 3704");
    expect(pack.part.text).not.toContain("Sommer2026");
    expect(pack.part.text).toContain("⟦withheld account⟧");
    expect(pack.part.text).toContain("diagnosis");
    expect(ref(pack, "Finance/Rent.md").redacted).toBe(2);
    expect(pack.sensitive).toEqual(["health"]);
    const manifest = manifestOf(pack, { id: "p", label: "P", local: false }, "m", { tools: [] });
    expect(manifest.withheld.sensitive).toBe(2);
    expect(manifest.sources.find((s) => s.path === "Finance/Rent.md")).toMatchObject({ sensitive: ["credential", "account"], redacted: 2 });
  });

  it("keeps a redacted source redacted later in the conversation, and never resends it", async () => {
    const redact = new Set(["Finance/Rent.md"]);
    const first = await buildContextPackage(input({ redact }), host());
    const turns = [{ role: "user", parts: [first.part] }];
    const again = await buildContextPackage(input({ redact, alreadySent: sentStamps(turns) }), host());
    expect(ref(again, "Finance/Rent.md")).toMatchObject({ unchanged: true, sensitive: ["credential", "account"] });
    expect(again.part.text).not.toContain("DE89 3704");
    // Taken back: the original is new to this conversation and goes as it is.
    const unredacted = await buildContextPackage(input({ alreadySent: sentStamps(turns) }), host());
    expect(ref(unredacted, "Finance/Rent.md").unchanged).toBeUndefined();
    expect(unredacted.part.text).toContain(IBAN);
  });

  it("never lets a redacted note's copy carry what was redacted", async () => {
    const pack = await buildContextPackage(input({ candidates: found("Finance/Rent.md", "Finance/Rent copy.md"), redact: new Set(["Finance/Rent.md"]) }), host());
    expect(pack.part.text).not.toContain("DE89 3704");
    expect(ref(pack, "Finance/Rent copy.md").tier).toBe("map");
  });

  it("screens tasks and appointments: a task's hint joins its note, the rest is the situation's own", async () => {
    const withTasks: SituationInput = {
      ...situation,
      tasks: [{ title: `Transfer the rent to ${IBAN}`, path: "Finance/Rent.md", due: "2026-10-01" }],
      events: [{ title: "Doctor: blood test results", start: "10:00" }],
    };
    const pack = await buildContextPackage(input({ situation: withTasks }), host());
    expect(ref(pack, "Finance/Rent.md").sensitive).toEqual(["credential", "account"]);
    expect(pack.situationHint).toEqual({ sensitive: ["health"] });
    const redacted = await buildContextPackage(input({ situation: withTasks, redact: new Set(["Finance/Rent.md", SITUATION_SOURCE]) }), host());
    expect(redacted.part.text).not.toContain("DE89 3704");
    expect(redacted.part.text).toContain("blood test");
  });

  it("screens a note's gist like its text, and leaves a folder's gist out when it holds something", async () => {
    const gists = {
      section: async () => null,
      note: async (path: string) => (path === "Finance/Rent.md" ? `Rent is paid to ${IBAN} monthly.` : null),
      area: async (area: string) => (area === "Finance" ? `Rent and bank details, account ${IBAN}.` : area === "Home" ? "Plants and chores." : null),
      vault: async () => null,
    };
    // Weak matches and no room for evidence or cards: every source is a handle in the map.
    const many = [[{ path: "Finance/Rent.md", title: "Rent", signals: { lexical: 0.2 } }, ...Array.from({ length: 3 }, (_, i) => ({ path: `Home/N${i}.md`, title: `N${i}`, signals: { lexical: 0.1 } }))]];
    const pack = await buildContextPackage(input({ question: "chores", candidates: many, budget: { evidence: 0, cards: 0 } }), host({ gists }));
    expect(ref(pack, "Finance/Rent.md")).toMatchObject({ tier: "map", gist: true, sensitive: ["account"] });
    expect(pack.part.text).not.toContain("account DE89");
    expect(pack.part.text).toContain("Plants and chores.");
  });

  it("raises no hint for a model on this computer", async () => {
    const pack = await buildContextPackage(input({ recipient: local }), host());
    expect(pack.refs.some((r) => "sensitive" in r)).toBe(false);
    expect(pack.sensitive).toBeUndefined();
  });

  it("brings the overview back for a kind the session has not approved", async () => {
    const pack = await buildContextPackage(input({ candidates: found("Home/Plants.md") }), host());
    const plain = manifestOf(pack, { id: "p", label: "P", local: false }, "m", { tools: [] });
    const scope = widenScope(null, plain);
    const rent = manifestOf(await buildContextPackage(input(), host()), { id: "p", label: "P", local: false }, "m", { tools: [] });
    expect(scopeGrowth(rent, scope)).toContainEqual({ kind: "sensitive", sensitive: ["credential", "account", "health"] });
    expect(scopeGrowth(rent, widenScope(scope, rent)).some((g) => g.kind === "sensitive")).toBe(false);
  });
});
