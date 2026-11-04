// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_AI_APP_SETTINGS, effectivePolicy, naiveComparison, notePolicyFrom, readConversationRecord, utf8Length, type AiEgress, type Candidate, type ConversationRecord, type LedgerEntry } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiContextLens, AiSession, AiSessionContext, type AiVaultHost } from "@plainva/ui";

/**
 * "View context" against sending every proposed note whole (plan KI-Harness
 * P2b-5, P9-6): the share it saves is bytes against bytes, so a note in a
 * script of several bytes a character, or one with properties, that went
 * whole is no saving — and one cut to a section is.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  try {
    localStorage.clear();
  } catch {
    // jsdom has it; a run without it has nothing to clear.
  }
  await i18n.changeLanguage("en");
});

const NOTES: Record<string, string> = {
  // Longer than a section: the rate in its last one.
  "Manual.md": `# Manual\n\n## Setup\n\n${"Setup step. ".repeat(800)}\n\n## Rates\n\nThe rate is 95 EUR per hour.\n`,
  // Three bytes a character, with properties: the index counts the file.
  "Diary.md": `---\nmood: calm\nweather: rain\n---\n# 日記\n\n${"今日は雨でした。".repeat(12)}`,
};

async function mounted(options: { candidates?: Candidate[]; pins?: string[] }) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), []);
  const vault: AiVaultHost = {
    conversations: {
      list: async () => [],
      load: async (id) => (saved.has(id) ? readConversationRecord(JSON.parse(JSON.stringify(saved.get(id)))) : null),
      save: async (record) => void saved.set(record.id, JSON.parse(JSON.stringify(record))),
      remove: async (id) => void saved.delete(id),
      removeAll: async () => saved.clear(),
    },
    ledger: { load: async () => ledger, save: async (entries) => void (ledger = [...entries]) },
    activeNote: async () => null,
    readNote: async (path) => (NOTES[path] === undefined ? null : { path, title: path.replace(/\.md$/, ""), text: NOTES[path]! }),
    situation: async () => ({ now: "2026-10-26 10:00", weekday: "Monday", calendarDay: "2026-10-26", journalDay: "2026-10-26", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    candidates: async () => (options.candidates ? [options.candidates] : []),
    // As the index knows them: the size of the file, properties and all.
    noteSizes: async (paths) => new Map(paths.filter((path) => path in NOTES).map((path) => [path, utf8Length(NOTES[path]!)])),
    policy: { policyOf, resolveLink: async () => null },
    tools: () => null,
  };
  const egress: AiEgress = {
    async send() {},
    async cancel() {},
    async setKey() {},
    hasKey: async () => true,
    async deleteKey() {},
    addEndpoint: async () => true,
    async removeEndpoint() {},
  };
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } };
  const session = new AiSession({
    egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-26",
    now: () => new Date("2026-10-26T10:00:00Z"),
    newId: () => `id${++ids}`,
    label: (key, vars) => i18n.t(key, vars),
  });
  await session.load();
  await session.attachVault(vault);
  for (const path of options.pins ?? []) await session.pin(path);
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={session}>
        <AiContextLens question="what is the rate" />
      </AiSessionContext.Provider>,
    );
  });
  // The lens follows the composer once typing pauses, then builds the context as a send would.
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 650))));
  return { session, container: host };
}

describe("View context against sending every note whole", () => {
  it("shows the share a section saves, in bytes, and once what the whole notes would have been", async () => {
    const { session, container } = await mounted({ candidates: [{ path: "Manual.md", title: "Manual", signals: { lexical: 1 } }] });
    const preview = (await session.previewContext("what is the rate"))!;
    expect(preview.pack.refs[0]).toMatchObject({ path: "Manual.md", section: "Manual > Rates" });
    const naive = naiveComparison(preview.pack.material)!;
    expect(naive.share).toBeGreaterThan(0.9);
    const line = container.querySelector('[data-testid="ai-lens-savings"]')!.textContent ?? "";
    expect(line).toContain(`${Math.min(99, Math.round(naive.share * 100))}% less`);
    expect(line).toContain(`~${new Intl.NumberFormat("en").format(naive.tokens)} tokens`);
  });

  it("shows no saving for a note in another script, with properties, that went whole", async () => {
    const { session, container } = await mounted({ pins: ["Diary.md"] });
    const preview = (await session.previewContext("what is the rate"))!;
    expect(preview.pack.refs.map((ref) => [ref.path, ref.tier, ref.section])).toEqual([["Diary.md", "evidence", undefined]]);
    // The index counts the file: more bytes than characters, and properties the context does not send.
    expect(utf8Length(NOTES["Diary.md"]!)).toBeGreaterThan(preview.pack.material.sentChars * 2);
    expect(container.querySelector('[data-testid="ai-lens"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ai-lens-savings"]')).toBeNull();
  });
});
