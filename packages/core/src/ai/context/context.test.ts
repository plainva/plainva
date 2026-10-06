import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "../../frontmatter-surgical.js";
import type { EgressRecipient } from "../egressGate.js";
import { readConversationRecord } from "../history.js";
import { DEFAULT_AI_POLICY, effectivePolicy, notePolicyFrom, parsePolicyFile } from "../policy.js";
import { approveToolData, manifestOf, scopeGrowth, toolDataApproved, widenScope } from "./manifest.js";
import { buildContextPackage, sentStamps, type ContextBuildHost, type SituationInput } from "./package.js";
import { mergeCandidates, rankCandidates, recencySignal, urgencySignal } from "./ranking.js";
import { sectionAt, sectionOf } from "./sections.js";
import { withholdPlaces, withoutSensitiveProperties } from "./sensitive.js";
import { questionTerms } from "./terms.js";

const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const local: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };

const files: Record<string, string> = {
  "Projects/Offer.md": "# Offer\n\nIntro text.\n\n## Costs\n\nRates as in [[Salaries]]; hourly rate 95.\n\n## Timeline\n\nStart in October.",
  "Private/Salaries.md": "# Salaries\n\nsecret salaries",
  "Journal/2026-09-28.md": "# Monday\n\n- 09:12 Walk\n📍 52.5200, 13.4050\n\nSee [[Salaries]].",
  "Notes/Pinned.md": "---\nstatus: done\n---\nA pinned note, whole.",
  "Notes/Draft.md": "# Draft\n\nnothing yet",
  ".agent/skills/offer-check/SKILL.md": "---\nname: offer-check\ndescription: x\n---\n\nskill instructions\n\n- [ ] skill step",
};
const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n").rules;

function host(overrides: Partial<Record<string, string>> = {}, editor: Record<string, string> = {}): ContextBuildHost {
  const text = (path: string) => editor[path] ?? overrides[path] ?? files[path] ?? null;
  return {
    async policyOf(path, content) {
      const source = content ?? text(path) ?? "";
      const plainva = readFrontmatterPath(source, ["plainva"]);
      return effectivePolicy(path, notePolicyFrom(plainva === undefined ? {} : { plainva }), rules, DEFAULT_AI_POLICY);
    },
    async resolveLink(target) {
      const hit = Object.keys(files).find((p) => p.endsWith(`/${target}.md`) || p === `${target}.md`);
      return hit ?? null;
    },
    async readNote(path) {
      const t = text(path);
      return t === null ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text: t };
    },
  };
}

const situation = (patch: Partial<SituationInput> = {}): SituationInput => ({
  now: "2026-09-28 16:40",
  weekday: "Monday",
  calendarDay: "2026-09-28",
  journalDay: "2026-09-28",
  active: { path: "Projects/Offer.md", title: "Offer", kind: "note", heading: "Offer > Costs", properties: { status: "draft", mood: 4, plainva: { ai: {} } } },
  tabs: [{ path: "Notes/Draft.md", title: "Draft" }],
  tasks: [{ title: "Send offer", path: "Projects/Offer.md", due: "2026-09-27" }],
  events: [{ title: "Standup", start: "10:00", end: "10:15", calendar: "Work" }],
  dailyNote: { path: "Journal/2026-09-28.md", title: "2026-09-28" },
  ...patch,
});

describe("question terms", () => {
  it("keeps the words that can find a note, in order, once", () => {
    expect(questionTerms("Where did I put the offer for Müller? The OFFER!")).toEqual(["put", "offer", "müller"]);
    expect(questionTerms("Wo ist das Angebot für Müller?")).toEqual(["angebot", "müller"]);
    expect(questionTerms("会议记录在哪里")).toEqual(["会议记录在哪里"]);
  });
});

describe("sensitive classes", () => {
  it("withholds place stamps and mood properties, never the plainva namespace", () => {
    const out = withholdPlaces("- 09:12 Walk\n📍 52.5200, 13.4050\n> 📍 -33.9, 151.2 (Sydney)\nno 📍 here, 1");
    expect(out.withheld).toBe(2);
    expect(out.text).not.toMatch(/52\.52|151\.2/);
    expect(out.text).toContain("no 📍 here, 1");
    const props = withoutSensitiveProperties({ status: "draft", Stimmung: 3, energy: 2, plainva: { ai: {} } }, "energy");
    expect(props.properties).toEqual({ status: "draft" });
    expect(props.withheld).toBe(2);
  });
});

describe("ranking", () => {
  it("decays recency, weighs urgency and merges the sources per path", () => {
    expect(recencySignal(0, 1000)).toBe(1);
    expect(recencySignal(1000, 1000)).toBeCloseTo(0.5);
    expect(urgencySignal("2026-09-27", "2026-09-28")).toBe(1);
    expect(urgencySignal("2026-10-05", "2026-09-28")).toBeCloseTo(1 - 7 / 15);
    expect(urgencySignal(null, "2026-09-28")).toBe(0);
    const merged = mergeCandidates([[{ path: "a.md", title: "a", signals: { lexical: 0.4 } }], [{ path: "a.md", title: "a", signals: { lexical: 0.9, opened: 0.2 }, snippet: "s" }]]);
    expect(merged).toEqual([{ path: "a.md", title: "a", signals: { lexical: 0.9, opened: 0.2 }, snippet: "s" }]);
  });

  it("orders by score and keeps one folder from filling the lead", () => {
    const many = [1, 2, 3, 4, 5].map((i) => ({ path: `Crowd/n${i}.md`, title: `n${i}`, signals: { lexical: 1 - i / 100 } }));
    const ranked = rankCandidates([...many, { path: "Other/x.md", title: "x", signals: { lexical: 0.5 } }, { path: "Crowd/open.md", title: "open", signals: { active: 1 } }], { perFolder: 2 });
    expect(ranked.map((c) => c.path).slice(0, 4)).toEqual(["Crowd/open.md", "Crowd/n1.md", "Crowd/n2.md", "Other/x.md"]);
    expect(ranked[0]!.reasons).toEqual(["active"]);
  });
});

describe("sections", () => {
  it("finds the section around a line and by its handle", () => {
    const body = files["Projects/Offer.md"]!;
    expect(sectionAt(body, 6)).toEqual({ chain: "Offer > Costs", text: "## Costs\n\nRates as in [[Salaries]]; hourly rate 95.\n" });
    expect(sectionOf(body, "offer > timeline")).toBe("## Timeline\n\nStart in October.");
    expect(sectionAt("no heading\n# A", 0)).toEqual({ chain: "", text: "no heading" });
  });
});

describe("the context package", () => {
  it("never lets a denied note in, whatever it would have scored (hard-gate eval)", async () => {
    const maxed = { path: "Private/Salaries.md", title: "Salaries", signals: { active: 1, pinned: 1, lexical: 1, graph: 1, opened: 1, edited: 1, urgency: 1, daily: 1, tab: 1 }, snippet: "secret salaries" };
    const pack = await buildContextPackage(
      {
        question: "What are the salaries?",
        recipient: cloud,
        situation: situation({ tabs: [{ path: "Private/Salaries.md", title: "Salaries" }], tasks: [{ title: "Pay", path: "Private/Salaries.md", due: "2026-09-28" }] }),
        candidates: [[maxed]],
        pins: ["Private/Salaries.md"],
      },
      host(),
    );
    expect(pack.refs.map((r) => r.path)).not.toContain("Private/Salaries.md");
    expect(pack.part.text).not.toMatch(/Salaries|salaries|Private\//);
    expect(pack.part.text).not.toContain("Pay");
    expect(pack.excluded).toEqual([{ path: "Private/Salaries.md", reason: "cloud-denied", source: { kind: "folder", folder: "Private/" } }]);
    // A link to it inside an allowed note is withheld, not resolved.
    expect(pack.redactions.withheldLinks).toBeGreaterThan(0);
  });

  it("never sends anything below .agent/ as data — not the open skill file, a pin, a tab, a task or a candidate, to any recipient", async () => {
    const skill = ".agent/skills/offer-check/SKILL.md";
    for (const recipient of [cloud, local]) {
      const pack = await buildContextPackage(
        {
          question: "skill instructions",
          recipient,
          situation: situation({ active: { path: skill, title: "SKILL", kind: "note" }, tabs: [{ path: skill, title: "SKILL" }], tasks: [{ title: "skill step", path: skill, due: "2026-09-28" }] }),
          candidates: [[{ path: skill, title: "SKILL", signals: { lexical: 1, semantic: 1 } }]],
          pins: [skill],
        },
        host(),
      );
      expect(pack.refs.map((r) => r.path)).not.toContain(skill);
      expect(pack.part.text).not.toMatch(/skill instructions|skill step|\.agent/);
      // Not a privacy exclusion the overview would list: the folder is simply no data.
      expect(pack.excluded.map((e) => e.path)).not.toContain(skill);
    }
  });

  it("sends the open note's section, the situation and handles — and a local model may see the denied note", async () => {
    const pack = await buildContextPackage(
      { question: "What is the hourly rate?", recipient: cloud, situation: situation(), candidates: [[{ path: "Notes/Draft.md", title: "Draft", signals: { edited: 0.9 } }]], pins: [] },
      host(),
    );
    expect(pack.part.text).toContain("Now: Monday, 2026-09-28 16:40");
    expect(pack.part.text).toContain('The cursor is in the section "Offer > Costs".');
    expect(pack.part.text).toContain("hourly rate 95");
    expect(pack.part.text).toContain("Rates as in ⟦withheld note⟧");
    expect(pack.part.text).toContain("status: draft");
    expect(pack.part.text).not.toMatch(/mood/);
    expect(pack.part.text).toContain("- [ ] Send offer (due 2026-09-27, overdue) — in [[Offer]]");
    expect(pack.part.text).toContain("- 10:00–10:15 Standup (Work)");
    expect(pack.part.text).not.toMatch(/52\.52/);
    expect(pack.redactions.moodProperties).toBe(1);
    expect(pack.dataClasses.sort()).toEqual(["calendar", "notes", "situation", "tasks"]);
    const evidence = pack.refs.find((r) => r.path === "Projects/Offer.md")!;
    expect(evidence.tier).toBe("evidence");
    expect(pack.refs.find((r) => r.path === "Notes/Draft.md")!.tier).toBe("card");
    expect(pack.part.context!.length).toBe(1);

    const forLocal = await buildContextPackage(
      { question: "salaries", recipient: local, situation: situation({ active: null }), candidates: [[{ path: "Private/Salaries.md", title: "Salaries", signals: { lexical: 1 } }]], pins: [] },
      host(),
    );
    expect(forLocal.part.text).toContain("secret salaries");
    expect(forLocal.excluded).toEqual([]);
  });

  it("keeps a note that must never meet the internet out of a conversation with the web tools — for a model on this device too", async () => {
    const overrides = {
      "Notes/Draft.md": "---\nplainva:\n  ai:\n    web: deny\n---\n# Draft\n\nnever on the web",
      "Projects/Offer.md": files["Projects/Offer.md"]!.replace("[[Salaries]]", "[[Draft]]"),
    };
    const input = {
      question: "the open points",
      situation: situation({ tabs: [], dailyNote: null }),
      candidates: [[{ path: "Notes/Draft.md", title: "Draft", signals: { lexical: 1 } }]],
      pins: ["Notes/Draft.md"],
    };
    // Without the web tools the rule says nothing: the note goes, to a cloud as well.
    const plain = await buildContextPackage({ ...input, recipient: cloud }, host(overrides));
    expect(plain.part.text).toContain("never on the web");
    expect(plain.excluded).toEqual([]);
    for (const recipient of [cloud, local]) {
      const pack = await buildContextPackage({ ...input, recipient, webTools: true }, host(overrides));
      expect(pack.refs.map((r) => r.path), recipient.kind).not.toContain("Notes/Draft.md");
      expect(pack.part.text, recipient.kind).not.toMatch(/never on the web|Draft/);
      expect(pack.excluded, recipient.kind).toMatchObject([{ path: "Notes/Draft.md", reason: "web-denied" }]);
      // The link to it in the open note is withheld — for a model on this device too, which could carry the name out in a search.
      expect(pack.part.text, recipient.kind).toContain("Rates as in ⟦withheld note⟧");
    }
  });

  it("checks the exact text that would go: an unsaved cloud: deny keeps the note out", async () => {
    const editor = { "Projects/Offer.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Offer\n\nhourly rate 95" };
    const pack = await buildContextPackage({ question: "hourly rate", recipient: cloud, situation: situation({ tasks: [] }), candidates: [], pins: [] }, host({}, editor));
    expect(pack.part.text).not.toContain("hourly rate 95");
    expect(pack.refs.map((r) => r.path)).not.toContain("Projects/Offer.md");
    expect(pack.excluded.map((e) => e.path)).toContain("Projects/Offer.md");
  });

  it("sends a pinned note whole, names an unchanged section instead of repeating it, and skips vanished notes", async () => {
    const first = await buildContextPackage({ question: "anything", recipient: cloud, situation: situation({ active: null, tasks: [], events: [] }), candidates: [], pins: ["Notes/Pinned.md"] }, host());
    expect(first.part.text).toContain("the whole note");
    expect(first.part.text).not.toContain("status: done");
    const again = await buildContextPackage(
      { question: "anything", recipient: cloud, situation: situation({ active: null, tasks: [], events: [] }), candidates: [[{ path: "Gone.md", title: "Gone", signals: { lexical: 1 } }]], pins: ["Notes/Pinned.md"], alreadySent: sentStamps([{ role: "user", parts: [first.part] }]) },
      host(),
    );
    expect(again.part.text).toContain("unchanged since it was sent earlier");
    expect(again.part.text).not.toContain("A pinned note, whole.");
    expect(again.refs.map((r) => r.path)).not.toContain("Gone.md");
  });
});

describe("the send overview", () => {
  it("asks on the first request and whenever the scope grows, never for a local server", async () => {
    const pack = await buildContextPackage({ question: "hourly rate", recipient: cloud, situation: situation(), candidates: [], pins: [] }, host());
    const manifest = manifestOf(pack, { id: "p", label: "Provider", local: false }, "m", { tools: ["search_vault"], questionChars: 20, priceUsdPerMillionInput: 3 });
    expect(manifest.folders).toEqual(["Journal", "Notes", "Projects"]);
    expect(manifest.withheld.notes).toBe(1);
    expect(manifest.estimatedCostUsd).toBeGreaterThan(0);
    expect(scopeGrowth(manifest, null)).toEqual([{ kind: "first" }]);
    const scope = widenScope(null, manifest);
    expect(scopeGrowth(manifest, scope)).toEqual([]);
    expect(scopeGrowth({ ...manifest, model: "m2" }, scope)).toEqual([{ kind: "recipient", recipient: "p/m2" }]);
    expect(scopeGrowth({ ...manifest, folders: [...manifest.folders, "Finance"] }, scope)).toEqual([{ kind: "folder", folder: "Finance" }]);
    expect(scopeGrowth({ ...manifest, dataClasses: [...manifest.dataClasses, "selection"] }, scope)).toEqual([{ kind: "dataClass", dataClass: "selection" }]);
    expect(scopeGrowth({ ...manifest, tools: ["search_vault", "read_note"] }, scope)).toEqual([{ kind: "tools", tools: ["read_note"] }]);
    expect(scopeGrowth({ ...manifest, estimatedTokens: scope.maxTokens * 4 + 5000 }, scope)[0]!.kind).toBe("size");
    expect(scopeGrowth({ ...manifest, local: true }, null)).toEqual([]);
  });

  it("keeps an approval given in a conversation for the recipient it was given for, and for no other", async () => {
    const pack = await buildContextPackage({ question: "hourly rate", recipient: cloud, situation: situation(), candidates: [], pins: [] }, host());
    const manifest = manifestOf(pack, { id: "p", label: "Provider", local: false }, "m", { tools: ["search_vault"] });
    let scope = widenScope(null, manifest);
    expect(toolDataApproved(scope, "mail", "p/m")).toBe(false);
    expect(toolDataApproved(null, "mail", "p/m")).toBe(false);
    scope = approveToolData(scope, "mail", "p/m");
    expect(toolDataApproved(scope, "mail", "p/m")).toBe(true);
    // Another model, another provider, another kind of data: each its own question.
    expect([toolDataApproved(scope, "mail", "p/m2"), toolDataApproved(scope, "mail", "q/m"), toolDataApproved(scope, "calendar", "p/m")]).toEqual([false, false, false]);
    // Approving twice changes nothing, and the next request's overview neither withdraws nor widens it.
    expect(approveToolData(scope, "mail", "p/m")).toBe(scope);
    const later = widenScope(scope, { ...manifest, model: "m2" });
    expect(later.recipients).toEqual(["p/m", "p/m2"]);
    expect([toolDataApproved(later, "mail", "p/m"), toolDataApproved(later, "mail", "p/m2")]).toEqual([true, false]);
    // It is no growth of a request's scope: the overview has nothing to show for it.
    expect(scopeGrowth(manifest, scope)).toEqual([]);
    // Asked before any request was approved, it starts a scope of its own.
    expect(approveToolData(null, "mail", "p/m")).toMatchObject({ recipients: [], toolData: ["mail>p/m"] });
  });

  it("names the internet where the conversation may use it, with the sites that need no asking — and asks when it is new", async () => {
    const pack = await buildContextPackage({ question: "hourly rate", recipient: cloud, situation: situation(), candidates: [], pins: [], webTools: true }, host());
    const provider = { id: "p", label: "Provider", local: false };
    const without = manifestOf(pack, provider, "m", { tools: ["search_vault"] });
    expect([without.web, without.webHosts]).toEqual([false, undefined]);
    // Sites without the internet say nothing.
    expect(manifestOf(pack, provider, "m", { tools: ["search_vault"], webHosts: ["example.org"] }).webHosts).toBeUndefined();
    const web = manifestOf(pack, provider, "m", { tools: ["search_vault", "fetch_url"], web: true, webHosts: ["example.org"] });
    expect(web).toMatchObject({ web: true, webHosts: ["example.org"] });
    const scope = widenScope(null, without);
    expect(scopeGrowth(web, scope)).toEqual([{ kind: "tools", tools: ["fetch_url"] }, { kind: "web" }]);
    expect(scopeGrowth(web, widenScope(scope, web))).toEqual([]);
    // The record of a run keeps both.
    const stored = readConversationRecord(
      JSON.parse(
        JSON.stringify({
          version: 1,
          id: "c1",
          title: "t",
          createdAt: "2026-10-06T10:00:00Z",
          updatedAt: "2026-10-06T10:00:00Z",
          providerId: "p",
          model: "m",
          conversation: { id: "c1", system: "s", tools: ["fetch_url"], turns: [] },
          runs: [{ userTurn: 0, providerId: "p", model: "m", sent: [], kept: [], steps: 1, stop: "answered", manifest: web }],
        }),
      ),
    )!;
    expect(stored.runs[0]!.manifest).toMatchObject({ web: true, webHosts: ["example.org"] });
  });
});
