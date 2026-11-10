// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  appendLine,
  copyLineLink,
  deliverNoteLink,
  describeEventLink,
  describeLink,
  guardedExternalOpener,
  lineLinkText,
  noteLinkMarkdown,
  openNoteLink,
  parseEventDescription,
  planLinkOpen,
  resetNoteLinkInbox,
  setNoteLinkHandler,
  setNoteLinksVaultLoading,
  toast,
  toastStore,
  type NoteLinkShell,
} from "@plainva/ui";
import { mailTextSegments, sanitizeEmailHtml } from "@plainva/ui/mail";

/**
 * Note links (F2, ADR 0037): the inbox every route in fills, the way a shell
 * opens what an address names, the copy actions at a line, and the surfaces
 * that show such a link — an event's description, a mail.
 */

const URL_PLAN = "plainva://open?vault=Work&path=Projects%2FPlan.md";

function shell(over: Partial<NoteLinkShell<string>> = {}) {
  const opened: Array<{ path: string; anchor: string | null }> = [];
  const switched: string[] = [];
  const files = new Set(["Projects/Plan.md", "Archive/Moved.md", "tool.exe"]);
  const s: NoteLinkShell<string> = {
    shownVault: { key: "/work", name: "Work" },
    knownVaults: async () => [{ key: "/work", name: "Work" }, { key: "/home", name: "Home" }, { key: "/a", name: "Twin" }, { key: "/b", name: "twin" }],
    confirmSwitch: async () => true,
    confirmOpenHere: async () => true,
    switchVault: (key) => { switched.push(key); },
    exists: async (path) => files.has(path),
    resolveName: async (name) => (name === "Moved" ? "Archive/Moved.md" : null),
    openNote: (path, anchor) => opened.push({ path, anchor }),
    ...over,
  };
  return { s, opened, switched };
}

beforeEach(() => {
  resetNoteLinkInbox();
  toast.clearAll();
});
afterEach(() => {
  resetNoteLinkInbox();
  toast.clearAll();
});

describe("the inbox", () => {
  it("keeps an address until a shell can open it, then hands it over once", () => {
    deliverNoteLink(URL_PLAN);
    const seen: string[] = [];
    const off = setNoteLinkHandler((url) => seen.push(url));
    expect(seen).toEqual([URL_PLAN]);
    deliverNoteLink("plainva://open?path=b.md");
    expect(seen).toEqual([URL_PLAN, "plainva://open?path=b.md"]);
    off();
    deliverNoteLink("plainva://open?path=c.md");
    expect(seen).toHaveLength(2);
  });

  it("keeps no more than a handful while nobody listens", () => {
    for (let i = 0; i < 20; i++) deliverNoteLink(`plainva://open?path=${i}.md`);
    const seen: string[] = [];
    setNoteLinkHandler((url) => seen.push(url));
    expect(seen).toHaveLength(8);
    expect(seen[7]).toBe("plainva://open?path=19.md");
  });

  it("is where the opener's guard sends a Plainva address — never to the system", async () => {
    const opened: string[] = [];
    const open = guardedExternalOpener(async (url) => { opened.push(url); });
    const seen: string[] = [];
    setNoteLinkHandler((url) => seen.push(url));
    await open(`  ${URL_PLAN}\n`);
    await open("plainva://graph");
    expect(opened).toEqual([]);
    expect(seen).toEqual([URL_PLAN, "plainva://graph"]);
    await open("https://a.example");
    expect(opened).toEqual(["https://a.example"]);
  });

  it("is where a Markdown link to a note address leads, as a link out of the note", async () => {
    const deps = { resolveWiki: async () => null, resolveMarkdown: async () => null, fileExists: async () => false, folderExists: async () => false };
    expect(await planLinkOpen({ text: URL_PLAN, kind: "markdown" }, deps)).toEqual({ action: "external", url: URL_PLAN });
  });
});

describe("opening what an address names", () => {
  it("opens the note of the shown vault, at its heading or block", async () => {
    const { s, opened } = shell();
    expect(await openNoteLink(URL_PLAN, s)).toBe("opened");
    expect(await openNoteLink(`${URL_PLAN}&heading=Goals`, s)).toBe("opened");
    expect(await openNoteLink(`${URL_PLAN}&block=k3x9qa`, s)).toBe("opened");
    expect(await openNoteLink("plainva://open?path=Projects%2FPlan.md", s)).toBe("opened");
    expect(opened).toEqual([
      { path: "Projects/Plan.md", anchor: null },
      { path: "Projects/Plan.md", anchor: "Goals" },
      { path: "Projects/Plan.md", anchor: "^k3x9qa" },
      { path: "Projects/Plan.md", anchor: null },
    ]);
  });

  it("finds a moved note by the link rule, and says so when it is not there", async () => {
    const { s, opened } = shell();
    expect(await openNoteLink("plainva://open?vault=work&path=Old%2FMoved.md", s)).toBe("opened");
    expect(opened).toEqual([{ path: "Archive/Moved.md", anchor: null }]);
    expect(await openNoteLink("plainva://open?vault=Work&path=Gone.md", s)).toBe("not-found");
    const notices = toastStore.get();
    expect(notices[notices.length - 1]?.message).toContain("Gone");
  });

  it("never opens a file the system would run", async () => {
    const { s, opened } = shell();
    expect(await openNoteLink("plainva://open?vault=Work&path=tool.exe", s)).toBe("not-openable");
    expect(opened).toEqual([]);
  });

  it("asks before it switches to another vault, and the link waits for that vault", async () => {
    const asked: string[] = [];
    const { s, switched, opened } = shell({ confirmSwitch: async (name) => { asked.push(name); return true; } });
    expect(await openNoteLink("plainva://open?vault=Home&path=Projects%2FPlan.md", s)).toBe("switching");
    expect(asked).toEqual(["Home"]);
    expect(switched).toEqual(["/home"]);
    expect(opened).toEqual([]);
    // The handler of the new vault takes the waiting link, without asking again.
    const home = shell({ shownVault: { key: "/home", name: "Home" } });
    const calls: Array<[string, boolean]> = [];
    setNoteLinkHandler((url, again) => {
      calls.push([url, again]);
      void openNoteLink(url, home.s, again);
    });
    expect(calls).toEqual([["plainva://open?vault=Home&path=Projects%2FPlan.md", true]]);
    await vi.waitFor(() => expect(home.opened).toEqual([{ path: "Projects/Plan.md", anchor: null }]));
  });

  it("switches nothing when the person says no, and never asks twice for one link", async () => {
    const no = shell({ confirmSwitch: async () => false });
    expect(await openNoteLink("plainva://open?vault=Home&path=a.md", no.s)).toBe("declined");
    expect(no.switched).toEqual([]);
    // The old vault registering again mid-switch: the link keeps waiting, nobody is asked twice.
    const asked: string[] = [];
    const again = shell({ confirmSwitch: async (name) => { asked.push(name); return true; } });
    expect(await openNoteLink("plainva://open?vault=Home&path=a.md", again.s, true)).toBe("switching");
    expect(asked).toEqual([]);
    expect(again.switched).toEqual([]);
    const seen: Array<[string, boolean]> = [];
    setNoteLinkHandler((url, w) => seen.push([url, w]));
    expect(seen).toEqual([["plainva://open?vault=Home&path=a.md", true]]);
  });

  it("says when the vault is not on this device or the name is not unique", async () => {
    const { s, switched } = shell();
    expect(await openNoteLink("plainva://open?vault=Elsewhere&path=a.md", s)).toBe("vault-unknown");
    expect(await openNoteLink("plainva://open?vault=Twin&path=a.md", s)).toBe("vault-ambiguous");
    expect(switched).toEqual([]);
    expect(toastStore.get().map((n) => n.message).join(" ")).toContain("Elsewhere");
  });

  it("refuses an address it cannot read, in one sentence that does not repeat it", async () => {
    const { s, opened } = shell();
    for (const url of ["plainva://open?path=..%2Fsecret.md", "plainva://run?path=a.md", "plainva://open?path=a.md&block=a%20b"]) {
      expect(await openNoteLink(url, s)).toBe("invalid");
    }
    expect(opened).toEqual([]);
    const messages = toastStore.get().map((n) => n.message);
    expect(messages.every((m) => !m.includes("secret"))).toBe(true);
  });
});

describe("Copy link and Copy block link at a line", () => {
  let clip: string[] = [];
  beforeEach(() => {
    clip = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { clip.push(text); } } });
  });

  const ctx = { notePath: "Projects/Plan.md", vaultName: "Work", wikiName: "Plan" };
  const viewOf = (doc: string, readOnly = false) =>
    new EditorView({ state: EditorState.create({ doc, extensions: readOnly ? [EditorState.readOnly.of(true)] : [] }), parent: document.body });

  it("types the id into the editor and copies the wiki link to the block", async () => {
    const view = viewOf("# Plan\n\nFirst point\n");
    expect(await copyLineLink(view, view.state.doc.line(3).from, "wiki", ctx)).toBe(true);
    const text = view.state.doc.toString();
    const id = /\^([a-z0-9]{6})\n$/.exec(text)?.[1];
    expect(id).toBeTruthy();
    expect(clip).toEqual([`[[Plan#^${id}]]`]);
    // The second copy reuses it.
    expect(lineLinkText(view, view.state.doc.line(3).from, "url", ctx)).toBe(`plainva://open?vault=Work&path=Projects%2FPlan.md&block=${id}`);
    expect(view.state.doc.toString()).toBe(text);
    view.destroy();
  });

  it("links a heading by its text and writes nothing", () => {
    const view = viewOf("# Plan\n\n## Goals for 2027\n");
    expect(lineLinkText(view, view.state.doc.line(3).from, "wiki", ctx)).toBe("[[Plan#Goals for 2027]]");
    expect(lineLinkText(view, view.state.doc.line(3).from, "url", ctx)).toBe("plainva://open?vault=Work&path=Projects%2FPlan.md&heading=Goals%20for%202027");
    expect(view.state.doc.toString()).toBe("# Plan\n\n## Goals for 2027\n");
    view.destroy();
  });

  it("refuses where no id may stand and in a read-only note, writing nothing", () => {
    const code = viewOf("```\ncode\n```\n");
    expect(lineLinkText(code, code.state.doc.line(2).from, "wiki", ctx)).toBeNull();
    expect(code.state.doc.toString()).toBe("```\ncode\n```\n");
    const ro = viewOf("Para\n", true);
    expect(lineLinkText(ro, 0, "wiki", ctx)).toBeNull();
    expect(ro.state.doc.toString()).toBe("Para\n");
    expect(toastStore.get()).toHaveLength(2);
    code.destroy();
    ro.destroy();
  });
});

describe("where a note link is shown", () => {
  it("an event's description shows it as a chip with the note's name", () => {
    const blocks = parseEventDescription(`Agenda: [Plan](${URL_PLAN}&heading=Goals) and ${URL_PLAN}.`);
    const links = JSON.stringify(blocks);
    expect(links).toContain('"note":true');
    expect(describeEventLink(`${URL_PLAN}&heading=Goals`)).toMatchObject({ host: "Plan › Goals", tip: "Projects/Plan.md", note: true });
    expect(describeEventLink("plainva://graph")).toBeNull();
  });

  it("a mail keeps it, in HTML and in plain text, and still drops what executes", () => {
    const html = sanitizeEmailHtml(`<a href="${URL_PLAN}">Plan</a><a href="javascript:alert(1)">x</a>`).html;
    expect(html).toContain(`href="${URL_PLAN.replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("javascript:");
    expect(describeLink(URL_PLAN)).toMatchObject({ kind: "note", host: "Plan" });
    expect(describeLink("plainva://open?path=..%2Fx.md")).toBeNull();
    expect(mailTextSegments(`See ${URL_PLAN}.`)).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", href: URL_PLAN, text: URL_PLAN },
      { kind: "text", text: "." },
    ]);
  });

  it("an event editor writes it as a Markdown link on a line of its own", () => {
    expect(noteLinkMarkdown("Plan [draft]", URL_PLAN)).toBe(`[Plan \\[draft\\]](${URL_PLAN})`);
    expect(appendLine("", "x")).toBe("x");
    expect(appendLine("Agenda\n\n", "x")).toBe("Agenda\n\nx");
  });
});

describe("`[[Note#^` suggests the blocks the note has", () => {
  it("lists their ids with the start of their text, and inserts the link", async () => {
    const { CompletionContext } = await import("@codemirror/autocomplete");
    const { wikiLinkCompletionSource } = await import("@plainva/ui");
    const note = "# Plan\n\n- [ ] Call Anna about the offer ^call01\n\nA long paragraph that goes on and on and on and on and on and on ^para02\n\n| A |\n| - |\n\n^tab003\n";
    const source = wikiLinkCompletionSource({
      getQueryService: () => ({ db: { query: async () => [] }, resolveNotePath: async () => "Plan.md" }) as never,
      readNote: async () => note,
      hostPath: () => "Other.md",
    } as never);
    const at = (doc: string) => source(new CompletionContext(EditorState.create({ doc }), doc.length, false));
    const all = await at("See [[Plan#^");
    expect(all?.options.map((o) => o.label)).toEqual(["^call01", "^para02", "^tab003"]);
    expect(all?.options[0].detail).toBe("Call Anna about the offer");
    expect(String(all?.options[1].detail).endsWith("…")).toBe(true);
    const narrowed = await at("See [[Plan#^pa");
    expect(narrowed?.options.map((o) => o.label)).toEqual(["^para02"]);
    expect(await at("See [[Plan#^zz")).toBeNull();
  });
});

describe("F2 review: what a link may reach, how long it waits, how often it asks", () => {
  it("asks to open the note in the shown vault when the named vault is not here — never silently", async () => {
    const asked: Array<[string, string, boolean]> = [];
    const yes = shell({ confirmOpenHere: async (vault, note, ambiguous) => { asked.push([vault, note, ambiguous]); return true; } });
    expect(await openNoteLink("plainva://open?vault=Phone%20vault&path=Projects%2FPlan.md&heading=Goals", yes.s)).toBe("opened");
    // The question names the path of the note that will open — here the link rule leads to another folder.
    expect(await openNoteLink("plainva://open?vault=Twin&path=Elsewhere%2FMoved.md", yes.s)).toBe("opened");
    expect(asked).toEqual([["Phone vault", "Projects/Plan.md", false], ["Twin", "Archive/Moved.md", true]]);
    expect(yes.opened).toEqual([{ path: "Projects/Plan.md", anchor: "Goals" }, { path: "Archive/Moved.md", anchor: null }]);
    const no = shell({ confirmOpenHere: async () => false });
    expect(await openNoteLink("plainva://open?vault=Twin&path=Old%2FMoved.md", no.s)).toBe("declined");
    expect(no.opened).toEqual([]);
    // Without a match in the shown vault the message stays as it was.
    const none = shell({ confirmOpenHere: async () => { throw new Error("must not ask"); } });
    expect(await openNoteLink("plainva://open?vault=Elsewhere&path=Gone.md", none.s)).toBe("vault-unknown");
  });

  it("checks the path that is finally opened: the link rule leading to a hidden or internal file opens nothing", async () => {
    for (const found of [".drafts/Plan.md", ".Plainva/sync/keyfile.json", "tool.exe"]) {
      const { s, opened } = shell({ exists: async () => false, resolveName: async () => found });
      expect(await openNoteLink("plainva://open?vault=Work&path=Plan.md", s), found).toBe("not-openable");
      expect(opened).toEqual([]);
    }
  });

  it("drops an address nobody took within a minute of the app being able to take it — silently", () => {
    let now = 0;
    resetNoteLinkInbox(() => now);
    deliverNoteLink("plainva://open?path=a.md");
    now = 10 * 60_000; // a vault took ten minutes to load: the clock stood still
    setNoteLinksVaultLoading(false);
    now += 30_000;
    const seen: string[] = [];
    let off = setNoteLinkHandler((url) => seen.push(url));
    expect(seen).toEqual(["plainva://open?path=a.md"]);
    off();
    deliverNoteLink("plainva://open?path=b.md");
    now += 61_000;
    off = setNoteLinkHandler((url) => seen.push(url));
    expect(seen).toEqual(["plainva://open?path=a.md"]);
    expect(toastStore.get()).toEqual([]);
    off();
  });

  it("asks one question at a time: a burst of 20 links leaves one question and steals nothing", async () => {
    let answer: (yes: boolean) => void = () => undefined;
    let questions = 0;
    const { s, switched } = shell({ confirmSwitch: () => { questions += 1; return new Promise<boolean>((resolve) => { answer = resolve; }); } });
    const burst = Array.from({ length: 20 }, (_, i) => openNoteLink(i % 2 ? "plainva://open?vault=Home&path=a.md" : `plainva://open?vault=Home&path=${i}.md`, s));
    await vi.waitFor(() => expect(questions).toBe(1));
    const extra = await openNoteLink("plainva://open?vault=Home&path=late.md", s);
    expect(extra).toBe("busy");
    answer(true);
    const outcomes = await Promise.all(burst);
    expect(questions).toBe(1);
    expect(switched).toEqual(["/home"]);
    expect(outcomes.filter((o) => o === "switching")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "busy")).toHaveLength(19);
  });

  it("the desktop's shell looks a path up in the index, never on the disk, and refuses other spellings of internal folders", async () => {
    const { desktopNoteLinkShell } = await import("../services/noteLinkReceiver");
    const asked: string[][] = [];
    const opened: string[] = [];
    const desk = desktopNoteLinkShell({
      vaultPath: "C:/Vaults/Work",
      recentVaults: [],
      queryService: {
        fileRecords: async (paths: readonly string[]) => { asked.push([...paths]); return new Map(paths.filter((p) => p === "Projects/Plan.md").map((p) => [p, {} as never])); },
        resolveNotePath: async () => null,
      },
      openVault: async () => true,
      openNote: (path) => opened.push(path),
      confirm: async () => true,
      bringForward: async () => undefined,
    });
    expect(await openNoteLink("plainva://open?vault=Work&path=Projects%2FPlan.md", desk)).toBe("opened");
    for (const path of [".Plainva/sync/keyfile.json", ".plainva./sync/keyfile.json", ".agent/policy.yml"]) {
      expect(await openNoteLink(`plainva://open?vault=Work&path=${encodeURIComponent(path)}`, desk), path).toBe("invalid");
    }
    // A device name or an 8.3 alias is a name like any other there: the index does not hold it, the disk is not asked.
    expect(await openNoteLink("plainva://open?vault=Work&path=NUL.md", desk)).toBe("not-found");
    expect(await openNoteLink("plainva://open?vault=Work&path=PLAINV~1%2Fsync%2Fkeyfile.json", desk)).toBe("not-found");
    expect(opened).toEqual(["Projects/Plan.md"]);
    expect(asked).toContainEqual(["PLAINV~1/sync/keyfile.json"]);
  });

  it("links from content never reach the app's folders; a name of an unusual shape opens where the vault's listing holds it", async () => {
    const { linkDiskProbe } = await import("@plainva/ui");
    const probed: string[] = [];
    const raw = {
      resolveWiki: async () => null,
      resolveMarkdown: async () => null,
      fileExists: async (path: string) => { probed.push(path); return true; },
      folderExists: async () => false,
    };
    expect(await planLinkOpen({ text: ".Plainva/sync/keyfile", kind: "wiki" }, raw)).toEqual({ action: "notFound", target: ".Plainva/sync/keyfile" });
    expect(await planLinkOpen({ text: ".Plainva/sync/keyfile.json", kind: "markdown", parsed: true }, raw)).toMatchObject({ action: "notFound" });
    expect(probed).toEqual([]);
    // Not on Windows (the test's browser): `[[CON]]` is an ordinary note name and may be created.
    expect(await planLinkOpen({ text: "CON", kind: "wiki" }, { ...raw, fileExists: async () => false })).toMatchObject({ action: "create" });
    // The probe over a vault adapter: only what the listing holds.
    const listing: Record<string, string[]> = { "": ["Meeting 10:30.md", "aux.md", ".plainva"] };
    const disk = new Set(["Meeting 10:30.md", "aux.md", "PLAINV~1/sync/keyfile.json"]);
    const probe = linkDiskProbe({
      exists: async (path: string) => disk.has(path),
      getFileInfo: async () => ({ isDirectory: false }),
      listDir: async (folder?: string) => (listing[folder ?? ""] ?? []).map((name) => ({ name })),
    });
    const deps = { resolveWiki: async () => null, resolveMarkdown: async () => null, ...probe };
    expect(await planLinkOpen({ text: "Meeting 10:30.md", kind: "markdown", parsed: true }, deps)).toMatchObject({ action: "open", path: "Meeting 10:30.md" });
    expect(await planLinkOpen({ text: "aux.md", kind: "markdown", parsed: true }, deps)).toMatchObject({ action: "open", path: "aux.md" });
    expect(await planLinkOpen({ text: "PLAINV~1/sync/keyfile.json", kind: "markdown", parsed: true }, deps)).toMatchObject({ action: "notFound" });
  });

  it("embeds of real files with unusual names load again; only the app's folders and spellings the listing does not hold are refused", async () => {
    const { resolveVaultRelative, imageCandidates, imageBasename, readContentBinary, safeRelPath } = await import("@plainva/ui");
    for (const target of ["IMG~1.JPG", "scans/scan~2.pdf", "Plan~1.png", "draft~3", "Meeting 10:30.png", "Re: offer.pdf", "aux.png", "con.jpg", "nul.png", "COM1.png", "con.tagion.png", "Aux/x.png"]) {
      expect(resolveVaultRelative(target), target).toBe(target);
    }
    expect(imageCandidates("aux.png", { notePath: "Notes/a.md", attachmentFolder: "Aux" })).toEqual(["aux.png", "Notes/aux.png", "Aux/aux.png"]);
    expect(imageBasename("Aux/IMG~1.JPG")).toBe("IMG~1.JPG");
    for (const target of [".Plainva/sync/keyfile.json", ".plainva./x"]) expect(resolveVaultRelative(target), target).toBeNull();
    const read: string[] = [];
    const mac = {
      readBinaryFile: async (path: string) => { read.push(path); return new Uint8Array([1]); },
      listDir: async (folder?: string) => ((folder ?? "") === "" ? ["aux.png", "Meeting 10:30.png", "Aux"] : folder === "Aux" ? ["IMG~1.JPG"] : []).map((name) => ({ name })),
    };
    for (const path of ["aux.png", "Meeting 10:30.png", "Aux/IMG~1.JPG", "Attachments/plain.png"]) await readContentBinary(mac, path);
    expect(read).toEqual(["aux.png", "Meeting 10:30.png", "Aux/IMG~1.JPG", "Attachments/plain.png"]);
    const windows = { readBinaryFile: mac.readBinaryFile, listDir: async () => [{ name: ".plainva" }, { name: "Attachments" }] };
    for (const path of ["PLAINV~1/sync/keyfile.json", "aux.png", "img.png:stream"]) await expect(readContentBinary(windows, path), path).rejects.toThrow();
    expect(read).toHaveLength(4);
    // The assistant: the app's folders never; an unusual shape only where the vault knows the file (readAllowed).
    expect(safeRelPath(".Plainva/x.md")).toBeNull();
    expect(safeRelPath("Meeting 10:30.md")).toBe("Meeting 10:30.md");
    expect(safeRelPath("PLAINV~1/sync/keyfile.json")).toBe("PLAINV~1/sync/keyfile.json");
  });

  it("a link whose vault switch the person agreed to does not expire while the switch runs", () => {
    let now = 0;
    resetNoteLinkInbox(() => now);
    setNoteLinksVaultLoading(false);
    const seen: Array<[string, boolean]> = [];
    // Parked as switched, by the inbox's own path: a handler that re-parks it (the old vault, mid-switch).
    let off = setNoteLinkHandler(() => undefined);
    off();
    // simulate: openNoteLink parked it after the person said yes
    const shellSwitch = shell({ confirmSwitch: async () => true, switchVault: () => undefined });
    return openNoteLink("plainva://open?vault=Home&path=a.md", shellSwitch.s).then((outcome) => {
      expect(outcome).toBe("switching");
      now += 10 * 60_000; // a large vault: ten minutes
      off = setNoteLinkHandler((url, switched) => seen.push([url, switched]));
      expect(seen).toEqual([["plainva://open?vault=Home&path=a.md", true]]);
      off();
    });
  });

  it("a second link while a question is open is told why nothing happens — once; a flood after it stays silent", async () => {
    let answer: (yes: boolean) => void = () => undefined;
    let open = false;
    const { s } = shell({ confirmSwitch: () => { open = true; return new Promise<boolean>((resolve) => { answer = resolve; }); } });
    const first = openNoteLink("plainva://open?vault=Home&path=a.md", s);
    await vi.waitFor(() => expect(open).toBe(true));
    for (let i = 0; i < 5; i++) expect(await openNoteLink(`plainva://open?vault=Home&path=${i}.md`, s)).toBe("busy");
    expect(toastStore.get().filter((n) => n.message === "Answer the open question first.")).toHaveLength(1);
    answer(false);
    expect(await first).toBe("declined");
  });

  it("the desktop's shell asks the disk only for a note the index does not hold yet, and only for an ordinary name", async () => {
    const { desktopNoteLinkShell } = await import("../services/noteLinkReceiver");
    const diskAsked: string[] = [];
    const desk = desktopNoteLinkShell({
      vaultPath: "C:/Vaults/Work",
      recentVaults: [],
      queryService: { fileRecords: async () => new Map(), resolveNotePath: async () => null },
      vaultAdapter: { exists: async (path: string) => { diskAsked.push(path); return path === "Fresh.md" || path === "aux.md"; } },
      openVault: async () => true,
      openNote: () => undefined,
      confirm: async () => true,
      bringForward: async () => undefined,
    });
    expect(await desk.exists("Fresh.md")).toBe(true);
    expect(await desk.exists("aux.md")).toBe(false);
    expect(diskAsked).toEqual(["Fresh.md"]);
  });
});
