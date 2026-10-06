import { describe, expect, it } from "vitest";
import { utf8Encode } from "../../workspace/encoding.js";
import { isAiHiddenPath } from "../hiddenPaths.js";
import { TOOL_MANIFESTS } from "../tools.js";
import {
  approveInstruction,
  EMPTY_INSTRUCTION_APPROVALS,
  instructionStatus,
  pruneInstructionApprovals,
  readInstructionApprovals,
  revokeInstruction,
  serializeInstructionApprovals,
  switchInstruction,
} from "./approvals.js";
import { catalogEntry, pendingInstructions, resolveInstructions, skillCatalog, SKILL_CATALOG_MAX_CHARS } from "./catalog.js";
import { skillGrant, withinFolders } from "./narrowing.js";
import { blockingProblems, parseSkillFile, serializeSkillFile, type SkillDefinition } from "./skillFile.js";
import { appSkillSource, scanInstruction, scanVaultInstructions, SKILL_MAX_FILES, type InstructionIO } from "./sources.js";

const skillText = (front: string, body = "Do the thing.") => `---\n${front}\n---\n\n${body}\n`;
const codes = (text: string, folder?: string) => parseSkillFile(text, folder).problems.map((p) => p.code);

describe("SKILL.md as the Agent Skills format writes it", () => {
  it("reads the six fields and the instructions", () => {
    const { skill, problems } = parseSkillFile(
      skillText(
        [
          "name: offer-check",
          "description: Checks an offer against last year's rates. Use when an offer is open.",
          "license: CC0-1.0",
          "compatibility: Plainva 0.9 or later",
          "allowed-tools: search_vault read_note",
          "metadata:",
          '  plainva.version: "2"',
          "  author: someone",
        ].join("\n"),
        "## Steps\n\n1. Read the offer.",
      ),
      "offer-check",
    );
    expect(problems).toEqual([]);
    expect(skill).toMatchObject({
      name: "offer-check",
      license: "CC0-1.0",
      compatibility: "Plainva 0.9 or later",
      allowedTools: ["search_vault", "read_note"],
      metadata: { "plainva.version": "2", author: "someone" },
      body: "## Steps\n\n1. Read the offer.",
      plainva: { version: "2" },
    });
  });

  it("follows the reference validator on names", () => {
    expect(codes(skillText("name: Offer\ndescription: x"), "Offer")).toContain("name-uppercase");
    expect(codes(skillText("name: -offer\ndescription: x"), "-offer")).toContain("name-hyphen");
    expect(codes(skillText("name: offer--check\ndescription: x"), "offer--check")).toContain("name-hyphen");
    expect(codes(skillText("name: offer_check\ndescription: x"), "offer_check")).toContain("name-characters");
    expect(codes(skillText(`name: ${"a".repeat(65)}\ndescription: x`))).toContain("name-too-long");
    expect(codes(skillText("name: offer\ndescription: x"), "offers")).toContain("name-folder");
    // Letters of any script are allowed, as `skills-ref` allows them.
    expect(codes(skillText("name: übersicht\ndescription: x"), "übersicht")).toEqual([]);
    expect(codes(skillText("description: x"))).toContain("name-missing");
  });

  it("reports what the format does not allow, and never throws", () => {
    expect(codes("no frontmatter")).toEqual(["frontmatter-missing"]);
    expect(codes("---\nname: a\n")).toEqual(["frontmatter-unclosed"]);
    expect(codes("---\n[a, b\n---\n")).toEqual(["frontmatter-yaml"]);
    expect(codes("---\n- a\n---\n")).toEqual(["frontmatter-not-map"]);
    expect(codes(skillText("name: a\ndescription: x\nversion: 2"), "a")).toEqual(["field-unknown"]);
    expect(codes(skillText("name: a"), "a")).toEqual(["description-missing"]);
    expect(codes(skillText(`name: a\ndescription: ${"d".repeat(1025)}`), "a")).toEqual(["description-too-long"]);
    expect(codes(skillText(`name: a\ndescription: x\ncompatibility: ${"c".repeat(501)}`), "a")).toEqual(["compatibility-too-long"]);
    expect(codes(skillText("name: a\ndescription: x\nmetadata: [1, 2]"), "a")).toEqual(["metadata-not-map"]);
    expect(codes(skillText("name: a\ndescription: x\nmetadata:\n  list: [1]"), "a")).toEqual(["field-not-text"]);
  });

  it("reads scalars as text, as strictyaml does, and keeps a body with rules in it", () => {
    const { skill, problems } = parseSkillFile(`\uFEFF${skillText("name: a\ndescription: 42\nmetadata:\n  plainva.version: 3", "One\n\n---\n\nTwo")}`, "a");
    expect(problems).toEqual([]);
    expect(skill!.description).toBe("42");
    expect(skill!.metadata["plainva.version"]).toBe("3");
    expect(skill!.body).toBe("One\n\n---\n\nTwo");
    expect(skill!.allowedTools).toBeNull();
  });

  it("reads Plainva's metadata defensively — what does not parse is dropped and reported", () => {
    const { skill, problems } = parseSkillFile(
      skillText(
        [
          "name: a",
          "description: x",
          "metadata:",
          "  plainva.risk: read",
          "  plainva.data-classes: notes tasks moods",
          '  plainva.folders: "Projekte/, Kunden, ../out"',
          '  plainva.budget-tokens: "4000"',
          "  plainva.local: preferred",
          "  plainva.argument: project",
          "  plainva.argument-description: The project's name",
          "  plainva.title: Angebot prüfen",
          "  plainva.tests: tests/scenarios.json",
        ].join("\n"),
      ),
      "a",
    );
    expect(skill!.plainva).toEqual({
      risk: "read",
      dataClasses: ["notes", "tasks"],
      folders: ["Projekte/", "Kunden/"],
      budgetTokens: 4000,
      localPreferred: true,
      argument: { name: "project", description: "The project's name" },
      title: "Angebot prüfen",
      tests: "tests/scenarios.json",
    });
    // The unknown data class is reported; it narrows rather than being ignored.
    expect(problems).toEqual([{ code: "plainva-value", detail: "plainva.data-classes" }]);
    expect(blockingProblems(problems)).toEqual([]);
    const bad = parseSkillFile(skillText("name: a\ndescription: x\nmetadata:\n  plainva.risk: write\n  plainva.budget-tokens: lots\n  plainva.folders: ../"), "a");
    expect(bad.skill!.plainva).toEqual({ folders: [] });
    expect(bad.problems.map((p) => p.detail).sort()).toEqual(["plainva.budget-tokens", "plainva.folders", "plainva.risk"]);
  });

  it("writes a skill the reader reads back unchanged", () => {
    const text = serializeSkillFile({
      name: "offer-check",
      description: "Checks an offer: rates, deadlines.",
      body: "Read the offer.\n\nCompare: with 2025.",
      allowedTools: ["search_vault", "read_note"],
      metadata: { "plainva.version": "1", "plainva.title": "Angebot prüfen: schnell" },
    });
    const { skill, problems } = parseSkillFile(text, "offer-check");
    expect(problems).toEqual([]);
    expect(skill).toMatchObject({
      name: "offer-check",
      description: "Checks an offer: rates, deadlines.",
      body: "Read the offer.\n\nCompare: with 2025.",
      allowedTools: ["search_vault", "read_note"],
      metadata: { "plainva.version": "1", "plainva.title": "Angebot prüfen: schnell" },
    });
  });
});

describe("a skill creates no rights", () => {
  const def = (patch: Partial<SkillDefinition> & { plainva?: SkillDefinition["plainva"] } = {}): SkillDefinition => ({
    name: "a",
    description: "x",
    metadata: {},
    allowedTools: null,
    body: "",
    plainva: {},
    ...patch,
  });
  const all = TOOL_MANIFESTS.map((t) => t.name);

  it("only ever keeps tools the conversation carries, in its order", () => {
    // A small deterministic generator: every subset pattern of the known tools against random skills.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: readonly T[]) => xs.filter(() => rand() < 0.5);
    for (let i = 0; i < 500; i++) {
      const available = pick(all);
      const skill = def({
        allowedTools: rand() < 0.2 ? null : [...pick(all), ...(rand() < 0.3 ? ["Bash(git:*)", "write_note"] : [])],
        plainva: {
          ...(rand() < 0.4 ? { risk: rand() < 0.5 ? "read" : "ui" } : {}),
          ...(rand() < 0.4 ? { dataClasses: pick(["notes", "structure", "tasks", "calendar", "commands"] as const) } : {}),
          ...(rand() < 0.3 ? { budgetTokens: Math.ceil(rand() * 100_000) } : {}),
        },
      });
      const grant = skillGrant(skill, available, 32_000);
      expect(grant.tools.every((t) => available.includes(t))).toBe(true);
      expect(grant.tools).toEqual(available.filter((t) => grant.tools.includes(t)));
      if (grant.maxOutputTokens !== null) expect(grant.maxOutputTokens).toBeLessThanOrEqual(32_000);
    }
  });

  it("narrows by the listed tools, the risk class and the data classes", () => {
    const available = ["search_vault", "read_note", "get_tasks", "get_calendar", "run_command"];
    expect(skillGrant(def({ allowedTools: ["read_note", "get_tasks", "Bash(git:*)"] }), available)).toEqual({
      tools: ["read_note", "get_tasks"],
      folders: null,
      maxOutputTokens: null,
      unknownTools: ["Bash(git:*)"],
    });
    expect(skillGrant(def({ plainva: { risk: "read" } }), available).tools).toEqual(["search_vault", "read_note", "get_tasks", "get_calendar"]);
    expect(skillGrant(def({ plainva: { dataClasses: ["notes"] } }), available).tools).toEqual(["search_vault", "read_note"]);
    expect(skillGrant(def({ plainva: { budgetTokens: 99_999 } }), available, 32_000).maxOutputTokens).toBe(32_000);
    expect(skillGrant(def({ plainva: { folders: ["Projekte/"] } }), available).folders).toEqual(["Projekte/"]);
  });

  it("reads folders as the MCP server's grants read them", () => {
    expect(withinFolders("Projekte/Angebot.md", ["Projekte/"])).toBe(true);
    expect(withinFolders("projekte/a.md", ["Projekte"])).toBe(true);
    expect(withinFolders("Projekte-Alt/a.md", ["Projekte/"])).toBe(false);
    expect(withinFolders("Café/a.md", ["Cafe\u0301/"])).toBe(true);
    expect(withinFolders("a.md", [])).toBe(false);
    expect(withinFolders("a.md", [""])).toBe(true);
  });
});

/** A vault as the scan reads it: paths to text. */
function memoryIO(files: Record<string, string>): InstructionIO & { files: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    async list(folder) {
      const prefix = `${folder}/`;
      const names = new Map<string, boolean>();
      for (const path of map.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names].map(([name, folder]) => ({ name, folder }));
    },
    async read(path) {
      const text = map.get(path);
      return text === undefined ? null : utf8Encode(text);
    },
  };
}

const OFFER = skillText("name: offer-check\ndescription: Checks an offer.\nallowed-tools: read_note");

describe("instructions in the vault, approved on this device", () => {
  it("scans skill folders with every file hashed, and a root AGENTS.md", async () => {
    const io = memoryIO({
      ".agent/skills/offer-check/SKILL.md": OFFER,
      ".agent/skills/offer-check/references/rates.md": "2025: 1850",
      ".agent/skills/offer-check/.DS_Store": "junk",
      ".agent/policy.yml": "folders: {}",
      "AGENTS.md": "Answer briefly.",
      "Notes/a.md": "x",
    });
    const sources = await scanVaultInstructions(io);
    expect(sources.map((s) => [s.id, s.kind, s.files.map((f) => f.path)])).toEqual([
      [".agent/skills/offer-check", "skill", ["SKILL.md", "references/rates.md"]],
      ["AGENTS.md", "agents", ["AGENTS.md"]],
    ]);
    expect(sources[0]!.skill!.name).toBe("offer-check");
    expect(sources[0]!.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sources[1]!.text).toBe("Answer briefly.");
  });

  it("leaves hidden entries out, so both shells hash the same skill", async () => {
    const files = {
      ".agent/skills/offer-check/SKILL.md": OFFER,
      ".agent/skills/offer-check/references/rates.md": "2025: 1850",
      // What a repository brings along, and what an interrupted write leaves behind.
      ".agent/skills/offer-check/.gitignore": "*.log",
      ".agent/skills/offer-check/.github/workflows/check.yml": "on: push",
      ".agent/skills/offer-check/references/.plainva-tmp-1": "half a file",
      // A hidden folder beside the skills is no skill.
      ".agent/skills/.drafts/SKILL.md": OFFER,
    };
    // The desktop lists every name; the phone's listing leaves dot-names out.
    const desktop = memoryIO(files);
    const phone: InstructionIO = { read: desktop.read, list: async (folder) => (await desktop.list(folder)).filter((entry) => !entry.name.startsWith(".")) };
    const [onDesktop, onPhone] = [await scanVaultInstructions(desktop), await scanVaultInstructions(phone)];
    expect(onDesktop.map((s) => [s.id, s.files.map((f) => f.path)])).toEqual([[".agent/skills/offer-check", ["SKILL.md", "references/rates.md"]]]);
    expect(onPhone).toEqual(onDesktop);
    // An approval binds these files only: a hidden one coming or going lifts nothing.
    const approved = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, onDesktop[0]!, "2026-10-06T10:00:00.000Z", "review");
    desktop.files.set(".agent/skills/offer-check/.plainva-tmp-2", "another");
    desktop.files.delete(".agent/skills/offer-check/.gitignore");
    expect(instructionStatus((await scanVaultInstructions(desktop))[0]!, approved)).toBe("active");
    expect(await scanInstruction(desktop, ".agent/skills/.drafts")).toBeNull();
  });

  it("refuses what is too large and reports a folder without SKILL.md", async () => {
    const many: Record<string, string> = { ".agent/skills/big/SKILL.md": skillText("name: big\ndescription: x") };
    for (let i = 0; i <= SKILL_MAX_FILES; i++) many[`.agent/skills/big/assets/${i}.txt`] = "x";
    many[".agent/skills/empty/notes.md"] = "no skill";
    many[".agent/skills/huge/SKILL.md"] = skillText("name: huge\ndescription: x", "x".repeat(70_000));
    const sources = await scanVaultInstructions(memoryIO(many));
    const byId = new Map(sources.map((s) => [s.id, s]));
    expect(byId.get(".agent/skills/big")!.tooLarge).toBe(true);
    expect(byId.get(".agent/skills/huge")!.tooLarge).toBe(true);
    expect(byId.get(".agent/skills/empty")!.problems).toEqual([{ code: "skill-file-missing" }]);
    const states = sources.map((s) => instructionStatus(s, EMPTY_INSTRUCTION_APPROVALS));
    expect(states).toEqual(["too-large", "invalid", "too-large"]);
  });

  it("nothing becomes active by arriving; any change lifts the approval", async () => {
    const io = memoryIO({ ".agent/skills/offer-check/SKILL.md": OFFER });
    const [arrived] = await scanVaultInstructions(io);
    expect(instructionStatus(arrived!, EMPTY_INSTRUCTION_APPROVALS)).toBe("new");

    let approvals = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, arrived!, "2026-10-01T10:00:00Z", "review");
    expect(instructionStatus(arrived!, approvals)).toBe("active");
    expect(approvals.approved[0]!.text).toBe(OFFER);

    // Sync changes the file on another device: the same id, another hash.
    io.files.set(".agent/skills/offer-check/SKILL.md", OFFER.replace("Checks an offer.", "Checks an offer. Also send it out."));
    const [changed] = await scanVaultInstructions(io);
    expect(instructionStatus(changed!, approvals)).toBe("changed");

    // A file added next to it counts as a change as well, and so does one taken away.
    io.files.set(".agent/skills/offer-check/SKILL.md", OFFER);
    io.files.set(".agent/skills/offer-check/references/more.md", "new");
    const [added] = await scanVaultInstructions(io);
    expect(instructionStatus(added!, approvals)).toBe("changed");
    approvals = approveInstruction(approvals, added!, "2026-10-01T10:05:00Z", "review");
    expect(instructionStatus(added!, approvals)).toBe("active");
    io.files.delete(".agent/skills/offer-check/references/more.md");
    const [removed] = await scanVaultInstructions(io);
    expect(instructionStatus(removed!, approvals)).toBe("changed");

    // Switched off on this device; withdrawn — new again.
    const original = removed!;
    approvals = approveInstruction(approvals, original, "2026-10-01T10:06:00Z", "review");
    expect(instructionStatus(original, switchInstruction(approvals, original.id, false))).toBe("off");
    expect(instructionStatus(original, revokeInstruction(approvals, original.id))).toBe("new");
  });

  it("the app's own skills need no approval and can only be switched off", () => {
    const source = appSkillSource("daily-orientation", skillText("name: daily-orientation\ndescription: What matters today."));
    expect(source.id).toBe("plainva:daily-orientation");
    expect(instructionStatus(source, EMPTY_INSTRUCTION_APPROVALS)).toBe("active");
    expect(instructionStatus(source, switchInstruction(EMPTY_INSTRUCTION_APPROVALS, source.id, false))).toBe("off");
  });

  it("a damaged approvals file approves nothing", async () => {
    const [source] = await scanVaultInstructions(memoryIO({ ".agent/skills/offer-check/SKILL.md": OFFER }));
    const good = approveInstruction(EMPTY_INSTRUCTION_APPROVALS, source!, "2026-10-01T10:00:00Z", "imported", { label: "offer-check.zip" });
    const stored = serializeInstructionApprovals(switchInstruction(good, "plainva:weekly-review", false));
    expect(readInstructionApprovals(stored)).toEqual(switchInstruction(good, "plainva:weekly-review", false));
    for (const raw of ["", "{", "null", '{"version":2,"approved":[]}', '{"version":1,"approved":[{"id":"x","files":{"SKILL.md":"nothex"},"at":"t"}]}']) {
      expect(readInstructionApprovals(raw).approved).toEqual([]);
    }
    expect(instructionStatus(source!, readInstructionApprovals("{"))).toBe("new");
  });

  it("forgets approvals of folders that are gone, never the app's switches", () => {
    let approvals = switchInstruction(EMPTY_INSTRUCTION_APPROVALS, "plainva:weekly-review", false);
    approvals = switchInstruction(approvals, ".agent/skills/gone", false);
    approvals = { ...approvals, approved: [{ id: ".agent/skills/gone", files: { "SKILL.md": "a".repeat(64) }, at: "t", how: "review" }] };
    expect(pruneInstructionApprovals(approvals, new Set())).toEqual({ approved: [], off: ["plainva:weekly-review"] });
  });
});

describe("the catalog", () => {
  const app = (name: string, description = `About ${name}.`) => appSkillSource(name, skillText(`name: ${name}\ndescription: ${description}`));

  it("lists the active skills, the app's first, and names a shared name by origin", async () => {
    const io = memoryIO({
      ".agent/skills/offer-check/SKILL.md": OFFER,
      ".agent/skills/daily-orientation/SKILL.md": skillText("name: daily-orientation\ndescription: My own day."),
      ".agent/skills/pending/SKILL.md": skillText("name: pending\ndescription: Not approved."),
    });
    const vault = await scanVaultInstructions(io);
    let approvals = EMPTY_INSTRUCTION_APPROVALS;
    for (const source of vault.filter((s) => s.id !== ".agent/skills/pending")) approvals = approveInstruction(approvals, source, "t", "review");
    const entries = resolveInstructions([...vault, app("weekly-review"), app("daily-orientation")], approvals);
    const catalog = skillCatalog(entries);
    // The app's skills in the order the app lists them, then the vault's by name.
    expect(catalog.entries.map((e) => e.key)).toEqual(["weekly-review", "plainva/daily-orientation", "vault/daily-orientation", "offer-check"]);
    expect(catalog.text).toContain("- offer-check: Checks an offer.");
    expect(catalog.text).not.toContain("pending");
    expect(catalog.tokens).toBeGreaterThan(0);
    expect(catalogEntry(catalog, "offer-check")!.id).toBe(".agent/skills/offer-check");
    expect(catalogEntry(catalog, "daily-orientation")).toBeNull();
    expect(pendingInstructions(entries).map((e) => e.source.id)).toEqual([".agent/skills/pending"]);
  });

  it("stays within its size; the rest can still be started by hand", () => {
    const many = Array.from({ length: 12 }, (_, i) => app(`skill-${String(i).padStart(2, "0")}`, "d".repeat(900)));
    const catalog = skillCatalog(resolveInstructions(many, EMPTY_INSTRUCTION_APPROVALS));
    expect(catalog.text.length).toBeLessThanOrEqual(SKILL_CATALOG_MAX_CHARS);
    expect(catalog.entries.length + catalog.omitted.length).toBe(12);
    expect(catalog.omitted.length).toBeGreaterThan(0);
  });

  it("is empty without active skills", () => {
    expect(skillCatalog([])).toEqual({ entries: [], text: "", tokens: 0, omitted: [] });
  });
});

describe("hidden roots", () => {
  it("are the root folders only, in any letter case", () => {
    expect(isAiHiddenPath(".agent/skills/a/SKILL.md")).toBe(true);
    expect(isAiHiddenPath("./.Agent/policy.yml")).toBe(true);
    expect(isAiHiddenPath(".plainva\\recents.json")).toBe(true);
    expect(isAiHiddenPath(".agentx/a.md")).toBe(false);
    expect(isAiHiddenPath("Notes/.agent/a.md")).toBe(false);
    expect(isAiHiddenPath("AGENTS.md")).toBe(false);
  });
});
