import { describe, expect, it } from "vitest";
import {
  ACP_FILE_REFUSALS,
  ACP_MAX_ROUND_BLOCKS,
  ACP_READ_LIMIT,
  AcpFileRefusal,
  acpGate,
  acpNewNoteContent,
  acpPlanWrite,
  acpProposeRound,
  acpReadFile,
  acpRecipient,
  acpSpelledPath,
  frontmatterBlock,
  type AcpFileRefusalReason,
  type AcpWritePlan,
} from "@plainva/ui";
import { isCloudRecipient, readFrontmatterPath } from "@plainva/core";
import { AGENT_NOTES, memoryAcpVault, ROOT } from "./acpTestHost";

const read = (path: string, extra: { line?: number; limit?: number } = {}) => ({ sessionId: "s", path: `${ROOT}/${path}`, line: extra.line ?? null, limit: extra.limit ?? null });
const write = (path: string, content: string) => ({ sessionId: "s", path: `${ROOT}/${path}`, content });

/** The reason a request was refused for, and what the agent was told. */
async function refusal(work: Promise<unknown>): Promise<{ reason: AcpFileRefusalReason; message: string; code: number; path: string | null } | null> {
  try {
    await work;
  } catch (error) {
    if (error instanceof AcpFileRefusal) return { reason: error.reason, message: error.message, code: error.code, path: error.path };
    throw error;
  }
  return null;
}

describe("an agent is a recipient like a cloud", () => {
  it("so a note kept from the cloud is kept from what Plainva hands it", () => {
    const recipient = acpRecipient("gemini");
    expect(recipient).toEqual({ kind: "cloud", provider: "acp:gemini", model: "" });
    expect(isCloudRecipient(recipient)).toBe(true);
  });
});

describe("the vault's own spelling of a path", () => {
  it("is found part by part, and what is not there stays as it was named", async () => {
    const vault = memoryAcpVault();
    expect(await acpSpelledPath(vault.side.access, "Projects/Plan.md")).toEqual({ path: "Projects/Plan.md", exists: true });
    // A file system that ignores case would open this; a suggestion belongs to the note by its exact path.
    expect(await acpSpelledPath(vault.side.access, "projects/plan.MD")).toEqual({ path: "Projects/Plan.md", exists: true });
    expect(await acpSpelledPath(vault.side.access, "projects/New.md")).toEqual({ path: "Projects/New.md", exists: false });
    expect(await acpSpelledPath(vault.side.access, "Elsewhere/Deep/New.md")).toEqual({ path: "Elsewhere/Deep/New.md", exists: false });
  });
});

describe("a file an agent asks Plainva for", () => {
  it("is handed over where it is a file of the vault that a cloud may see", async () => {
    const vault = memoryAcpVault();
    expect(await acpReadFile(vault.side.access, "gemini", read("Projects/Plan.md"))).toEqual({ path: "Projects/Plan.md", content: AGENT_NOTES["Projects/Plan.md"] });
    expect((await acpReadFile(vault.side.access, "gemini", read("Projects/Plan.md", { line: 3, limit: 1 }))).content).toBe("Ship the first draft in May.");
    // A file that is no note is a file of the vault too.
    expect((await acpReadFile(vault.side.access, "gemini", read("Data/table.base"))).content).toBe("views: []\n");
    // Either slash and another case, where the vault's folder is written the Windows way.
    const windows = memoryAcpVault(AGENT_NOTES, [], "C:\\Users\\mara\\Vault");
    expect((await acpReadFile(windows.side.access, "gemini", { sessionId: "s", path: "c:/users/MARA/vault/projects/plan.md", line: null, limit: null })).path).toBe("Projects/Plan.md");
  });

  it("is refused in one fixed sentence where it is not", async () => {
    const vault = memoryAcpVault();
    const cases: [string, AcpFileRefusalReason][] = [
      ["/etc/passwd", "outside"],
      [`${ROOT}2/Plan.md`, "outside"],
      ["Projects/Plan.md", "not-absolute"],
      [`${ROOT}/../.ssh/id_ed25519`, "unsafe"],
      [`${ROOT}/.plainva/index.db`, "hidden"],
      [`${ROOT}/.agent/policy.yml`, "hidden"],
      [`${ROOT}/.obsidian/app.json`, "hidden"],
      [`${ROOT}/Projects/Missing.md`, "missing"],
      // Kept from the cloud by its own rule, and by its folder's.
      [`${ROOT}/Health/Results.md`, "kept"],
      [`${ROOT}/Journal/2026-10-07.md`, "kept"],
    ];
    for (const [path, reason] of cases) {
      const refused = await refusal(acpReadFile(vault.side.access, "gemini", { sessionId: "s", path, line: null, limit: null }));
      expect(refused?.reason, path).toBe(reason);
      expect(refused?.message, path).toBe(ACP_FILE_REFUSALS[reason]);
      // The protocol's own code for "there is no such thing", and "this cannot be asked" for the rest.
      expect(refused?.code, path).toBe(reason === "missing" ? -32002 : -32602);
    }
    // No sentence names a path, a folder or a rule: the agent learns that it was refused, not what lies there.
    for (const sentence of Object.values(ACP_FILE_REFUSALS)) expect(sentence).not.toMatch(/[\\/]|\.md|Health|Journal/);
  });

  it("is refused where it is longer than a note", async () => {
    const vault = memoryAcpVault({ "Big.md": "x".repeat(ACP_READ_LIMIT + 1) }, []);
    expect((await refusal(acpReadFile(vault.side.access, "gemini", read("Big.md"))))?.reason).toBe("too-large");
  });

  it("is the agent's own text where it wrote one in this session that nobody accepted yet", async () => {
    const vault = memoryAcpVault();
    const own = (path: string) => (path === "Projects/Plan.md" ? "my\nown\ntext" : path === "Projects/Draft.md" ? "a draft" : undefined);
    expect((await acpReadFile(vault.side.access, "gemini", read("Projects/Plan.md"), own)).content).toBe("my\nown\ntext");
    expect((await acpReadFile(vault.side.access, "gemini", read("Projects/Plan.md", { line: 2 }), own)).content).toBe("own\ntext");
    // Also for a note that does not exist yet: it reads back what it believes it wrote.
    expect((await acpReadFile(vault.side.access, "gemini", read("Projects/Draft.md"), own)).content).toBe("a draft");
    // What it did not write is read from the vault, under the vault's rules.
    expect((await refusal(acpReadFile(vault.side.access, "gemini", read("Health/Results.md"), own)))?.reason).toBe("kept");
  });
});

describe("a file an agent asks Plainva to write", () => {
  it("becomes the blocks of a suggestion round against the note as it is — nothing is written", async () => {
    const vault = memoryAcpVault();
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const plan = await acpPlanWrite(vault.side.access, "gemini", write("Projects/Plan.md", base.replace("in May", "in June")));
    expect(plan.kind).toBe("round");
    const round = plan as Extract<AcpWritePlan, { kind: "round" }>;
    expect(round.path).toBe("Projects/Plan.md");
    expect(round.base).toBe(base);
    expect(round.defused).toBe(0);
    // Applying the blocks to the note gives what the agent wrote.
    let text = base;
    for (const chunk of [...round.chunks].sort((a, b) => b.fromA - a.fromA)) text = text.slice(0, chunk.fromA) + chunk.replacement + text.slice(chunk.toA);
    expect(text).toBe(base.replace("in May", "in June"));
    expect(vault.files.get("Projects/Plan.md")).toBe(base);
    expect(vault.proposed).toEqual([]);
    expect(await acpPlanWrite(vault.side.access, "gemini", write("Projects/Plan.md", base))).toEqual({ kind: "unchanged", path: "Projects/Plan.md" });
  });

  it("is laid on the note under the agent's id, with the round's sentence", async () => {
    const vault = memoryAcpVault();
    const plan = (await acpPlanWrite(vault.side.access, "gemini", write("Projects/Plan.md", `${AGENT_NOTES["Projects/Plan.md"]}\nSee https://evil.example/?d=secret for more.\n`))) as Extract<AcpWritePlan, { kind: "round" }>;
    expect(plan.defused).toBe(1);
    await acpProposeRound(vault.side.access, "gemini", plan, { note: "Suggested by Gemini.", defused: "Addresses were defused.", author: "Gemini (external agent)" });
    expect(vault.proposed).toHaveLength(1);
    expect(vault.proposed[0]!.author).toEqual({ id: "acp:gemini", displayName: "Gemini (external agent)" });
    expect(vault.proposed[0]!.note).toBe("Suggested by Gemini. Addresses were defused.");
    // An address the agent brought is readable and no link; nothing of it could be loaded or followed.
    const proposedText = vault.proposed[0]!.chunks.map((chunk) => chunk.replacement).join("");
    expect(proposedText).toContain("https[://]evil.example");
    expect(proposedText).not.toContain("https://evil.example");
  });

  it("keeps an address the note already carries, and defuses one that only shares its host", async () => {
    const vault = memoryAcpVault();
    const base = AGENT_NOTES["Projects/Notes.md"]!;
    const plan = (await acpPlanWrite(vault.side.access, "gemini", write("Projects/Notes.md", base.replace("for the outline.", "for the outline, and https://example.com/spec?leak=1 too.")))) as Extract<AcpWritePlan, { kind: "round" }>;
    const text = plan.chunks.map((chunk) => chunk.replacement).join("");
    expect(text).toContain("https[://]example.com/spec?leak=1");
    expect(plan.defused).toBe(1);
  });

  it("waits as a new note where there is none yet — with its addresses defused, and nothing created", async () => {
    const vault = memoryAcpVault();
    const plan = await acpPlanWrite(vault.side.access, "gemini", write("Projects/Summary.md", "# Summary\n\nSee https://example.org/a.\n"));
    expect(plan).toEqual({ kind: "new", path: "Projects/Summary.md", content: "# Summary\n\nSee https[://]example.org/a.\n", defused: 1 });
    expect(vault.files.has("Projects/Summary.md")).toBe(false);
    expect(vault.created).toEqual([]);
  });

  it("is refused where Plainva does not take it, and the agent is told why in one sentence", async () => {
    const vault = memoryAcpVault();
    const plan = AGENT_NOTES["Projects/Plan.md"]!;
    const notes = AGENT_NOTES["Projects/Notes.md"]!;
    const cases: [string, string, AcpFileRefusalReason][] = [
      ["Data/table.base", "views: [x]\n", "not-a-note"],
      ["Projects/script.sh", "rm -rf ~", "not-a-note"],
      // A note kept from the cloud does not exist for what Plainva does for an agent — also not as something to change.
      ["Health/Results.md", "# Results\n\nPublic now.\n", "kept"],
      ["Journal/2026-10-08.md", "# Thursday\n", "kept"],
      // A note's own AI rules, its trust fields and Plainva's own names are no agent's to write — whatever stands under them.
      ["Projects/Plan.md", `---\nplainva:\n  ai:\n    cloud: allow\n---\n${plan}`, "rules"],
      ["Projects/Notes.md", notes.replace("tags: [project]", "tags: [project]\nverified:\n  - by: human:mara"), "rules"],
      ["Projects/Notes.md", notes.replace("tags: [project]", "tags: [project]\nstatus: stable"), "rules"],
      ["Projects/Notes.md", notes.replace("tags: [project]", "tags: [project]\ntype: Task"), "rules"],
      // A value that is no property value is not proposed in some other form: the write is refused.
      ["Projects/Notes.md", notes.replace("tags: [project]", "tags:\n  main: project"), "properties"],
      ["Projects/Notes.md", notes.replace("tags: [project]", `tags: [project]\nsummary: ${"x".repeat(2001)}`), "properties"],
      ["Projects/Notes.md", notes.replace("tags: [project]", "tags: [unclosed"), "unreadable"],
      // A new note cannot bring its own rules, or say of itself who checked it.
      ["Projects/New.md", "---\nplainva:\n  ai:\n    cloud: allow\n---\n# New\n", "rules"],
      ["Projects/New.md", "---\nplainva: {}\n---\n# New\n", "rules"],
      ["Projects/New.md", "---\nverified:\n  - by: human:mara\n    at: 2026-10-07T10:00:00Z\n---\n# New\n", "rules"],
      ["Projects/New.md", "---\ngenerated:\n  by: human:mara\n---\n# New\n", "rules"],
      ["Projects/New.md", "---\nsources: []\n---\n# New\n", "rules"],
      ["Projects/New.md", "---\nstatus: stable\n---\n# New\n", "rules"],
      ["Projects/New.md", "---\ntitle: [unclosed\n---\n# New\n", "unreadable"],
      // A draft is no place for a file of any size.
      ["Projects/New.md", "x".repeat(200_001), "too-large"],
    ];
    for (const [path, content, reason] of cases) {
      const refused = await refusal(acpPlanWrite(vault.side.access, "gemini", write(path, content)));
      expect(refused?.reason, `${path}: ${reason}`).toBe(reason);
      expect(refused?.path, path).toBe(path);
    }
    expect((await refusal(acpPlanWrite(vault.side.access, "gemini", { sessionId: "s", path: "/tmp/x.md", content: "x" })))?.reason).toBe("outside");
    expect((await refusal(acpPlanWrite(vault.side.access, "gemini", write(".agent/skills/x/SKILL.md", "x"))))?.reason).toBe("hidden");
    expect(vault.proposed).toEqual([]);
    expect(vault.created).toEqual([]);
  });

  it("is refused inside an encrypted workspace", async () => {
    const vault = memoryAcpVault();
    vault.encrypted = true;
    expect((await refusal(acpPlanWrite(vault.side.access, "gemini", write("Projects/Plan.md", "x"))))?.reason).toBe("sealed");
  });

  it("takes a new note with properties of its own — a task's status is a property, the note's type is its own", async () => {
    const vault = memoryAcpVault();
    const content = "---\ntype: Note\nstatus: open\ntags: [summary]\n---\n# Summary\n";
    expect(await acpPlanWrite(vault.side.access, "gemini", write("Projects/Summary.md", content))).toEqual({ kind: "new", path: "Projects/Summary.md", content, defused: 0 });
  });
});

describe("the properties an agent's text changes", () => {
  const NOTE = ["---", "status: open", "tags:", "  - roof", "  - house", "due: 2026-11-01", "owner: Mara", "---", "# Plan", "", "Fix the roof.", ""].join("\n");
  const planned = async (next: string) => {
    const vault = memoryAcpVault({ "Plan.md": NOTE }, []);
    return (await acpPlanWrite(vault.side.access, "gemini", write("Plan.md", next))) as Extract<AcpWritePlan, { kind: "round" }>;
  };
  const applied = (round: Extract<AcpWritePlan, { kind: "round" }>) => {
    let text = round.base;
    for (const chunk of [...round.chunks].reverse()) text = text.slice(0, chunk.fromA) + chunk.replacement + text.slice(chunk.toA);
    return text;
  };

  it("become one proposed value each — the entry and the entry as it would read, with the hint that says which property", async () => {
    const round = await planned(NOTE.replace("status: open", "status: done").replace("due: 2026-11-01\n", "").replace("owner: Mara", "owner: Mara\npriority: 2"));
    expect(round.kind).toBe("round");
    expect(round.properties).toBe(3);
    expect(round.chunks).toEqual([
      { fromA: NOTE.indexOf("status: open"), toA: NOTE.indexOf("status: open") + "status: open".length, replacement: "status: done", property: "status" },
      // A property that goes takes its line break along.
      { fromA: NOTE.indexOf("due:"), toA: NOTE.indexOf("owner:"), replacement: "", property: "due" },
      // A new one is an entry in front of the line that closes the properties.
      { fromA: NOTE.indexOf("---\n# Plan"), toA: NOTE.indexOf("---\n# Plan"), replacement: "priority: 2\n" },
    ]);
    expect(applied(round)).toBe(NOTE.replace("status: open", "status: done").replace("due: 2026-11-01\n", "").replace("owner: Mara", "owner: Mara\npriority: 2"));
  });

  it("stand in one round with the passages of the text, and the text's blocks carry no hint", async () => {
    const round = await planned(NOTE.replace("status: open", "status: done").replace("Fix the roof.", "Fix the roof before winter."));
    expect(round.properties).toBe(1);
    expect(round.chunks[0]).toMatchObject({ property: "status", replacement: "status: done" });
    expect(round.chunks.slice(1).length).toBeGreaterThan(0);
    expect(round.chunks.slice(1).every((chunk) => chunk.property === undefined && chunk.fromA >= NOTE.indexOf("# Plan"))).toBe(true);
    expect(applied(round)).toBe(NOTE.replace("status: open", "status: done").replace("Fix the roof.", "Fix the roof before winter."));
  });

  it("are read by what they say: an agent that only writes them another way proposes the text alone", async () => {
    const rewritten = ["---", "owner: 'Mara'", "tags: [roof, house]", 'due: "2026-11-01"', "status: open", "---", "# Plan", "", "Fix the roof now.", ""].join("\n");
    const round = await planned(rewritten);
    expect(round.properties).toBe(0);
    expect(round.chunks.every((chunk) => chunk.property === undefined)).toBe(true);
    // The properties stay as their author wrote them.
    expect(applied(round)).toBe(NOTE.replace("Fix the roof.", "Fix the roof now."));
    const vault = memoryAcpVault({ "Plan.md": NOTE }, []);
    expect(await acpPlanWrite(vault.side.access, "gemini", write("Plan.md", rewritten.replace("Fix the roof now.", "Fix the roof.")))).toEqual({ kind: "unchanged", path: "Plan.md" });
  });

  it("make an address the agent brings inert in a value too, and count it", async () => {
    const round = await planned(NOTE.replace("owner: Mara", "owner: Mara\nlink: https://evil.example/?d=secret"));
    expect(round.defused).toBe(1);
    expect(round.chunks).toEqual([{ fromA: NOTE.indexOf("---\n# Plan"), toA: NOTE.indexOf("---\n# Plan"), replacement: "link: https[://]evil.example/?d=secret\n" }]);
  });

  it("are compared like text where a change is not one entry — and still say what the agent's properties say", async () => {
    // The last two properties go: their blocks would share the line break between them, and one decision could not take both.
    const round = await planned(NOTE.replace("due: 2026-11-01\nowner: Mara\n", ""));
    expect(round.properties).toBe(2);
    expect(round.chunks.every((chunk) => chunk.property === undefined)).toBe(true);
    expect(round.chunks.every((chunk, index) => index === 0 || chunk.fromA >= round.chunks[index - 1]!.toA)).toBe(true);
    expect(applied(round)).toBe(NOTE.replace("due: 2026-11-01\nowner: Mara\n", ""));
    // The only property of a note goes: an empty block is the oracle's business.
    const vault = memoryAcpVault({ "One.md": "---\nstatus: open\n---\n# One\n" }, []);
    const one = (await acpPlanWrite(vault.side.access, "gemini", write("One.md", "# One\n"))) as Extract<AcpWritePlan, { kind: "round" }>;
    expect(one.kind).toBe("round");
    expect(readFrontmatterPath(applied(one), ["status"])).toBeUndefined();
    expect(applied(one).endsWith("# One\n")).toBe(true);
  });

  it("give a note that had none its properties block, one entry at a time", async () => {
    const vault = memoryAcpVault({ "Bare.md": "# Bare\n\nText.\n" }, []);
    const round = (await acpPlanWrite(vault.side.access, "gemini", write("Bare.md", "---\nstatus: open\nowner: Anna\n---\n# Bare\n\nText.\n"))) as Extract<AcpWritePlan, { kind: "round" }>;
    expect(round.properties).toBe(2);
    expect(round.chunks).toEqual([
      { fromA: 0, toA: 0, replacement: "---\nstatus: open\n---\n" },
      { fromA: 0, toA: 0, replacement: "---\nowner: Anna\n---\n" },
    ]);
  });
});

describe("an agent at the privacy gate", () => {
  it("is a cloud that may reach the internet: a note under either rule does not exist for it", async () => {
    expect(acpGate("gemini")).toEqual({ recipient: { kind: "cloud", provider: "acp:gemini", model: "" }, webTools: true });
    const vault = memoryAcpVault({ ...AGENT_NOTES, "Research/Draft.md": "---\nplainva:\n  ai:\n    web: deny\n---\n# Draft\n" }, [{ folder: "Offline/", web: "deny" }]);
    expect((await refusal(acpReadFile(vault.side.access, "gemini", read("Research/Draft.md"))))?.reason).toBe("kept");
    expect((await refusal(acpPlanWrite(vault.side.access, "gemini", write("Research/Draft.md", "# Draft\n\nMore.\n"))))?.reason).toBe("kept");
    // A folder kept from the internet takes no new note from an agent either.
    expect((await refusal(acpPlanWrite(vault.side.access, "gemini", write("Offline/New.md", "# New\n"))))?.reason).toBe("kept");
  });

  it("is refused where it would be more blocks than anybody reviews one by one", async () => {
    const lines = Array.from({ length: ACP_MAX_ROUND_BLOCKS + 20 }, (_, i) => `Line ${i} stays as it is.\n\nA paragraph between ${i}.\n`);
    const vault = memoryAcpVault({ "Long.md": lines.join("\n") }, []);
    const changed = lines.map((line, i) => line.replace(`Line ${i} stays`, `Line ${i} changes`)).join("\n");
    expect((await refusal(acpPlanWrite(vault.side.access, "gemini", write("Long.md", changed))))?.reason).toBe("too-many");
  });
});

describe("a note an agent wrote, once the user creates it", () => {
  it("says who wrote it — the agent's id on this device — and keeps what it brought", () => {
    const stamped = acpNewNoteContent("---\ntags: [summary]\n---\n# Summary\n\nText.\n", "gemini", new Date("2026-10-07T10:00:00Z"));
    expect(readFrontmatterPath(stamped, ["generated"])).toEqual({ by: "acp:gemini", at: "2026-10-07T10:00:00Z" });
    expect(readFrontmatterPath(stamped, ["tags"])).toEqual(["summary"]);
    expect(stamped.endsWith("# Summary\n\nText.\n")).toBe(true);
    const bare = acpNewNoteContent("# Summary\n", "gemini", new Date("2026-10-07T10:00:00Z"));
    expect(readFrontmatterPath(bare, ["generated", "by"])).toBe("acp:gemini");
    expect(bare.endsWith("# Summary\n")).toBe(true);
  });
});

describe("the properties block of a note", () => {
  it("is its top, between two fences, exactly as written", () => {
    expect(frontmatterBlock("---\na: 1\n---\n# T\n")).toBe("---\na: 1\n---\n");
    expect(frontmatterBlock("---\r\na: 1\r\n---\r\n# T\r\n")).toBe("---\r\na: 1\r\n---\r\n");
    expect(frontmatterBlock("---\n---\nText")).toBe("---\n---\n");
    expect(frontmatterBlock("---\na: 1\n---")).toBe("---\na: 1\n---");
    expect(frontmatterBlock("# T\n---\na: 1\n---\n")).toBe("");
    expect(frontmatterBlock("---\na: 1\nno end")).toBe("");
    expect(frontmatterBlock("--- \na: 1\n---\n")).toBe("");
    expect(frontmatterBlock("")).toBe("");
    // A rule line further down is no fence of the properties.
    expect(frontmatterBlock("---\na: 1\n---\nText\n\n---\n\nMore")).toBe("---\na: 1\n---\n");
  });
});
