import { describe, expect, it } from "vitest";
import { describeHttpLink, describeLink, hostNamedByText, registrableHost } from "@plainva/ui";

/**
 * Where a link leads (plan Befunde 06.10., M1). The description is what the
 * mail reader shows before a link is followed, so every case here is a way a
 * stranger's link can look like something it is not.
 */

const SAFE = (target: string) =>
  "https://nam12.safelinks.protection.outlook.com/?url=" + encodeURIComponent(target) + "&data=05%7C02%7C%7C&reserved=0";

/** The destination as one string, the way a surface lays it out. */
const shown = (href: string, text?: string) => {
  const link = describeLink(href, text);
  return link ? `${link.before}[${link.host}]${link.after}` : null;
};

describe("what a link shows", () => {
  it("singles out the host of an ordinary address", () => {
    expect(shown("https://nordlicht.example/kunden/rechnungen/2026-10?ref=mail")).toBe(
      "https://[nordlicht.example]/kunden/rechnungen/2026-10?ref=mail"
    );
    // A bare origin has no path worth showing.
    expect(shown("https://nordlicht.example/")).toBe("https://[nordlicht.example]");
    expect(shown("http://nordlicht.example:8080/a#b")).toBe("http://[nordlicht.example]:8080/a#b");
  });

  it("opens the address as written, a Safe Link included", () => {
    const href = SAFE("https://nordlicht.example/kunden/rechnungen/2026-10");
    const link = describeLink(`  ${href}  `)!;
    expect(link.href).toBe(href);
    expect(link.viaSafeLinks).toBe(true);
    // Shown is the real target, not the rewriter.
    expect(link.host).toBe("nordlicht.example");
    expect(link.after).toBe("/kunden/rechnungen/2026-10");
  });

  it("knows the government cloud's rewriter and ignores a Safe Link without a usable target", () => {
    expect(describeLink("https://x.safelinks.protection.office365.us/?url=" + encodeURIComponent("https://a.example/b"))!.host).toBe("a.example");
    const broken = describeLink("https://nam12.safelinks.protection.outlook.com/?url=javascript%3Aalert(1)")!;
    expect(broken.viaSafeLinks).toBe(false);
    expect(broken.host).toBe("nam12.safelinks.protection.outlook.com");
  });

  it("a host that merely CONTAINS the rewriter's name is not a Safe Link", () => {
    const link = describeLink("https://safelinks.protection.outlook.com.evil.example/?url=" + encodeURIComponent("https://bank.example/"))!;
    expect(link.viaSafeLinks).toBe(false);
    expect(link.host).toBe("safelinks.protection.outlook.com.evil.example");
  });

  it("refuses schemes nobody should follow from a stranger's text", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "", "   ", "not a url", "/relative", "#anchor"]) {
      expect(describeLink(href), href).toBeNull();
    }
  });

  it("describes a mail address and a phone number without a web host", () => {
    const mail = describeLink("mailto:anna%40example.org?subject=Hallo")!;
    expect(mail.kind).toBe("mailto");
    expect(`${mail.before}[${mail.host}]`).toBe("mailto:anna@[example.org]");
    const tel = describeLink("tel:+49301234567")!;
    expect(tel.kind).toBe("tel");
    expect(tel.before).toBe("tel:+49301234567");
    expect(tel.host).toBe("");
  });

  it("is not fooled by a name in front of the @", () => {
    // What the eye reads is "bank.example"; where it goes is evil.example.
    const link = describeLink("https://bank.example@evil.example/login")!;
    expect(link.host).toBe("evil.example");
    expect(link.before).toBe("https://bank.example@");
    // A long made-up name must not push the real host out of sight.
    const long = describeLink(`https://${"secure-login.bank.example.".repeat(8)}x@evil.example/`)!;
    expect(long.host).toBe("evil.example");
    expect(long.before.length).toBeLessThanOrEqual("https://".length + 25);
  });

  it("shows an internationalised look-alike in its punycode form", () => {
    // Cyrillic "а" in place of the Latin one: the same pixels, another host.
    const link = describeLink("https://pаypal.example/login", "paypal.example")!;
    expect(link.host.startsWith("xn--")).toBe(true);
    expect(link.textHost).toBe("paypal.example");
  });

  it("keeps the event description's reading of an address", () => {
    expect(describeHttpLink("mailto:a@b.example")).toBeNull();
    expect(describeHttpLink(SAFE("https://contoso.example/Q4.docx"))).toEqual({
      href: SAFE("https://contoso.example/Q4.docx"),
      host: "contoso.example",
      address: "https://contoso.example/Q4.docx",
      viaSafeLinks: true,
    });
  });
});

describe("the visible text names another host", () => {
  it("says so when the text is an address that leads elsewhere", () => {
    const link = describeLink("https://nordlicht-rechnung.example/login", "https://nordlicht.example/rechnung")!;
    expect(link.textHost).toBe("nordlicht.example");
    expect(describeLink("https://evil.example/", "www.bank.example")!.textHost).toBe("www.bank.example");
    expect(describeLink("https://evil.example/", "bank.example/konto")!.textHost).toBe("bank.example");
    // Brackets and a full stop around the address are not part of it.
    expect(describeLink("https://evil.example/", "<https://bank.example>.")!.textHost).toBe("bank.example");
  });

  it("stays quiet when the text names the same registrable host", () => {
    expect(describeLink("https://login.bank.example/a", "bank.example")!.textHost).toBeNull();
    expect(describeLink("https://bank.example/a", "https://www.bank.example/b?c")!.textHost).toBeNull();
    expect(describeLink("https://BANK.example/a", "Bank.Example")!.textHost).toBeNull();
    expect(describeLink("https://shop.bank.co.uk/", "bank.co.uk")!.textHost).toBeNull();
  });

  it("compares against a Safe Link's real target, not the rewriter", () => {
    expect(describeLink(SAFE("https://nordlicht.example/r"), "nordlicht.example")!.textHost).toBeNull();
    expect(describeLink(SAFE("https://evil.example/r"), "nordlicht.example")!.textHost).toBe("nordlicht.example");
  });

  it("catches the host that only starts like the real one", () => {
    // bank.example.evil.example belongs to evil.example.
    expect(describeLink("https://bank.example.evil.example/", "bank.example")!.textHost).toBe("bank.example");
    // Two registrants under one country registry are two places.
    expect(describeLink("https://evil.co.uk/", "bank.co.uk")!.textHost).toBe("bank.co.uk");
  });

  it("raises nothing for ordinary words", () => {
    for (const text of [
      "Rechnung ansehen",
      "Read more",
      "hier",
      "z.B.",
      "report.pdf",
      "index.html",
      "Version 3.5",
      "3.5",
      "Mo.-Fr.",
      "bank.example und mehr",
      "anna@bank.example",
      "mailto:anna@bank.example",
      "",
      "…",
    ]) {
      expect(describeLink("https://evil.example/", text)!.textHost, text).toBeNull();
    }
    expect(describeLink("https://evil.example/")!.textHost).toBeNull();
    expect(describeLink("https://evil.example/", null)!.textHost).toBeNull();
  });

  it("compares the domain of a mail address written as text", () => {
    expect(describeLink("mailto:support@evil.example", "support@bank.example")!.textHost).toBe("bank.example");
    expect(describeLink("mailto:support@mail.bank.example", "support@bank.example")!.textHost).toBeNull();
    expect(describeLink("mailto:support@evil.example", "Schreib uns")!.textHost).toBeNull();
  });
});

describe("the pieces", () => {
  it("reads the registrable part of a host", () => {
    expect(registrableHost("mail.bank.example")).toBe("bank.example");
    expect(registrableHost("bank.example")).toBe("bank.example");
    expect(registrableHost("a.b.bank.co.uk")).toBe("bank.co.uk");
    expect(registrableHost("localhost")).toBe("localhost");
    expect(registrableHost("192.168.0.1")).toBe("192.168.0.1");
    expect(registrableHost("Bank.Example.")).toBe("bank.example");
  });

  it("only reads a host out of text that is an address or a domain", () => {
    expect(hostNamedByText("https://a.example/x")).toBe("a.example");
    expect(hostNamedByText("a.example:8443/x")).toBe("a.example");
    expect(hostNamedByText("www.report.pdf")).toBe("www.report.pdf");
    expect(hostNamedByText("report.pdf")).toBeNull();
    expect(hostNamedByText("ftp://a.example/")).toBeNull();
    expect(hostNamedByText("a..example")).toBeNull();
    expect(hostNamedByText("a.example b")).toBeNull();
    expect(hostNamedByText("x".repeat(5000) + ".example")).toBeNull();
  });

  it("stays linear on a hostile text", () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) describeLink("https://evil.example/", ".".repeat(1900) + "a");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
