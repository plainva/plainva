import { describe, expect, it, vi } from "vitest";
import { gistKey, gistSections, protectedTokens, turns } from "@plainva/core";
import { createVaultPolicy, LocalGists, type LocalCompletion } from "@plainva/ui";
import { until, vaultWith } from "./embeddingTestVault";

const filler = (topic: string) => `${`The team talked about ${topic} at length and agreed to keep going. `.repeat(12)}`;
const NOTES: Record<string, string> = {
  "Projects/Offer.md": `# Offer\n\n${filler("the offer")}The rate stays at 95 EUR per hour until 31.12.2026. Travel is not included.`,
  "Projects/Plan.md": `# Plan\n\n${filler("the plan")}Shoot in spring 2027.`,
  "Short.md": "# Short\n\nA short note.",
};

/** A model on this computer, as the session hands it out: keeps what it must, so every gist passes the check. */
function completion(): LocalCompletion & { calls: number } {
  return {
    providerId: "ollama",
    model: "m",
    calls: 0,
    async complete(instruction, text) {
      this.calls++;
      const section = instruction.includes("note section");
      const tokens = section ? protectedTokens(text) : [];
      return { text: `${["Summary", ...tokens].join(" ")}${section && turns(text) ? " not" : ""}.`, usage: { inputTokens: 100, outputTokens: 10 } };
    },
  };
}

async function controller() {
  const vault = await vaultWith(NOTES);
  const readText = async (path: string) => NOTES[path] ?? null;
  const gists = new LocalGists({
    db: vault.db,
    readText,
    policy: createVaultPolicy({ readFile: readText, resolveLink: async () => null, encrypted: () => false }),
    encrypted: () => false,
    now: () => new Date(Date.now() + 60_000),
    newId: () => Math.random().toString(36).slice(2),
  });
  return { gists, vault };
}

/** Plan KI-Harness P2b-3: gists only with a model on this computer, in passes, read by the package. */
describe("gists in a vault", () => {
  it("writes nothing while the setting is off or the profile Local names no model on this computer", async () => {
    const { gists } = await controller();
    gists.update({ enabled: false, completion: completion() });
    expect(gists.snapshot()).toEqual({ kind: "off" });
    expect(gists.reader()).toBeNull();
    gists.update({ enabled: true, completion: null });
    expect(gists.snapshot()).toEqual({ kind: "no-model" });
    expect(gists.reader()).toBeNull();
    gists.close();
  });

  it("writes the long sections in a pass and hands the package what passed the check", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { gists } = await controller();
      const model = completion();
      gists.update({ enabled: true, completion: model });
      await vi.advanceTimersByTimeAsync(2_000);
      vi.useRealTimers();
      expect(await until(() => gists.snapshot().kind === "on" && !(gists.snapshot() as { working: boolean }).working && model.calls > 0)).toBe(true);
      expect(gists.snapshot()).toMatchObject({ kind: "on", model: "ollama/m", sections: 2, covered: 2, failure: null });
      const reader = gists.reader()!;
      const offer = gistSections(NOTES["Projects/Offer.md"]!)[0]!;
      expect(offer.key).toBe(gistKey(offer.text));
      expect(await reader.section(offer.key)).toBe("Summary 95 31.12.2026 not.");
      gists.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
