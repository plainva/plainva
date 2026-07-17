// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml, buildMailFrameDoc } from "./mailSanitize";

/**
 * The sandbox sanitizer is the security boundary of the mail viewer — these
 * tests pin the hard-block contract: no script survives, no REMOTE reference
 * survives (tracking pixels, css url(), form actions), links are inert, and
 * self-contained data: images pass.
 */

describe("sanitizeEmailHtml", () => {
  it("strips scripts and event handlers entirely", () => {
    const { html } = sanitizeEmailHtml(`<p onclick="x()">Hi</p><script>alert(1)</script><img src="data:image/png;base64,AA" onerror="x()">`);
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onerror");
    expect(html).toContain("Hi");
  });

  it("hard-blocks remote images (tracking pixels) and counts them", () => {
    const { html, blockedRemote } = sanitizeEmailHtml(
      `<img src="https://tracker.example.org/pixel.gif" width="1"><img src="//evil.example.org/x.png"><p>Text</p>`
    );
    expect(html).not.toContain("tracker.example.org");
    expect(html).not.toContain("evil.example.org");
    expect(blockedRemote).toBe(2);
  });

  it("keeps self-contained data: images", () => {
    const { html, blockedRemote } = sanitizeEmailHtml(`<img src="data:image/png;base64,iVBORw0KGgo=">`);
    expect(html).toContain("data:image/png");
    expect(blockedRemote).toBe(0);
  });

  it("blocks cid:/foreign schemes on fetching attributes", () => {
    const { html, blockedRemote } = sanitizeEmailHtml(`<img src="cid:part1"><video poster="https://x.example/p.jpg"></video>`);
    expect(html).not.toContain("cid:");
    expect(html).not.toContain("x.example");
    expect(blockedRemote).toBe(2);
  });

  it("renders links as inert text (no href) and drops css url() styles", () => {
    const { html, blockedRemote } = sanitizeEmailHtml(
      `<a href="https://phish.example.org/login">Klick mich</a><div style="background-image:url('https://t.example/px')">X</div>`
    );
    expect(html).toContain("Klick mich");
    expect(html).not.toContain("phish.example.org");
    expect(html).not.toContain("t.example");
    expect(html).not.toContain("href=");
    expect(blockedRemote).toBe(1); // the css url(); the href is inert, not "remote content"
  });

  it("removes style/link/form/meta/base tags wholesale", () => {
    const { html } = sanitizeEmailHtml(
      `<style>body{background:url(https://t.example/x)}</style><link rel="stylesheet" href="https://c.example/a.css">` +
        `<form action="https://phish.example/submit"><input name="pw"></form><base href="https://x.example/">`
    );
    expect(html).not.toContain("style>");
    expect(html).not.toContain("t.example");
    expect(html).not.toContain("c.example");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<base");
  });

  it("frame doc carries the default-src 'none' CSP", () => {
    const doc = buildMailFrameDoc("<p>x</p>");
    expect(doc).toContain(`default-src 'none'`);
    expect(doc).toContain("img-src data:");
    expect(doc).toContain("<p>x</p>");
  });
});
