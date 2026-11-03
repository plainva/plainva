// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { groupNameCollisions, type NameCollisionCase } from "@plainva/core";
import { NameCollisionsNotice, resolveNameCollisionCases } from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";

/**
 * "Same name, two files" (finding 2026-11-03): the card printed every pair as
 * `Aufgaben/Notiz.md ↔ Aufgaben/Notiz.md` — the same name in two Unicode
 * forms, which looks the same — and could do nothing about it. It now lists
 * each case once with what tells the copies apart, and acts.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const value = key.split(".").reduce<any>((o, k) => o?.[k], en);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), value ?? key);
    },
    i18n: { language: "en" },
  }),
}));

const NAME = "Brötchen holen.md".normalize("NFC");
const NFC = `Aufgaben/${NAME}`;
const NFD = NFC.normalize("NFD");
const OTHER = `Aufgaben/${"Käse kaufen.md".normalize("NFC")}`;

const mounted: { root: Root; host: HTMLDivElement }[] = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

function described(): NameCollisionCase[] {
  const [same, differs, letterCase] = groupNameCollisions([
    { path: NFD, twin: NFC },
    { path: OTHER.normalize("NFD"), twin: OTHER },
    { path: "Notes/idea.md", twin: "Notes/Idea.md" },
  ]);
  return [
    { ...same!, described: true, where: { here: false, remote: true }, identical: true, action: "remove-duplicate", synced: { size: 1562, modifiedMs: null }, other: { size: 1562, modifiedMs: null } },
    { ...differs!, described: true, where: { here: true, remote: true }, identical: false, action: "keep-both", synced: { size: 349, modifiedMs: null }, other: { size: 372, modifiedMs: null } },
    { ...letterCase!, described: true, where: { here: false, remote: true }, action: "keep-both", synced: { size: 10, modifiedMs: null }, other: null },
  ];
}

async function mount(cases: NameCollisionCase[], onResolve = vi.fn(async () => ({ removed: 1, kept: 0, skipped: 0 })), confirm = vi.fn(async () => true)) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(<NameCollisionsNotice cases={cases} confirm={confirm} onResolve={onResolve} />));
  return { host, onResolve, confirm };
}

describe("the collision card", () => {
  it("lists each case once, folder and name, with what tells the copies apart — never `X ↔ X`", async () => {
    const { host } = await mount(described());
    const rows = [...host.querySelectorAll('[data-testid="sync-collision-case"]')];
    expect(rows).toHaveLength(3);
    expect(host.textContent).not.toContain("↔");
    expect(rows[0]!.textContent).toContain(NAME);
    expect(rows[0]!.textContent).toContain(en.sync.collisionInFolder.replace("{{folder}}", "Aufgaben"));
    expect(rows[0]!.textContent).toContain(`${en.sync.collisionTwice} · ${en.sync.collisionIdentical}`);
    expect(rows[0]!.textContent).toContain(en.sync.collisionCloud);
    // A differing pair says how: the size of each copy.
    const facts = rows[1]!.querySelector('[data-testid="sync-collision-facts"]')!.textContent!;
    expect(facts).toContain(en.sync.collisionDifferent);
    expect(facts).toContain("349");
    expect(facts).toContain("372");
    expect(facts).toContain(`${en.sync.collisionHere}, ${en.sync.collisionCloud}`);
    // Letter case: the two names a person can see.
    expect(rows[2]!.textContent).toContain("idea.md / Idea.md");
    expect(rows[2]!.textContent).toContain(en.sync.collisionCaseOnly);
  });

  it("offers each action with its count and asks before it acts", async () => {
    const { host, onResolve, confirm } = await mount(described());
    const remove = host.querySelector<HTMLButtonElement>('[data-testid="sync-collisions-remove"]')!;
    const keep = host.querySelector<HTMLButtonElement>('[data-testid="sync-collisions-keep"]')!;
    expect(remove.textContent).toBe(`${en.sync.collisionRemove} (1)`);
    expect(keep.textContent).toBe(`${en.sync.collisionKeepBoth} (2)`);
    await act(async () => remove.click());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: en.sync.collisionRemoveConfirmTitle }));
    expect(onResolve).toHaveBeenCalledWith("remove-duplicate");
  });

  it("does nothing when the question is declined", async () => {
    const { host, onResolve } = await mount(described(), undefined, vi.fn(async () => false));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="sync-collisions-keep"]')!.click());
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("shows nothing without a case", async () => {
    const { host } = await mount([]);
    expect(host.textContent).toBe("");
  });
});

describe("what the buttons do in both shells", () => {
  it("sends twin spellings to the worker and renames a letter-case pair to a free name through the shell", async () => {
    const resolveTwins = vi.fn(async () => ({ removed: 0, kept: [`Aufgaben/${"Käse kaufen (2).md".normalize("NFC")}`], skipped: 0, restored: [] }));
    const rename = vi.fn(async () => true);
    const result = await resolveNameCollisionCases("keep-both", described(), {
      resolveTwins,
      listPaths: async (folder) => (folder === "Notes" ? ["Notes/idea.md", "Notes/idea (2).md"] : []),
      rename,
    });
    expect(resolveTwins).toHaveBeenCalledWith("keep-both");
    expect(rename).toHaveBeenCalledWith("Notes/idea.md", "Notes/idea (3).md");
    expect(result).toMatchObject({ kept: 2, removed: 0, skipped: 0 });
  });

  it("removes duplicates through the worker only", async () => {
    const resolveTwins = vi.fn(async () => ({ removed: 1, kept: [], skipped: 0, restored: [] }));
    const rename = vi.fn(async () => true);
    const result = await resolveNameCollisionCases("remove-duplicate", described(), { resolveTwins, listPaths: async () => [], rename });
    expect(resolveTwins).toHaveBeenCalledWith("remove-duplicate");
    expect(rename).not.toHaveBeenCalled();
    expect(result).toMatchObject({ removed: 1, kept: 0 });
  });
});
