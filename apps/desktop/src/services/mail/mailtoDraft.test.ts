import { describe, expect, it } from "vitest";
import { mailtoDraft, parseUnsubscribe } from "@plainva/ui/mail";

/**
 * What a mail address in a message asks to write (open-items plan 3.82). Both
 * shells open the composer with this draft; the desktop handed the address to
 * the system's mail program.
 */
describe("mailtoDraft", () => {
  it("reads recipient, subject and text as RFC 6068 writes them", () => {
    expect(mailtoDraft("mailto:buchhaltung@nordlicht.example?subject=Frage")).toEqual({ to: "buchhaltung@nordlicht.example", subject: "Frage", body: "" });
    expect(mailtoDraft("MAILTO:a@example.org?Subject=Gr%C3%BC%C3%9Fe&body=Zeile%201%0D%0AZeile%202")).toEqual({
      to: "a@example.org",
      subject: "Grüße",
      body: "Zeile 1\nZeile 2",
    });
    // Several recipients, before the "?" and in "to" fields; an encoded "@".
    expect(mailtoDraft("mailto:a@example.org,%20b%40example.org?to=c@example.org&cc=d@example.org")?.to).toBe("a@example.org, b@example.org, c@example.org");
    // A "+" is a "+": the address is no form.
    expect(mailtoDraft("mailto:a+liste@example.org?subject=C++")).toEqual({ to: "a+liste@example.org", subject: "C++", body: "" });
    // Only a recipient in fields, or none at all.
    expect(mailtoDraft("mailto:?to=a@example.org&subject=Hallo")).toEqual({ to: "a@example.org", subject: "Hallo", body: "" });
    expect(mailtoDraft("mailto:")).toEqual({ to: "", subject: "", body: "" });
    // The first subject counts; a broken escape stays as written.
    expect(mailtoDraft("mailto:a@example.org?subject=Eins&subject=Zwei&body=100%")).toEqual({ to: "a@example.org", subject: "Eins", body: "100%" });
  });

  it("is null for every other address", () => {
    for (const href of ["https://example.org/?mailto:a@b.c", "tel:+4930123", "javascript:mailto:a@b.c", "mailtox:a@b.c", ""]) {
      expect([href, mailtoDraft(href)]).toEqual([href, null]);
    }
  });

  it("is how an unsubscribe address is read too", () => {
    const offer = parseUnsubscribe({ listUnsubscribe: "<mailto:bye%40list.example?subject=unsubscribe%20me>" });
    expect(offer.routes).toEqual([{ kind: "mailto", target: "bye@list.example", subject: "unsubscribe me", oneClick: false }]);
  });
});
