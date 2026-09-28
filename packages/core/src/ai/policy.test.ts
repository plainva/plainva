import { describe, expect, it } from "vitest";
import { DEFAULT_AI_POLICY, effectivePolicy, ENCRYPTED_WORKSPACE_AI_POLICY, normalizeFolder, notePolicyFrom, parsePolicyFile } from "./policy.js";
import { gateDecision, hardGate, redactDeniedLinks, WITHHELD_LINK, type GateRun } from "./egressGate.js";

const cloudRun: GateRun = { recipient: { kind: "cloud", provider: "anthropic", model: "m" }, webTools: false };
const localRun: GateRun = { recipient: { kind: "local", provider: "ollama", model: "m" }, webTools: false };

describe("note policy", () => {
  it("reads plainva.ai from frontmatter, booleans included", () => {
    expect(notePolicyFrom({ plainva: { ai: { cloud: "deny", web: "allow" } } })).toEqual({ cloud: "deny", web: "allow" });
    expect(notePolicyFrom({ plainva: { ai: { cloud: false } } })).toEqual({ cloud: "deny" });
  });

  it("has no opinion about anything that is not the documented shape", () => {
    for (const fm of [null, "x", {}, { plainva: "ai" }, { plainva: { ai: "deny" } }, { plainva: { ai: { cloud: "maybe" } } }, { ai: { cloud: "deny" } }]) {
      expect(notePolicyFrom(fm)).toEqual({});
    }
  });
});

describe("policy file", () => {
  it("parses folder rules and normalises their paths", () => {
    const parsed = parsePolicyFile("folders:\n  Private: { cloud: deny }\n  'Work\\\\Clients/': { web: deny, cloud: allow }\n");
    expect(parsed.problems).toEqual([]);
    expect(parsed.rules).toEqual([
      { folder: "Private/", cloud: "deny" },
      { folder: "Work/Clients/", web: "deny", cloud: "allow" },
    ]);
  });

  it("never widens anything when broken", () => {
    expect(parsePolicyFile("folders: [").rules).toEqual([]);
    expect(parsePolicyFile("folders: [a, b]").problems).toEqual(["`folders` is not a mapping"]);
    const bad = parsePolicyFile("folders:\n  ../Outside: { cloud: allow }\n  Notes: { cloud: sometimes }\n");
    expect(bad.rules).toEqual([{ folder: "Notes/" }]);
    expect(bad.problems).toHaveLength(2);
  });

  it("normalises folders", () => {
    expect(normalizeFolder("./A\\B")).toBe("A/B/");
    expect(normalizeFolder("/")).toBe("");
  });
});

describe("effective policy", () => {
  const rules = parsePolicyFile("folders:\n  Private/: { cloud: deny }\n  Private/Shared/: { cloud: allow }\n  Research/: { web: deny }\n").rules;

  it("the note wins, then the nearest folder, then the default", () => {
    expect(effectivePolicy("Private/diary.md", {}, rules).policy.cloud).toBe("deny");
    expect(effectivePolicy("Private/Shared/plan.md", {}, rules).policy.cloud).toBe("allow");
    expect(effectivePolicy("Private/diary.md", { cloud: "allow" }, rules).policy.cloud).toBe("allow");
    expect(effectivePolicy("Other/x.md", {}, rules)).toEqual({ policy: DEFAULT_AI_POLICY, sources: { cloud: { kind: "default" }, web: { kind: "default" } } });
  });

  it("resolves each dimension on its own and names its source", () => {
    const e = effectivePolicy("Research/Private/x.md", { cloud: "deny" }, rules);
    expect(e.policy).toEqual({ cloud: "deny", web: "deny" });
    expect(e.sources).toEqual({ cloud: { kind: "note" }, web: { kind: "folder", folder: "Research/" } });
  });

  it("a denial reaches every spelling of its folder, a permission only its own", () => {
    expect(effectivePolicy("private/diary.md", {}, rules).policy.cloud).toBe("deny");
    const allowOnly = parsePolicyFile("folders:\n  Public/: { cloud: allow }\n").rules;
    expect(effectivePolicy("public/x.md", {}, allowOnly, ENCRYPTED_WORKSPACE_AI_POLICY).policy.cloud).toBe("deny");
    expect(effectivePolicy("Public/x.md", {}, allowOnly, ENCRYPTED_WORKSPACE_AI_POLICY).policy.cloud).toBe("allow");
  });

  it("compares Unicode paths in one normal form (macOS hands out decomposed names)", () => {
    const composedRules = parsePolicyFile("folders:\n  Privát/: { cloud: deny }\n").rules;
    expect(effectivePolicy("Privát/x.md", {}, composedRules).policy.cloud).toBe("deny");
  });

  it("encrypted workspaces default to no cloud and no web", () => {
    expect(effectivePolicy("x.md", {}, [], ENCRYPTED_WORKSPACE_AI_POLICY).policy).toEqual({ cloud: "deny", web: "deny" });
  });
});

describe("hard gate", () => {
  const policies: Record<string, ReturnType<typeof effectivePolicy>> = {
    "a.md": effectivePolicy("a.md", {}, []),
    "secret.md": effectivePolicy("secret.md", { cloud: "deny" }, []),
    "offline.md": effectivePolicy("offline.md", { web: "deny" }, []),
  };
  const candidates = [{ path: "a.md", score: 1 }, { path: "secret.md", score: 9 }, { path: "offline.md", score: 3 }, { path: "secret.md", score: 2 }];

  it("removes what the recipient may not get, before any ranking", () => {
    const result = hardGate(candidates, (c) => c.path, (p) => policies[p]!, cloudRun);
    expect(result.allowed.map((c) => c.path)).toEqual(["a.md", "offline.md"]);
    expect(result.excluded).toEqual([{ path: "secret.md", reason: "cloud-denied", source: { kind: "note" } }]);
  });

  it("local models are not cloud recipients", () => {
    expect(hardGate(candidates, (c) => c.path, (p) => policies[p]!, localRun).allowed).toHaveLength(4);
    expect(gateDecision(policies["secret.md"]!, { recipient: { kind: "platform-device", provider: "apple", model: "m" }, webTools: false }).allowed).toBe(true);
    expect(gateDecision(policies["secret.md"]!, { recipient: { kind: "platform-cloud", provider: "apple", model: "m" }, webTools: false }).allowed).toBe(false);
  });

  it("web: deny keeps a note out of any run with web tools, local or not", () => {
    expect(gateDecision(policies["offline.md"]!, { ...localRun, webTools: true })).toEqual({ allowed: false, reason: "web-denied", source: { kind: "note" } });
  });
});

describe("withheld links", () => {
  const denied = (target: string) => /^(Private\/)?Diary( 2026)?(\.md)?$/.test(target);

  it("removes every way to name a denied note, and only those", () => {
    const text = "See [[Diary 2026]], [[Diary 2026#March|March]], ![[Diary 2026]] and [it](Private/Diary%202026.md#x), but [[Plan]] and [site](https://example.org/Diary).";
    const { text: out, redacted } = redactDeniedLinks(text, denied);
    expect(redacted).toBe(4);
    expect(out).toBe(`See ${WITHHELD_LINK}, ${WITHHELD_LINK}, ${WITHHELD_LINK} and ${WITHHELD_LINK}, but [[Plan]] and [site](https://example.org/Diary).`);
  });
});
