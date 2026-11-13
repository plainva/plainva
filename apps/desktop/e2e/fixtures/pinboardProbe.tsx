import React from "react";
import { markPartialRows, type NoteCardData } from "@plainva/core";
import type { MobileVault } from "../../../mobile/src/services/vaultService";
import { createRoot, type Root } from "react-dom/client";
import { PinboardView } from "../../../mobile/src/screens/base/PinboardView";
import { BasePinboardView } from "../../src/components/base/BasePinboardView";
import { VaultContext } from "../../src/contexts/VaultContext";
import { clearPinboardCache, pinboardCache } from "../../../../packages/ui/src/base/pinboardCache";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../mobile/src/mobile.css";
import "../../../../packages/ui/src/i18n";

let app: Root | null = null;
let current: { shell: "mobile" | "desktop"; count: number; embedded?: boolean; partial?: boolean; order?: string[] };
/** What the board asked to save (`onPatchView`). */
const patches: Record<string, unknown>[] = [];
let rows: Record<string, unknown>[] = [];
const requests: string[][] = [];
let imageReads = 0;
const imageRequests: string[] = [];
let failure = false;
let missing = "";
let externalRows: Record<string, unknown>[] | null = null;
let externalImage: ((path: string) => Promise<Uint8Array>) | null = null;
let externalSource: ((paths: string[]) => Promise<Record<string, NoteCardData>>) | null = null;
const versions = new Map<string, number>();
const source = {
  async searchCardContent(paths: string[], query: string) {
    if (failure) throw new Error("Synthetic search failure");
    const data = await this.getCardData(paths);
    return Object.entries(data).filter(([, card]) => card.content.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(([path]) => path);
  },
  async getCardData(paths: string[]) {
    requests.push(paths);
    if (failure) throw new Error("Synthetic load failure");
    if (externalSource) return externalSource(paths);
    return Object.fromEntries(paths.filter((path) => path !== missing).map((path) => [path, {
      content: `# ${path}\n\nCard body ${versions.get(path) ?? 0}. Hiddenneedle ${path.includes("99.") ? "needle-tail" : "ordinary"}\n\n- Item one\n- Item two\n\n![[${path.replace(/\.md$/, ".png")}]]`,
      tags: ["fixture", "group" + Number(path.match(/\d+/)?.[0]) % 2], ctime: 1,
    }]));
  },
};
const files = { async readBinaryFile(path: string) { imageReads++; imageRequests.push(path); if (externalImage) return externalImage(path); return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), c => c.charCodeAt(0)); } };
// A board shows: its cards come from the index as it stands (`indexView`).
const vault = { vaultId: "pinboard-probe", queryService: source, indexView: source, files, adapter: files } as unknown as MobileVault;
const view: { type: string; name: string; pinboardOrder?: string[] } = { type: "pinboard", name: "Notes" };
const config = { views: [view], filters: {} };
function render() {
  const props = { viewKey: "fixture#Notes", onOpenNote() { app?.unmount(); app = null; }, onPatchView(patch: Record<string, unknown>) { patches.push(patch); } };
  const child = current.shell === "mobile"
    ? <PinboardView {...props} vault={vault} rows={rows} view={view} config={config} onMutated={() => {}} askStorageFolder={async () => null} />
    : <VaultContext.Provider value={{ vaultAdapter: files, queryService: source, indexView: source, triggerFileTreeUpdate() {} } as unknown as React.ContextType<typeof VaultContext>}>
      <BasePinboardView {...props} dbData={rows} activeView={view} dbConfig={config} embedded={current.embedded} />
    </VaultContext.Provider>;
  if (!app) app = createRoot(document.getElementById("host")!);
  app.render(child);
}
export const pinboardProbe = {
  requests, imageRequests, versions, patches,
  mount(options: typeof current) {
    app?.unmount(); app = null; current = options;
    document.documentElement.dataset.density = options.shell === "mobile" ? "touch" : "compact";
    rows = externalRows?.slice(0, options.count) ?? Array.from({ length: options.count }, (_, n) => ({ "file.path": `Inbox/Note-${n}.md`, "file.name": `Note ${n}`, "file.mtime": 1, "file.ctime": 1, "file.size": 500, "file.revision": `rev-${versions.get(`Inbox/Note-${n}.md`) ?? 0}`, "file.tags": ["#fixture", "#group" + n % 2] }));
    // The rows of an index that is not whole, as the view hands them out (core `markPartialRows`).
    if (options.partial) markPartialRows(rows);
    view.pinboardOrder = options.order;
    patches.length = 0;
    render();
  },
  unmount() { app?.unmount(); app = null; },
  reset() { app?.unmount(); app = null; clearPinboardCache(source); requests.length = 0; imageReads = 0; imageRequests.length = 0; failure = false; missing = ""; versions.clear(); },
  change(path: string) { versions.set(path, (versions.get(path) ?? 0) + 1); },
  fail(value: boolean) { failure = value; },
  missing(path: string) { missing = path; },
  inspect: () => ({ session: { ...pinboardCache(source).session("fixture#Notes"), heights: [...pinboardCache(source).session("fixture#Notes").heights] }, cards: [...document.querySelectorAll<HTMLElement>("[data-pinboard-path]")].map(el => ({ path: el.dataset.pinboardPath, y: el.offsetTop, h: el.offsetHeight, status: el.dataset.cardStatus })) }),
  imageReads: () => imageReads,
  external(data: Record<string, unknown>[], get: (paths: string[]) => Promise<Record<string, NoteCardData>>, image?: (path: string) => Promise<Uint8Array>) { externalRows = data; externalSource = get; externalImage = image ?? null; },
};
export type PinboardProbeWindow = Window & { pinboardProbe: typeof pinboardProbe };
(window as PinboardProbeWindow).pinboardProbe = pinboardProbe;
