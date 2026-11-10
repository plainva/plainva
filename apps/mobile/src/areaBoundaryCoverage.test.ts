import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every surface of the phone that can fail on its own sits in an
 * `AreaBoundary` (stability plan 2026-11-10, R3): every screen, the sheets and
 * surfaces of the shell, the sheets beside the editor, the segments of the
 * context sheet, the panes of the navigator and the database views.
 *
 * Read from the sources, not from a list kept beside them: a new screen, a new
 * sheet of the shell or a new sheet next to the editor that is mounted outside
 * a boundary fails here. The desktop's twin is
 * `apps/desktop/src/areaBoundaryCoverage.test.ts`.
 */

const SRC = resolve(__dirname);
const read = (path: string) => readFileSync(path, "utf8");

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

function componentBody(src: string, start: RegExp): string {
  const m = src.match(start);
  if (!m || m.index === undefined) throw new Error(`no component ${start}`);
  const end = src.indexOf("\n}\n", m.index);
  return src.slice(m.index, end < 0 ? src.length : end);
}

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

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (file: string) => relative(SRC, file).split(sep).join("/");

/** What may stand outside a boundary in the phone's shell, and why. */
const FRAME: Record<string, string> = {
  AreaBoundary: "the boundary itself",
  ShellProviders: "context, draws nothing",
  PendingIntentRunner: "runs parked intents once; draws nothing",
  AdaptiveLayout: "carries the boundary of every screen itself",
  VaultBootSurface: "the window without a vault: before the shell, the app's last net in main.tsx is its area",
};

describe("every surface of the phone is an area of its own", () => {
  it("every screen goes through the one boundary of the work column", () => {
    const layout = read(`${SRC}/components/AdaptiveLayout.tsx`);
    const spans = boundarySpans(layout);
    const mounts = [...layout.matchAll(/renderRoute\(|TAB_ROUTES\.\w+\(/g)];
    expect(mounts.length).toBe(2);
    for (const m of mounts) expect(inside(spans, m.index!), m[0]).toBe(true);
    // No other way onto the screen: the route tables are read by `renderRoute` alone.
    const readers = sources(SRC)
      .filter((file) => !/(^|\/)(routes\.tsx|components\/AdaptiveLayout\.tsx)$/.test(rel(file)))
      .filter((file) => /renderRoute\(|PUSHED_ROUTES\[|TAB_ROUTES[.[]/.test(read(file)))
      .map(rel);
    expect(readers).toEqual([]);
  });

  it("a screen drawn inside another screen is an area of its own", () => {
    for (const file of sources(SRC).filter((f) => rel(f) !== "routes.tsx")) {
      const src = read(file);
      const spans = boundarySpans(src);
      for (const m of src.matchAll(/(?<![\w.$])<([A-Z]\w*Screen)\b/g)) {
        expect(inside(spans, m.index!), `${rel(file)}: <${m[1]}> outside a boundary`).toBe(true);
      }
    }
  });

  it("the shell mounts no surface outside a boundary", () => {
    const src = read(`${SRC}/App.tsx`);
    const lucide = glyphs(src);
    const body = componentBody(src, /\nexport default function App\(\)/);
    const spans = boundarySpans(body);
    const loose = [...new Set([...body.matchAll(/(?<![\w.$])<([A-Z][\w.]*)/g)].filter((m) => !inside(spans, m.index!)).map((m) => m[1]))]
      .filter((name) => !FRAME[name] && !lucide.has(name));
    expect(loose, "wrap these in an AreaBoundary, or name them in FRAME with the reason they cannot fail on their own").toEqual([]);
  });

  it("every sheet is an area of its own: one that fails takes neither its screen nor the note beside it", () => {
    let count = 0;
    for (const file of sources(SRC)) {
      const src = read(file);
      const spans = boundarySpans(src);
      for (const m of src.matchAll(/(?<![\w.$])<([A-Z]\w*Sheet)\b/g)) {
        if (m[1] === "PlatformSheet") continue; // the primitive itself, whose content is the caller's
        count++;
        expect(inside(spans, m.index!), `${rel(file)}: <${m[1]}> outside a boundary`).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(90);
  });

  it("every segment of the context sheet is drawn inside the segment's boundary", () => {
    const src = read(`${SRC}/components/NoteContextSheet.tsx`);
    const tabs = [...src.match(/export type ContextTab = ([^;]+);/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    const spans = boundarySpans(src);
    for (const tab of tabs) {
      const at = src.indexOf(`{tab === "${tab}"`);
      expect(at, `segment ${tab} is drawn`).toBeGreaterThan(0);
      expect(inside(spans, at), `segment ${tab} outside the boundary`).toBe(true);
    }
  });

  it("every database view is drawn inside the view's boundary", () => {
    const src = read(`${SRC}/screens/base/BaseScreen.tsx`);
    const spans = boundarySpans(src);
    for (const marker of ["<PinboardView", "<MobileBaseGraph", "renderCards()", "renderList()", "renderBoard()", "renderCalendar()", "renderTimeline()"]) {
      const at = src.indexOf(marker);
      expect(at, marker).toBeGreaterThan(0);
      expect(inside(spans, at), `${marker} outside the view's boundary`).toBe(true);
    }
    expect(inside(spans, src.lastIndexOf("renderTable()")), "the table view").toBe(true);
  });
});
