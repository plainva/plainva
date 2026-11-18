import { describe, expect, it } from "vitest";
import { planVaultScaffold, scaffoldObstacle, scaffoldVaultTemplate, VaultNotEmptyError, type VaultTemplateDefinition } from "@plainva/ui";

/** A vault folder as a tree: files with their text, folders; listings per folder, as the adapters give them. */
class TreeAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();
  failOn: string | null = null;
  async listDir(dir = "") {
    const prefix = dir ? `${dir}/` : "";
    const direct = (p: string) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/");
    return [
      ...[...this.dirs].filter(direct).map((p) => ({ name: p.slice(prefix.length), isDirectory: true })),
      ...[...this.files.keys()].filter(direct).map((p) => ({ name: p.slice(prefix.length), isDirectory: false })),
    ];
  }
  async readTextFile(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`no ${path}`);
    return text;
  }
  async exists(path: string) { return this.files.has(path) || this.dirs.has(path); }
  async createDir(path: string) { this.dirs.add(path); }
  async writeTextFile(path: string, content: string) {
    if (this.failOn && path === this.failOn) throw new Error("No space left on device");
    for (let i = path.indexOf("/"); i > 0; i = path.indexOf("/", i + 1)) this.dirs.add(path.slice(0, i));
    this.files.set(path, content);
  }
}

const NOW = new Date(2026, 10, 18);
const template: VaultTemplateDefinition = {
  id: "para",
  name: "Leftovers",
  description: "",
  folders: ["Projects", "Projects/Active"],
  notes: [
    { path: "Welcome.md", body: "# Welcome", description: "Start here" },
    { path: "Projects/Active/Plan.md", body: "# Plan" },
  ],
} as unknown as VaultTemplateDefinition;
const opts = { template, vaultName: "Vault", subfoldersHeading: "Folders", now: NOW };
const run = (adapter: TreeAdapter) => scaffoldVaultTemplate({ ...opts, adapter, isNewVault: true });

describe("a new attempt goes through what a failed one left (fourth review of O8)", () => {
  it("the plan is what the scaffold writes, file for file and in order", async () => {
    const a = new TreeAdapter();
    const order: string[] = [];
    const write = a.writeTextFile.bind(a);
    a.writeTextFile = async (path, content) => { order.push(path); await write(path, content); };
    await run(a);
    const plan = planVaultScaffold(opts);
    expect(order).toEqual(plan.files.map((f) => f.path));
    for (const f of plan.files) expect(a.files.get(f.path)).toBe(f.content);
  });

  it("files left with exactly the text the structure writes are no obstacle, and the result is a whole structure", async () => {
    const fresh = new TreeAdapter();
    await run(fresh);
    const a = new TreeAdapter();
    a.failOn = "Projects/Active/Plan.md";
    await expect(run(a)).rejects.toThrow("No space left");
    // The take-back could not remove them: Welcome.md and the folders stay.
    expect(a.files.has("Welcome.md")).toBe(true);
    expect(await scaffoldObstacle(a, planVaultScaffold(opts))).toBeNull();
    a.failOn = null;
    await run(a);
    expect(a.files).toEqual(fresh.files);
  });

  it("a left file whose text differs, or a file of someone else's, stands in the way and nothing is written", async () => {
    const changed = new TreeAdapter();
    changed.files.set("Welcome.md", "# Welcome\n\nmy own line");
    await expect(run(changed)).rejects.toBeInstanceOf(VaultNotEmptyError);
    expect([...changed.files.keys()]).toEqual(["Welcome.md"]);

    const foreign = new TreeAdapter();
    foreign.dirs.add("Projects");
    foreign.files.set("Projects/My thesis.md", "mine");
    await expect(run(foreign)).rejects.toBeInstanceOf(VaultNotEmptyError);
    expect(await scaffoldObstacle(foreign, planVaultScaffold(opts))).toBe("Projects/My thesis.md");
    expect([...foreign.files.keys()]).toEqual(["Projects/My thesis.md"]);
  });

  it("a folder the plan does not make, or a file without a way to read it, stands in the way", async () => {
    const a = new TreeAdapter();
    a.dirs.add("Archive");
    expect(await scaffoldObstacle(a, planVaultScaffold(opts))).toBe("Archive");
    const unreadable = { listDir: async () => [{ name: "Welcome.md", isDirectory: false }] };
    expect(await scaffoldObstacle(unreadable, planVaultScaffold(opts))).toBe("Welcome.md");
  });
});
