import { describe, it, expect, beforeEach, vi } from "vitest";
import { welcomeBody, buildTemplateNoteContent } from "@plainva/ui";
import { applyVaultTemplateSettings } from "./vaultTemplates";
import {
  dailyNotesFolderKey,
  templateFolderKey,
  dailyNoteTemplateKey,
  taskDatabaseKey,
} from "../contexts/VaultContext";

/**
 * Infrastructure the vault STRUCTURE templates build on (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour", step P1.1):
 *
 * - `welcomeBody` link sections — the folder bullets alone point at managed
 *   index.md files, which the graph hides, so a welcome note that links nothing
 *   else leaves the graph empty. Sections add real, graph-visible edges.
 * - `settings.taskDatabase` — lets a template point the Tasks view at the task
 *   database it ships.
 * - Nested `plainva:` frontmatter via `note.properties` — icons, header colors
 *   and `templateFor` all live under that namespace, so the surgical YAML writer
 *   has to nest them correctly (a flattened "plainva.icon" key would be inert).
 */

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({
    get: async (key: string) => storeValues[key],
    set: async (key: string, value: unknown) => { storeValues[key] = value; },
    save: async () => {},
  }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), confirm: vi.fn(async () => true) }));

const FOLDERS = [{ name: "Projekte", description: "Laufende Vorhaben" }];

describe("welcomeBody link sections", () => {
  it("renders exactly as before when no sections are passed", () => {
    const body = welcomeBody("Willkommen", "Intro.", FOLDERS, "Outro.");
    expect(body).toBe(
      "# Willkommen\n\nIntro.\n\n* [Projekte](Projekte/index.md) - Laufende Vorhaben\n\nOutro.\n"
    );
  });

  it("renders a headed list and URL-encodes the targets", () => {
    const body = welcomeBody("Willkommen", "Intro.", FOLDERS, "Outro.", [
      {
        heading: "Deine Datenbanken",
        links: [
          { name: "Projekte", path: "Projekte.base", description: "Alle Vorhaben" },
          { name: "Anhänge-Skizze", path: "Anhänge/skizze.svg" },
        ],
      },
    ]);
    expect(body).toContain("## Deine Datenbanken");
    expect(body).toContain("* [Projekte](Projekte.base) - Alle Vorhaben");
    // Umlauts must be encoded like the folder bullets, or the link resolves nowhere.
    expect(body).toContain(`* [Anhänge-Skizze](${encodeURI("Anhänge/skizze.svg")})`);
    // No trailing " - " when a link carries no description.
    expect(body).not.toContain("skizze.svg) -");
    // Sections sit between the bullets and the outro.
    expect(body.indexOf("Laufende Vorhaben")).toBeLessThan(body.indexOf("## Deine Datenbanken"));
    expect(body.indexOf("## Deine Datenbanken")).toBeLessThan(body.indexOf("Outro."));
  });

  it("omits empty sections instead of leaving a bare heading", () => {
    const body = welcomeBody("W", "I.", FOLDERS, "O.", [{ heading: "Leer", links: [] }]);
    expect(body).not.toContain("Leer");
    expect(body).toBe(welcomeBody("W", "I.", FOLDERS, "O."));
  });
});

describe("nested plainva frontmatter from note.properties", () => {
  it("writes a real nested map, not a flattened key", () => {
    const content = buildTemplateNoteContent({
      path: "Bereiche/Arbeit.md",
      body: "# Arbeit\n\nBeispiel.\n",
      properties: {
        plainva: { icon: "💼", header_color: "#378add" },
        fokus: "Beruf",
      },
    });
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("plainva:");
    expect(content).toMatch(/plainva:\n {2}icon: "?💼"?/);
    expect(content).toMatch(/\n {2}header_color: "#378add"/);
    // A flattened key would be inert — the reader only looks inside the map.
    expect(content).not.toContain("plainva.icon");
    // OKF defaults still land on top of the custom properties.
    expect(content).toContain("okf_version:");
    expect(content).toContain("type:");
  });

  it("writes templateFor as a wiki-link list", () => {
    const content = buildTemplateNoteContent({
      path: "Vorlagen/Projekt.md",
      body: "# {{title}}\n",
      properties: { plainva: { templateFor: ["[[Projekte.base]]"], tasks: false } },
    });
    expect(content).toContain("templateFor:");
    expect(content).toContain("[[Projekte.base]]");
    expect(content).toMatch(/tasks: false/);
    // The template's own placeholder must survive verbatim — it is resolved when
    // a note is created FROM the template, not while scaffolding.
    expect(content).toContain("{{title}}");
  });
});

describe("applyVaultTemplateSettings", () => {
  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
  });

  it("wires the task database when a template ships one", async () => {
    await applyVaultTemplateSettings("/vault", {
      id: "plainva",
      name: "T",
      description: "d",
      folders: ["Aufgaben"],
      notes: [],
      settings: { taskDatabase: "Aufgaben.base", templateFolder: "Vorlagen" },
    });
    expect(storeValues[taskDatabaseKey("/vault")]).toBe("Aufgaben.base");
    expect(storeValues[templateFolderKey("/vault")]).toBe("Vorlagen");
  });

  it("leaves keys the template does not define untouched", async () => {
    await applyVaultTemplateSettings("/vault", {
      id: "para",
      name: "T",
      description: "d",
      folders: [],
      notes: [],
      settings: { templateFolder: "Vorlagen" },
    });
    expect(storeValues[taskDatabaseKey("/vault")]).toBeUndefined();
    expect(storeValues[dailyNotesFolderKey("/vault")]).toBeUndefined();
    expect(storeValues[dailyNoteTemplateKey("/vault")]).toBeUndefined();
  });
});
