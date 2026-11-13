import React, { useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { AddPropertyPopover, PropertyValue } from "../../src/components/PropertyValues";
import { AddPropertySheet } from "../../../mobile/src/components/AddPropertySheet";
import { CellEditSheet } from "../../../mobile/src/screens/base/CellEditSheet";
import type { MobileVault } from "../../../mobile/src/services/vaultService";
import { propertyIndexTypes, propertyFolder, type PropertyType, type CuratedOption } from "../../../../packages/ui/src/index";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../../mobile/src/mobile.css";
import "../../../../packages/ui/src/i18n";

const requests: { key: string; folder?: string; types?: readonly string[] }[] = [];
let pending: (() => void)[] = [];
const source = {
  async getKnownProperties() { return [{ name: "Status", type: "string", count: 8 }, { name: "Existing", type: "number", count: 5 }, { name: "plainva.icon", type: "string", count: 9 }]; },
  async getDistinctPropertyValues(key: string, folder?: string, types?: readonly string[]) {
    requests.push({ key, folder, types });
    if (folder === "Old/") return new Promise<{ value: string; count: number }[]>((resolve) => pending.push(() => resolve([{ value: "Stale", count: 99 }])));
    return (folder === "New/" ? ["Fresh"] : folder ? ["Local"] : ["Local", "Other folder"])
      .map((value) => ({ value, count: 3 }));
  },
};
// Suggestions are shown, so they come from the index as it stands (`indexView`).
const vault = { vaultId: "property-fixture", queryService: source, indexView: source } as unknown as MobileVault;
const columns = { Status: { input: "status", options: [{ value: "Curated" }] } };
type Options = { shell: "desktop" | "mobile"; mode: "name" | "value"; type?: PropertyType; curated?: CuratedOption[]; path?: string };
function Probe({ options }: { options: Options }) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState(options.mode);
  const [type, setType] = useState<PropertyType>(options.type ?? "text");
  const [name, setName] = useState("Value");
  const [value, setValue] = useState<unknown>(type === "list" ? [] : "");
  const [curated, setCurated] = useState(options.curated);
  const [path, setPath] = useState(options.path ?? "Notes/a.md");
  const load = useCallback((key: string, all = false) => source.getDistinctPropertyValues(key, all ? undefined : propertyFolder(path), propertyIndexTypes(type)), [path, type]);
  const add = (key: string, input: PropertyType) => { setName(key); setType(input); setCurated(key === "Status" ? columns.Status.options : undefined); setMode("value"); };
  const existing = ["Existing"];
  return <>
    <button data-testid="change-note" onClick={() => setPath("New/a.md")}>Change note</button>
    <output data-testid="property-value">{JSON.stringify(value)}</output><output data-testid="property-type">{type}</output>
    {mode === "name" ? options.shell === "desktop"
      ? <AddPropertyPopover source={source} columns={columns} registry={{}} existing={existing} onAdd={add} onClose={() => {}} t={t} />
      : <AddPropertySheet source={source} columns={columns} registry={{}} existing={existing} onAdd={add} onClose={() => {}} />
      : options.shell === "desktop" ? <PropertyValue propKey={name} type={type} value={value} onChange={setValue}
        getValueSuggestions={load} curatedOptions={curated} tagSuggestions={[]} t={t} locale={i18n.language} />
      : <CellEditSheet key={path} vault={vault} target={{ notePath: path, col: name, input: type, value, options: curated ?? [], curated: curated !== undefined }} rows={[]}
        onCommit={setValue} onClose={() => {}} />}
  </>;
}
let root: Root | undefined;
export const propertyProbe = {
  requests,
  mount(options: Options) { root?.unmount(); root = createRoot(document.getElementById("host")!); requests.length = 0; pending = [];
    document.documentElement.dataset.density = options.shell === "mobile" ? "touch" : "compact";
    root.render(<Probe options={options} />); },
  flush() { pending.forEach((resolve) => resolve()); pending = []; },
};
export type PropertyProbeWindow = Window & { propertyProbe: typeof propertyProbe };
(window as PropertyProbeWindow).propertyProbe = propertyProbe;
