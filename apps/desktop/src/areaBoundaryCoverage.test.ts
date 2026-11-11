import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every surface of the desktop that can fail on its own sits in an
 * `AreaBoundary` (stability plan 2026-11-10, R3).
 *
 * Read from the sources, not from a list kept beside them: a new tab type, a
 * new pane of the shell, a new dialog of the shell, a new section of the right
 * column, a new database view or a new settings page that is mounted outside
 * a boundary fails here. The phone's twin is `apps/mobile/src/areaBoundaryCoverage.test.ts`.
 */

const SRC = resolve(__dirname);
const UI = resolve(__dirname, "../../../packages/ui/src");
const read = (path: string) => readFileSync(path, "utf8");

/** The source ranges inside `<AreaBoundary …>…</AreaBoundary>`. */
function boundarySpans(src: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const open: number[] = [];
  for (const m of src.matchAll(/<AreaBoundary\b|<\/AreaBoundary>/g)) {
    if (m[0].startsWith("</")) {
      const start = open.pop();
      if (start === undefined) throw new Error("a closing AreaBoundary without its opening");
      spans.push([start, m.index + m[0].length]);
    } else open.push(m.index);
  }
  if (open.length) throw new Error("an AreaBoundary that is never closed");
  return spans;
}
const inside = (spans: Array<[number, number]>, at: number) => spans.some(([a, b]) => at > a && at < b);

/** One component's body: from its declaration to the closing brace at column 0. */
function componentBody(src: string, start: RegExp): string {
  const m = src.match(start);
  if (!m || m.index === undefined) throw new Error(`no component ${start}`);
  const end = src.indexOf("\n}\n", m.index);
  const endConst = src.indexOf("\n};\n", m.index);
  const stop = [end, endConst].filter((n) => n > 0).sort((a, b) => a - b)[0] ?? src.length;
  return src.slice(m.index, stop);
}

/** JSX elements (`<Name`) of a body that lie outside every boundary. */
function unbounded(body: string): string[] {
  const spans = boundarySpans(body);
  const names: string[] = [];
  for (const m of body.matchAll(/(?<![\w.$])<([A-Z][\w.]*)/g)) {
    if (!inside(spans, m.index!)) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** Names imported from lucide-react: glyphs, not surfaces. */
function glyphs(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * What may stand outside a boundary in a shell file, and why. Everything else
 * the shell mounts is a surface, and a surface fails on its own.
 */
const FRAME: Record<string, string> = {
  Fragment: "React's grouping, draws nothing",
  Suspense: "React's loading frame around the surface inside it",
  AreaBoundary: "the boundary itself",
  "AiSessionContext.Provider": "context, draws nothing",
  LocalModelsProvider: "context, draws nothing",
  SearchField: "the primitive input of the left sidebar; it holds no data of its own",
  ActiveSearchModeSwitch: "a Segmented of two fixed options in the result head",
  IconButton: "primitive",
  Button: "primitive",
  EmptyState: "primitive",
  ShortcutHints: "primitive of fixed key hints",
  AiCommandSourceLink: "registers the palette's commands with the AI; draws nothing",
  AppShell: "the shell, whose every area carries its own boundary",
  SplashScreen: "the start without a vault: the window's own boundary in main.tsx is the area",
  WindowChromeStrip: "the frameless window's drag strip on the splash; no data",
  AuxPane: "carries the boundary of its tab itself (one per pane)",
};

const SHELLS: Array<[string, RegExp]> = [
  [`${SRC}/AppShell.tsx`, /export function AppShell\(/],
  [`${SRC}/App.tsx`, /\nfunction App\(\)/],
  [`${SRC}/AuxApp.tsx`, /export function AuxApp\(/],
  [`${SRC}/components/AuxPane.tsx`, /export function AuxPane\(/],
];

describe("every surface of the desktop shell is an area of its own", () => {
  for (const [file, start] of SHELLS) {
    it(`${file.slice(SRC.length + 1)} mounts no surface outside a boundary`, () => {
      const src = read(file);
      const lucide = glyphs(src);
      const loose = unbounded(componentBody(src, start)).filter((name) => !FRAME[name] && !lucide.has(name));
      expect(loose, "wrap these in an AreaBoundary, or name them in FRAME with the reason they cannot fail on their own").toEqual([]);
    });
  }

  it("every tab type of both tab dispatchers is inside the tab's boundary", () => {
    const tabs = [...read(`${SRC}/components/graph/virtualPaths.ts`).matchAll(/export const (\w+_TAB_PATH)\b/g)].map((m) => m[1]);
    expect(tabs.length).toBeGreaterThanOrEqual(7);
    for (const file of [`${SRC}/AppShell.tsx`, `${SRC}/components/AuxPane.tsx`]) {
      const src = read(file);
      const spans = boundarySpans(src);
      const branches = [
        ...tabs.map((name) => `path === ${name}`),
        "path.startsWith(COMPARISON_PREFIX)",
        "path.endsWith(\".base\")",
        "path.endsWith('.base')",
        "<Editor",
      ];
      for (const branch of branches) {
        for (let at = src.indexOf(branch); at >= 0; at = src.indexOf(branch, at + 1)) {
          expect(inside(spans, at), `${file.slice(SRC.length + 1)}: "${branch}" outside the tab boundary`).toBe(true);
        }
      }
    }
  });

  it("every section of the right column is drawn inside its own boundary", () => {
    const src = read(`${SRC}/components/RightSidebar.tsx`);
    const calls = [...src.matchAll(/renderBody\(id\)/g)];
    expect(calls).toHaveLength(1);
    expect(inside(boundarySpans(src), calls[0].index!)).toBe(true);
    // The ids it draws are the bar model's; each is a case of the one renderer.
    const ids = [...read(`${UI}/services/barLayout.ts`).match(/RIGHT_SECTION_IDS\s*=\s*\[([^\]]*)\]/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    const body = src.slice(src.indexOf("const renderBody"), src.indexOf("renderBody(id)"));
    for (const id of ids.filter((id) => id !== "properties")) expect(body, `section ${id} drawn by renderBody`).toContain(`"${id}"`);
  });

  it("every database view is drawn inside the view's boundary", () => {
    const src = read(`${SRC}/components/BaseViewer.tsx`);
    const spans = boundarySpans(src);
    const calls = [...src.matchAll(/renderViewContent\(\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(inside(spans, c.index!), "renderViewContent() outside the view's boundary").toBe(true);
  });

  it("every settings page is a SettingsPage, and a SettingsPage is a boundary", () => {
    const src = read(`${SRC}/components/SettingsModal.tsx`);
    const wrapper = src.slice(src.indexOf("const SettingsPage"), src.indexOf("export const SettingsModal"));
    expect(wrapper).toContain("<AreaBoundary area={`settings:${area}`}>");
    const pageSpans: Array<[number, number]> = [];
    for (const m of src.matchAll(/<SettingsPage\b/g)) pageSpans.push([m.index!, src.indexOf("</SettingsPage>", m.index!)]);
    const pages = [...src.matchAll(/(?<![\w.$])<([A-Z]\w*Page)\b/g)].filter((m) => m[1] !== "SettingsPage");
    expect(pages.length).toBeGreaterThanOrEqual(16);
    for (const m of pages) expect(inside(pageSpans, m.index!), `${m[1]} outside a SettingsPage`).toBe(true);
  });

  it("the mail view's list and reader are areas of their own", () => {
    const src = read(`${SRC}/components/mail/MailView.tsx`);
    const spans = boundarySpans(src);
    for (const marker of ['data-testid="mail-list"', 'data-testid="mail-subject"']) {
      expect(inside(spans, src.indexOf(marker)), marker).toBe(true);
    }
  });

  it("the editor's neighbours — comments column, database line, popups, dialogs — are areas of their own", () => {
    const src = read(`${SRC}/components/Editor.tsx`);
    const body = componentBody(src, /\nexport const Editor\b/);
    const spans = boundarySpans(body);
    const neighbours = [...body.matchAll(/(?<![\w.$])<([A-Z]\w*(?:Picker|Popover|Column|DatabaseBar|ContextMenu|BlockMenu|SelectionToolbar|Modal|SizePicker))\b/g)];
    expect(neighbours.length).toBeGreaterThanOrEqual(10);
    for (const m of neighbours) expect(inside(spans, m.index!), `${m[1]} beside the editor without a boundary`).toBe(true);
  });

  it("only a surface that appears on its own fails quietly, and every such surface does", () => {
    // A dialog that opened on every selection would take the editor away; a
    // menu or picker the person opened keeps the dialog form ("I clicked and
    // nothing happened" is worse).
    const QUIET: Record<string, string> = {
      "editor:selectionToolbar": "appears with every text selection",
      "menu:aiSelection": "the AI menu of that toolbar, mounted whenever the assistant is on",
      "menu:recentSearches": "opens by itself when the empty search field takes the focus",
      "shell:indexNotice": "a strip that appears by itself while the first index is built (performance plan L3)",
    };
    const found = new Set<string>();
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
    });
    for (const file of walk(SRC)) {
      for (const m of read(file).matchAll(/<AreaBoundary area="([^"]+)"[^>]*size="quiet"/g)) found.add(m[1]);
    }
    expect([...found].sort()).toEqual(Object.keys(QUIET).sort());
    const editor = read(`${SRC}/components/Editor.tsx`);
    expect(editor).toMatch(/<AreaBoundary area="editor:selectionToolbar" size="quiet">\s*<SelectionToolbar\b/);
  });

  it("the dialog and the floating window carry a boundary around their content", () => {
    expect(read(`${UI}/components/ui/Modal.tsx`)).toMatch(/<AreaBoundary area=\{`dialog:\$\{testId \?\? "modal"\}`\}[^>]*>\s*\{children\}\s*<\/AreaBoundary>/);
    expect(read(`${UI}/components/ui/FloatingWindow.tsx`)).toMatch(/<AreaBoundary area=\{`window:[^>]*>\{children\}<\/AreaBoundary>/);
  });
});
