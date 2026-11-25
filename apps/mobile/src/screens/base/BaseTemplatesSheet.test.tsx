// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseTemplateForTargets, toast, toastStore } from "@plainva/ui";
import { BaseTemplatesSheet } from "./BaseTemplatesSheet";
import { TemplateTargetsSheet } from "./TemplateTargetsSheet";
import type { MobileVault } from "../../services/vaultService";

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => lookup(key) }),
  };
});

const files = new Map<string, string>();
const bases = [
  { path: "DB/Tasks.base", title: "Tasks" },
  { path: "DB/Projects.base", title: "Projects" },
];

vi.mock("../../services/mobileSettings", () => ({
  getMobileSettings: () => ({ templateFolder: "Templates" }),
}));
vi.mock("../../services/syncService", () => ({ syncSoon: () => {} }));
vi.mock("../../services/vaultService", () => ({
  vaultOps: {
    read: async (_v: unknown, p: string) => {
      const text = files.get(p);
      if (text === undefined) throw new Error(`missing ${p}`);
      return text;
    },
    update: async (_v: unknown, p: string, change: (t: string) => string | null) => {
      const current = files.get(p);
      if (current === undefined) throw new Error(`missing ${p}`);
      const next = change(current);
      if (next === null) return { changed: false, text: current };
      files.set(p, next);
      return { changed: true, text: next };
    },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeVault(): MobileVault {
  return {
    vaultId: "v1",
    files: {
      listDir: async (dir: string) => {
        const prefix = dir.replace(/\/$/, "") + "/";
        return [...files.keys()]
          .filter((p) => p.startsWith(prefix))
          .map((p) => ({ name: p.slice(prefix.length), path: p, isDirectory: false }));
      },
      readTextFile: async (p: string) => {
        const text = files.get(p);
        if (text === undefined) throw new Error(`missing ${p}`);
        return text;
      },
      exists: async (p: string) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p.replace(/\/$/, "") + "/")),
    },
    queryService: {
      db: {
        query: async () => [...files.keys(), ...bases.map((b) => b.path)].map((path) => ({ path })),
      },
      listBases: async () => bases,
    },
  } as unknown as MobileVault;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  files.clear();
  toast.clearAll();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("BaseTemplatesSheet (parity: base-template-assignment)", () => {
  it("lists assigned templates first, keeps others behind Show all, and toggles plainva.templateFor", async () => {
    files.set("Templates/Task.md", "---\ntype: Note\nplainva:\n  templateFor:\n    - \"[[Tasks.base]]\"\n---\n# {{title}}\n");
    files.set("Templates/General.md", "---\ntype: Note\n---\n# {{title}}\n");
    const onCreate = vi.fn();
    const onSetDefault = vi.fn();
    const onClose = vi.fn();
    const vault = makeVault();

    await act(async () => {
      root.render(
        <BaseTemplatesSheet
          vault={vault}
          basePath="DB/Tasks.base"
          defaultTemplate={null}
          onCreate={onCreate}
          onSetDefault={onSetDefault}
          onClose={onClose}
        />,
      );
    });
    await flush();

    // Assigned template is visible right away; unassigned template waits behind Show all.
    expect(host.querySelector('[data-testid="base-template-Templates/Task.md"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="base-template-Templates/General.md"]')).toBeNull();

    // Expand Show all and assign General to DB/Tasks.base.
    const showAll = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-expanded") === "false")!;
    await act(async () => showAll.click());
    const genRow = host.querySelector('[data-testid="base-template-Templates/General.md"]')!;
    expect(genRow).not.toBeNull();
    const assignBtn = genRow.querySelector<HTMLButtonElement>('[data-testid="base-template-assign"]')!;
    await act(async () => assignBtn.click());
    await flush();

    expect(parseTemplateForTargets(files.get("Templates/General.md")!)).toEqual(["Tasks.base"]);

    // Tapping a template row creates an entry from it and closes the sheet.
    const taskRow = host.querySelector('[data-testid="base-template-Templates/Task.md"]')!;
    await act(async () => taskRow.querySelector<HTMLButtonElement>(".m-row-main")!.click());
    expect(onCreate).toHaveBeenCalledWith("Templates/Task.md");
    expect(onClose).toHaveBeenCalled();
  });

  it("reports a write error instead of swallowing it when the template frontmatter cannot be written", async () => {
    files.set("Templates/Broken.md", "---\nnot-a-map\n---\n# Broken\n");
    const vault = makeVault();

    await act(async () => {
      root.render(
        <BaseTemplatesSheet
          vault={vault}
          basePath="DB/Tasks.base"
          defaultTemplate={null}
          onCreate={() => {}}
          onSetDefault={() => {}}
          onClose={() => {}}
        />,
      );
    });
    await flush();

    const showAll = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-expanded") === "false")!;
    await act(async () => showAll.click());
    const assignBtn = host.querySelector<HTMLButtonElement>('[data-testid="base-template-assign"]')!;
    await act(async () => assignBtn.click());
    await flush();

    expect(toastStore.get().some((t) => t.kind === "error")).toBe(true);
  });
});

describe("TemplateTargetsSheet (parity: base-template-assignment)", () => {
  it("shows assigned target databases, adds a new one, and removes an existing one", async () => {
    files.set("Templates/Project.md", "---\ntype: Note\nplainva:\n  templateFor:\n    - \"[[Tasks.base]]\"\n---\n# {{title}}\n");
    const vault = makeVault();

    await act(async () => {
      root.render(<TemplateTargetsSheet vault={vault} templatePath="Templates/Project.md" onClose={() => {}} />);
    });
    await flush();

    // Only Projects is offered to add; Tasks is already assigned.
    const addBtns = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="template-target-add"]')];
    expect(addBtns.map((b) => b.textContent)).toEqual(["Projects"]);

    await act(async () => addBtns[0].click());
    await flush();
    expect(parseTemplateForTargets(files.get("Templates/Project.md")!)).toEqual(["Tasks.base", "Projects.base"]);

    // Remove the first assigned target.
    const removeBtns = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="template-target-remove"]')];
    expect(removeBtns).toHaveLength(2);
    await act(async () => removeBtns[0].click());
    await flush();
    expect(parseTemplateForTargets(files.get("Templates/Project.md")!)).toEqual(["Projects.base"]);
  });

  it("shows a visible load error instead of 'No database assigned' when the template cannot be read", async () => {
    const vault = makeVault();

    await act(async () => {
      root.render(<TemplateTargetsSheet vault={vault} templatePath="Templates/Missing.md" onClose={() => {}} />);
    });
    await flush();

    expect(host.querySelector('[data-testid="template-targets-error"]')).not.toBeNull();
    expect(host.textContent).not.toContain("No database assigned.");
  });
});
