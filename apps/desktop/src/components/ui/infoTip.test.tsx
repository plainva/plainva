// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import {
  DeviceOnlyBadge,
  InfoTip,
  PROFILE_FIELDS,
  Row,
  RowList,
  SectionLabel,
  SettingCard,
  SettingField,
  SettingRow,
  SettingsPageHead,
  infoGuideUrl,
  setPlatformServices,
  travelsWithVault,
  type PlatformServices,
  type PlatformSheetProps,
} from "@plainva/ui";

/**
 * The info button (settings plan 2026-10-29, § 3, E1) and the "On this device
 * only" badge (E3, E14). The button is the one way to a setting's background
 * text in both shells, so the contract is pinned here: a real button, open on
 * a press, closed by Escape (before the dialog around it), a press beside it
 * or a second press, the text in a live region, the user guide in the app
 * language — and the shell decides popover or sheet.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const opened: string[] = [];
function services(extra: Partial<PlatformServices> = {}): PlatformServices {
  return {
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => {}, save: async () => {} }) as never,
    credentials: {} as never,
    openExternal: async (url: string) => { opened.push(url); },
    ...extra,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  opened.length = 0;
  setPlatformServices(services());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

const button = () => container.querySelector<HTMLButtonElement>("button.pv-infotip")!;
const press = (el: Element) => act(() => { (el as HTMLElement).click(); });
function key(target: EventTarget, k: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
}
function pointerDown(target: Element) {
  act(() => { target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })); });
}

const TEXT = "The search index is Plainva's record.\n\nRebuilding it reads every file again.";

describe("InfoTip (the info button)", () => {
  it("is a real button at the end of the label, named after it, closed at first", () => {
    render(<InfoTip label="Search index" info={TEXT} />);
    const b = button();
    expect(b.tagName).toBe("BUTTON");
    // A native button: Enter and Space press it without a handler of its own.
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("aria-label")).toBe("More about Search index");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    // Never described by the text: that would read it at every focus.
    expect(b.hasAttribute("aria-describedby")).toBe(false);
    expect(container.querySelector(".pv-infotip-panel")).toBeNull();
    // The live region exists before it has anything to say — one that appears
    // together with its text is not announced reliably.
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("a press opens the panel inside the live region, one paragraph per block; a second press closes it", () => {
    render(<InfoTip label="Search index" info={TEXT} />);
    press(button());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    const panel = container.querySelector(".pv-infotip-panel")!;
    expect(panel.classList.contains("pv-popover")).toBe(true);
    expect(panel.classList.contains("pv-popover--fixed")).toBe(true);
    expect(panel.closest('[role="status"]')).not.toBeNull();
    expect([...panel.querySelectorAll(".pv-infotip-text")].map((p) => p.textContent)).toEqual([
      "The search index is Plainva's record.",
      "Rebuilding it reads every file again.",
    ]);
    press(button());
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".pv-infotip-panel")).toBeNull();
  });

  it("Escape closes it before the dialog around it hears the key, and the focus returns to the button", () => {
    const dialogHeard = vi.fn();
    document.addEventListener("keydown", dialogHeard);
    try {
      render(<InfoTip label="Search index" info={{ text: TEXT, guide: "Search.md" }} />);
      press(button());
      const link = container.querySelector<HTMLAnchorElement>(".pv-infotip-guide")!;
      act(() => link.focus());
      const event = key(link, "Escape");
      expect(event.defaultPrevented).toBe(true);
      expect(dialogHeard).not.toHaveBeenCalled();
      expect(container.querySelector(".pv-infotip-panel")).toBeNull();
      expect(document.activeElement).toBe(button());
      // Closed, Escape is the dialog's again.
      key(document.body, "Escape");
      expect(dialogHeard).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", dialogHeard);
    }
  });

  it("a press beside it closes it; a press inside does not", () => {
    render(<div><InfoTip label="Search index" info={TEXT} /><p data-testid="beside">x</p></div>);
    press(button());
    pointerDown(container.querySelector(".pv-infotip-text")!);
    expect(container.querySelector(".pv-infotip-panel")).not.toBeNull();
    pointerDown(container.querySelector('[data-testid="beside"]')!);
    expect(container.querySelector(".pv-infotip-panel")).toBeNull();
  });

  it("the user-guide link opens the page in the app language through the shell", async () => {
    render(<InfoTip label="Search index" info={{ text: TEXT, guide: "Search.md" }} />);
    press(button());
    const link = container.querySelector<HTMLAnchorElement>(".pv-infotip-guide")!;
    expect(link.textContent).toContain("Read more in the handbook");
    expect(link.getAttribute("href")).toBe("https://plainva.com/docs/search");
    press(link);
    expect(opened).toEqual(["https://plainva.com/docs/search"]);
    expect(infoGuideUrl("Journal.md#the-day-ends-at", "de")).toBe("https://plainva.com/de/docs/journal#the-day-ends-at");
    // Without a guide there is no link.
    render(<InfoTip label="Other" info="Just text." />);
    expect(container.querySelector(".pv-infotip-guide")).toBeNull();
  });

  it("a press inside never reaches the row around it", () => {
    const rowClick = vi.fn();
    render(<div onClick={rowClick}><InfoTip label="Search index" info={TEXT} /></div>);
    press(button());
    press(container.querySelector(".pv-infotip-text")!);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("in a shell with a sheet it opens that sheet instead, titled by the label, the text still in the live region", () => {
    const sheets: PlatformSheetProps[] = [];
    function Sheet(props: PlatformSheetProps) {
      sheets.push(props);
      return <div data-testid="shell-sheet"><p>{props.title}</p>{props.children}<button data-testid="sheet-close" onClick={props.onClose}>x</button></div>;
    }
    setPlatformServices(services({ Sheet }));
    render(<InfoTip label="Rebuild index" info={{ text: TEXT, guide: "Search.md" }} />);
    press(button());
    expect(container.querySelector(".pv-infotip-panel")).toBeNull();
    const sheet = container.querySelector('[data-testid="shell-sheet"]')!;
    expect(sheets[sheets.length - 1]?.title).toBe("Rebuild index");
    expect([...sheet.querySelectorAll(".pv-infotip-sheettext")].map((p) => p.textContent)).toHaveLength(2);
    const status = container.querySelector('[role="status"]')!;
    expect(status.classList.contains("pv-infotip-live")).toBe(true);
    expect(status.textContent).toBe(TEXT);
    press(sheet.querySelector('[data-testid="info-tip-guide"]')!);
    expect(opened).toEqual(["https://plainva.com/docs/search"]);
    press(sheet.querySelector('[data-testid="sheet-close"]')!);
    expect(container.querySelector('[data-testid="shell-sheet"]')).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the row primitives carry it at the end of the label", () => {
  it("page head: beside the heading, whose name stays the title", () => {
    render(<SettingsPageHead title="Maintenance" desc="Search index and statistics." info="About maintenance." />);
    const h = container.querySelector("h3.pv-setpage-title")!;
    expect(h.textContent).toBe("Maintenance");
    expect(h.querySelector("button")).toBeNull();
    expect(button().getAttribute("aria-label")).toBe("More about Maintenance");
    expect(h.nextElementSibling?.classList.contains("pv-infotip-wrap")).toBe(true);
  });

  it("card heading and row label end with the button; without info there is none", () => {
    render(
      <SettingCard label="Search index" info="About the index.">
        <SettingRow label="Rebuild" info={{ text: "Reads every file.", guide: "Search.md" }} />
        <SettingRow label="Plain" />
      </SettingCard>,
    );
    const heading = container.querySelector(".pv-setgroup-label")!;
    expect(heading.lastElementChild?.classList.contains("pv-infotip-wrap")).toBe(true);
    expect(heading.textContent).toBe("Search index");
    const labels = container.querySelectorAll(".pv-setrow-label");
    expect(labels[0].lastElementChild?.classList.contains("pv-infotip-wrap")).toBe(true);
    expect(labels[0].querySelector("button")?.getAttribute("aria-label")).toBe("More about Rebuild");
    expect(labels[1].querySelector("button")).toBeNull();
    // The card's group keeps its plain name.
    expect(container.querySelector(".pv-setcard")?.getAttribute("aria-label")).toBe("Search index");
  });

  it("a phone row that leads somewhere becomes the container form, named by its title alone", () => {
    const go = vi.fn();
    render(<RowList><Row title="Rebuild index" onClick={go} info="About the index." /></RowList>);
    const row = container.querySelector(".pv-grouprow")!;
    expect(row.tagName).toBe("DIV");
    expect(row.getAttribute("role")).toBe("button");
    const titleId = row.getAttribute("aria-labelledby")!;
    expect(document.getElementById(titleId)?.textContent).toBe("Rebuild index");
    expect(row.querySelector(".pv-grouprow-titleline .pv-infotip-wrap")).not.toBeNull();
    press(button());
    expect(go).not.toHaveBeenCalled();
    press(row);
    expect(go).toHaveBeenCalledTimes(1);
    // Without info the row stays a native button.
    render(<RowList><Row title="Plain" onClick={go} /></RowList>);
    expect(container.querySelector(".pv-grouprow")?.tagName).toBe("BUTTON");
  });

  it("a typed field keeps its label on the control, the button beside the label", () => {
    render(<SettingField label="Journal heading" info="Entries stand under this heading."><input data-testid="field" /></SettingField>);
    const input = container.querySelector<HTMLInputElement>('[data-testid="field"]')!;
    const label = container.querySelector("label.pv-rowfield-label")!;
    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.labels?.[0]?.textContent).toBe("Journal heading");
    expect(label.contains(button())).toBe(false);
    expect(container.querySelector(".pv-rowfield-head")?.lastElementChild?.classList.contains("pv-infotip-wrap")).toBe(true);
    // An id of its own is kept.
    render(<SettingField label="Folder" info="x"><input id="own" /></SettingField>);
    expect(container.querySelector("label.pv-rowfield-label")?.getAttribute("for")).toBe("own");
  });

  it("a group heading ends with it", () => {
    render(<SectionLabel info="About contents.">Contents</SectionLabel>);
    expect(button().getAttribute("aria-label")).toBe("More about Contents");
  });
});

describe('"On this device only" (E3, E14)', () => {
  it("is one badge in one wording, on rows, fields and cards", () => {
    render(<DeviceOnlyBadge />);
    expect(container.textContent).toBe("On this device only");
    render(
      <>
        <SettingCard label="Notifications" deviceOnly><SettingRow label="Level" deviceOnly desc="Mentions only." /></SettingCard>
        <RowList><Row title="Reminders" deviceOnly subtitle="On" /></RowList>
        <SettingField label="Name" deviceOnly><input /></SettingField>
      </>,
    );
    expect(container.querySelectorAll('[data-testid="device-only-badge"]')).toHaveLength(4);
    // On a row the badge stands on the line under the label, before the description.
    const descs = [...container.querySelectorAll(".pv-setrow-desc")].map((d) => d.textContent);
    expect(descs).toEqual(["On this device only", "Mentions only."]);
  });

  it("is derived from the profile catalog: what the profile carries travels", () => {
    // A vault convention travels in both shells.
    expect(travelsWithVault("dailyNotesFolder", "desktop")).toBe(true);
    expect(travelsWithVault("dailyNotesFolder", "mobile")).toBe(true);
    // A field one shell does not carry stays on that shell's device.
    expect(travelsWithVault("extendedDatabases", "desktop")).toBe(true);
    expect(travelsWithVault("extendedDatabases", "mobile")).toBe(false);
    // Mail signatures travel inside the mailbox field.
    expect(travelsWithVault("mailAccounts", "desktop")).toBe(true);
    expect(travelsWithVault("mailAccounts", "mobile")).toBe(true);
    // No profile field — reminders, comment notifications — stays here. Both
    // are kept per vault on each device and the catalog names neither.
    expect(PROFILE_FIELDS.filter((f) => /remind|commentnotif/i.test(f.logical))).toEqual([]);
    expect(travelsWithVault(undefined, "desktop")).toBe(false);
    // A typo is an error, not a quiet "stays here".
    expect(() => travelsWithVault("dailyNoteFolder", "desktop")).toThrow(/no profile field/);
  });
});
