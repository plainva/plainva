import { describe, expect, it } from "vitest";
import { mcpSession, turn } from "./mcpSessionHarness";

/**
 * The warning under an answer (plan Oberfläche O7, E2; review O7, second round): which notes an answer names as its
 * source that the conversation never had is checked once, as the run ends — over every text the run gave, and against
 * the vault the shell lists — and kept with the run (`RunMeta.unfounded`). The conversation only shows it.
 */
const find = { id: "c1", name: "find_tools", args: { query: "notes" } };

describe("the notes an answer names without the conversation having had them", () => {
  it("are checked in every text of the run: a citation before a tool call counts as much as the last words", async () => {
    const { s } = await mcpSession([turn({ text: "The offer rests on [[Pricing 2026]].", calls: [find] }), turn({ text: "Done." })]);
    expect(await s.send("Check the offer.")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toEqual(["Pricing 2026"]);
  });

  it("are read against the vault the shell lists: a file that is no note names no source, a name with a dot is a note", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[diagram.png]], [[Pricing 2026]] and [[Node.js]]." })]);
    vault.host.linkFiles = async () => [{ path: "Pricing 2026.md", title: "Pricing 2026" }, { path: "Node.js.md", title: "Node.js" }, { path: "diagram.png", title: "diagram.png", mode: "attachment" }];
    expect(await s.send("What do the notes say?")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toEqual(["Pricing 2026", "Node.js"]);
  });

  it("an answer that cites nothing carries no finding", async () => {
    const { s } = await mcpSession([turn({ text: "Three feature pages instead of six." })]);
    expect(await s.send("Summarize.")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toBeUndefined();
  });

  it("a vault whose files cannot be listed now is asked as if it had only what the conversation had", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[Pricing 2026]]." })]);
    vault.host.linkFiles = async () => {
      throw new Error("index closed");
    };
    expect(await s.send("And the prices?")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toEqual(["Pricing 2026"]);
  });
});
