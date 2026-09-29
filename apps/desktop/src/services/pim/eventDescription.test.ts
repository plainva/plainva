import { describe, expect, it } from "vitest";
// Not part of the core's public surface; the providers call it internally.
import { htmlToMarkdown } from "../../../../../packages/core/src/pim/htmlToMarkdown";
import {
  describeEventLink,
  meetingJoinOf,
  parseEventDescription,
  type EventDescBlock,
  type EventDescInline,
} from "@plainva/ui";

/**
 * The description of a calendar event, read for display (plan Befunde 24.09.,
 * E25; finding: TestFlight 22.09.). Outlook wraps every link of an invitation
 * in a Safe Link — pages of percent-encoding in the preview, not tappable on
 * the phone, and on the desktop a click never reached the app's opener.
 */

const TEAMS = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NzQ5ZDk3YjctN2E1Ni00%40thread.v2/0?context=%7b%22Tid%22%3a%22a1b2c3d4%22%7d";
const SAFE_TEAMS =
  "https://nam12.safelinks.protection.outlook.com/?url=" +
  encodeURIComponent(TEAMS) +
  "&data=05%7C02%7C%7Cc0ffee%7C0%7C0%7C638624&sdata=Zm9vYmFy%3D&reserved=0";
const SAFE_DOC =
  "https://nam12.safelinks.protection.outlook.com/?url=" +
  encodeURIComponent("https://contoso.sharepoint.com/sites/Planung/Q4.docx") +
  "&data=05%7C02%7C%7C&reserved=0";

/** All links of a parsed description, in reading order. */
function links(blocks: EventDescBlock[]): Array<Extract<EventDescInline, { kind: "link" }>> {
  const out: Array<Extract<EventDescInline, { kind: "link" }>> = [];
  const walk = (nodes: EventDescInline[]) => {
    for (const n of nodes) {
      if (n.kind === "link") out.push(n);
      else if (n.kind === "strong" || n.kind === "em") walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.kind === "p") b.lines.forEach(walk);
    else if (b.kind === "h") walk(b.inline);
    else b.items.forEach(walk);
  }
  return out;
}

/** The visible text of a parsed description (links as their host). */
function plain(blocks: EventDescBlock[]): string {
  const inline = (nodes: EventDescInline[]): string =>
    nodes
      .map((n) =>
        n.kind === "text" || n.kind === "code"
          ? n.text
          : n.kind === "link"
            ? n.label ?? n.link.host
            : inline(n.children)
      )
      .join("");
  return blocks
    .map((b) => (b.kind === "p" ? b.lines.map(inline).join("\n") : b.kind === "h" ? inline(b.inline) : b.items.map((i) => `• ${inline(i)}`).join("\n")))
    .join("\n\n");
}

describe("describeEventLink", () => {
  it("shows a Safe Link as the host of its TARGET and keeps the Safe Link as what opens", () => {
    const view = describeEventLink(SAFE_TEAMS)!;
    expect(view.host).toBe("teams.microsoft.com");
    expect(view.viaSafeLinks).toBe(true);
    // Never bypass the organisation's check: the href is the original address.
    expect(view.href).toBe(SAFE_TEAMS);
    expect(view.tip.startsWith("https://teams.microsoft.com/l/meetup-join/")).toBe(true);
  });

  it("recognises the government cloud's Safe Links too", () => {
    const gov = "https://gcc02.safelinks.protection.office365.us/?url=" + encodeURIComponent("https://example.gov/a");
    expect(describeEventLink(gov)).toMatchObject({ host: "example.gov", viaSafeLinks: true, href: gov });
  });

  it("takes a plain address as it is", () => {
    expect(describeEventLink("https://example.org/a/b?c=1")).toEqual({
      href: "https://example.org/a/b?c=1",
      host: "example.org",
      tip: "https://example.org/a/b?c=1",
      viaSafeLinks: false,
    });
  });

  it("links only http(s)", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "mailto:a@example.org", "ftp://example.org", "not a url"]) {
      expect(describeEventLink(href), href).toBeNull();
    }
  });

  it("does not follow a Safe Link to a target that is not http(s)", () => {
    const evil = "https://eur01.safelinks.protection.outlook.com/?url=" + encodeURIComponent("javascript:alert(1)");
    const view = describeEventLink(evil)!;
    expect(view.viaSafeLinks).toBe(false);
    expect(view.host).toBe("eur01.safelinks.protection.outlook.com");
    expect(view.href).toBe(evil);
  });

  it("shortens a long encoded address for the tooltip, never for what opens", () => {
    const long = "https://example.org/" + "%7B%22a%22%3A%22b%22%7D".repeat(40);
    const view = describeEventLink(long)!;
    expect(view.host).toBe("example.org");
    expect(view.tip.length).toBeLessThanOrEqual(96);
    expect(view.tip.endsWith("…")).toBe(true);
    expect(view.href).toBe(long);
  });
});

describe("parseEventDescription", () => {
  it("turns the Outlook invitation of the finding into two readable links", () => {
    // The raw description as it arrived on the phone (TestFlight 22.09.).
    const text = `Microsoft Teams Besprechung ${SAFE_TEAMS} Unterlagen: ${SAFE_DOC}`;
    const blocks = parseEventDescription(text);
    const found = links(blocks);
    expect(found.map((l) => [l.link.host, l.link.viaSafeLinks, l.link.href])).toEqual([
      ["teams.microsoft.com", true, SAFE_TEAMS],
      ["contoso.sharepoint.com", true, SAFE_DOC],
    ]);
    expect(plain(blocks)).toBe("Microsoft Teams Besprechung teams.microsoft.com Unterlagen: contoso.sharepoint.com");
  });

  it("reads what htmlToMarkdown makes of an HTML invitation", () => {
    const html =
      `<div><p><b>Microsoft Teams</b> meeting</p>` +
      `<p><a href="${SAFE_TEAMS.replace(/&/g, "&amp;")}">Click here to join the meeting</a></p>` +
      `<p>Meeting ID: 123 456<br>Passcode: a_b*c</p>` +
      `<p>________________________________________________________________________________</p>` +
      `<ul><li>Agenda</li><li><a href="https://example.org/docs">https://example.org/docs</a></li></ul></div>`;
    const blocks = parseEventDescription(htmlToMarkdown(html));
    const found = links(blocks);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ label: "Click here to join the meeting", link: { host: "teams.microsoft.com", viaSafeLinks: true, href: SAFE_TEAMS } });
    // A label that only repeats the address adds nothing: the chip shows the host.
    expect(found[1]).toMatchObject({ label: null, link: { host: "example.org", href: "https://example.org/docs" } });
    const text = plain(blocks);
    expect(text).toContain("Microsoft Teams meeting");
    expect(text).toContain("Meeting ID: 123 456\nPasscode: a_b*c"); // escapes undone, line break kept
    expect(text).not.toContain("____"); // the separator rule is dropped
    expect(text).toContain("• Agenda");
    expect(blocks[0]).toMatchObject({ kind: "p", lines: [[{ kind: "strong" }, { kind: "text", text: " meeting" }]] });
  });

  it("keeps a non-http link as its words", () => {
    const blocks = parseEventDescription("Write to [the team](mailto:team@example.org) or [x](javascript:alert%281%29)");
    expect(links(blocks)).toHaveLength(0);
    expect(plain(blocks)).toBe("Write to the team or x");
  });

  it("shows an image by its alt text, never by loading it", () => {
    expect(plain(parseEventDescription("![Teams logo](https://example.org/logo.png) Join"))).toBe("Teams logo Join");
    expect(links(parseEventDescription("![Teams logo](https://example.org/logo.png)"))).toHaveLength(0);
  });

  it("understands autolinks and trims punctuation off a bare address", () => {
    const found = links(parseEventDescription("See <https://example.org/a>, or (https://example.org/b)."));
    expect(found.map((l) => l.link.href)).toEqual(["https://example.org/a", "https://example.org/b"]);
  });

  it("drops the escapes htmlToMarkdown put into an address it found as text", () => {
    // A browser reads `a\_b` as `a/_b` — the escape is Markdown's, not the address's.
    const md = htmlToMarkdown("<p>Notes: https://example.org/plan_q4_final</p>");
    expect(md).toContain("\\_");
    expect(links(parseEventDescription(md)).map((l) => l.link.href)).toEqual(["https://example.org/plan_q4_final"]);
  });

  it("does not take an address out of the middle of a word", () => {
    expect(links(parseEventDescription("xhttps://example.org"))).toHaveLength(0);
  });

  it("leaves unpaired markers as text", () => {
    expect(plain(parseEventDescription("5 * 3 = 15, **bold and [open"))).toBe("5 * 3 = 15, **bold and [open");
  });

  it("returns nothing for an empty description", () => {
    expect(parseEventDescription("")).toEqual([]);
    expect(parseEventDescription(undefined)).toEqual([]);
    expect(parseEventDescription("\n\n  \n")).toEqual([]);
  });
});

describe("parseEventDescription is linear on hostile input", () => {
  // A description is written by whoever sends the invitation. Each of these
  // makes a backtracking or rescanning parser quadratic or worse; a linear one
  // finishes them in a few milliseconds.
  const hostile: Array<[string, string]> = [
    ["unclosed brackets", "[".repeat(60_000)],
    ["brackets without parens", "[a]".repeat(30_000)],
    ["unclosed link destinations", "[a](".repeat(20_000)],
    ["unclosed strong", "**a ".repeat(25_000)],
    ["star runs", "*".repeat(100_000)],
    ["stars with spaces", "* a ".repeat(25_000)],
    ["broken addresses", "http://[".repeat(12_000)],
    ["unclosed autolinks", "<https://a".repeat(10_000)],
    // One `>` at the very end: each `<` used to look it up and read the whole
    // rest of the line again (seconds at this size).
    ["autolinks closed only at the end", "<https://a ".repeat(15_000) + ">"],
    ["autolinks without spaces, closed only at the end", "<https://a<".repeat(15_000) + ">"],
    ["backticks", "`a".repeat(50_000)],
    ["escapes", "\\".repeat(100_000)],
    ["nested emphasis", "**a *b ".repeat(15_000)],
    ["many lines", "- [x](\n".repeat(30_000)],
  ];
  for (const [name, input] of hostile) {
    it(name, () => {
      const started = performance.now();
      parseEventDescription(input);
      expect(performance.now() - started).toBeLessThan(1_000);
    });
  }
});

describe("meetingJoinOf", () => {
  it("names the service when the join link's host says which one it is", () => {
    expect(meetingJoinOf(TEAMS)).toEqual({ href: TEAMS, service: "Teams" });
    expect(meetingJoinOf("https://meet.google.com/abc-defg-hij")?.service).toBe("Meet");
    expect(meetingJoinOf("https://us02web.zoom.us/j/123")?.service).toBe("Zoom");
    expect(meetingJoinOf("https://acme.webex.com/meet/x")?.service).toBe("Webex");
  });

  it("follows a Safe Link for the name but opens the Safe Link", () => {
    expect(meetingJoinOf(SAFE_TEAMS)).toEqual({ href: SAFE_TEAMS, service: "Teams" });
  });

  it("offers an unknown service without a name, and nothing for a non-http link", () => {
    expect(meetingJoinOf("https://meet.example.org/room")).toEqual({ href: "https://meet.example.org/room", service: null });
    expect(meetingJoinOf("tel:+4930123456")).toBeNull();
    expect(meetingJoinOf(undefined)).toBeNull();
    expect(meetingJoinOf("")).toBeNull();
  });

  it("does not mistake a look-alike host for the service", () => {
    expect(meetingJoinOf("https://evilteams.microsoft.com.example.org/x")?.service).toBeNull();
    expect(meetingJoinOf("https://notzoom.us/x")?.service).toBeNull();
  });
});
