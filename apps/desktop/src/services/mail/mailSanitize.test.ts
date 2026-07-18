// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml, buildMailFrameDoc } from "./mailSanitize";

/**
 * The sandbox sanitizer is the security boundary of the mail viewer — these
 * tests pin the hard-block contract: no script survives, no REMOTE reference
 * survives (tracking pixels, css url(), form actions), and self-contained
 * data: images pass. Safe-scheme link hrefs (http/https/mailto/tel) are KEPT
 * so the reader can open them in the system browser on an explicit click;
 * unsafe schemes (javascript:/data:) are dropped.
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

  it("keeps safe-scheme link hrefs (clickable) and drops css url() styles", () => {
    const { html, blockedRemote } = sanitizeEmailHtml(
      `<a href="https://mail.example.org/read">Klick mich</a><div style="background-image:url('https://t.example/px')">X</div>`
    );
    expect(html).toContain("Klick mich");
    expect(html).toContain(`href="https://mail.example.org/read"`); // safe href kept — the reader opens it externally on click
    expect(html).not.toContain("t.example"); // css url() is a fetch → blocked
    expect(blockedRemote).toBe(1); // the css url(); a link href is not "remote content"
  });

  it("drops javascript:/data: hrefs but keeps mailto/http/tel", () => {
    const { html } = sanitizeEmailHtml(
      `<a href="javascript:alert(1)">x</a><a href="mailto:a@b.de">m</a><a href="tel:+49123">t</a>`
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("mailto:a@b.de");
    expect(html).toContain("tel:+49123");
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

  it("remote-image opt-in allows https <img src> ONLY — everything else stays blocked", () => {
    const raw =
      `<img src="https://cdn.example.org/pic.png">` +
      `<img src="http://insecure.example.org/pic.png">` + // http never loads
      `<img srcset="https://cdn.example.org/pic-2x.png 2x" src="data:image/png;base64,AAAA">` + // srcset stays blocked
      `<video poster="https://cdn.example.org/poster.jpg"></video>` +
      `<div style="background-image:url('https://t.example/px')">X</div>` +
      `<a href="https://phish.example.org/login">Link</a>`;
    const { html, blockedRemote } = sanitizeEmailHtml(raw, { allowRemoteImages: true });
    expect(html).toContain(`src="https://cdn.example.org/pic.png"`);
    expect(html).not.toContain("insecure.example.org");
    expect(html).not.toContain("srcset");
    expect(html).not.toContain("poster.jpg");
    expect(html).not.toContain("t.example");
    expect(html).toContain(`href="https://phish.example.org/login"`); // link href kept (clickable), not a remote fetch
    // http img + srcset + poster + css url() were blocked and counted.
    expect(blockedRemote).toBe(4);
  });

  it("without the opt-in the same https image stays blocked (default)", () => {
    const { html, blockedRemote } = sanitizeEmailHtml(`<img src="https://cdn.example.org/pic.png">`);
    expect(html).not.toContain("cdn.example.org");
    expect(blockedRemote).toBe(1);
  });

  it("the opt-in widens the frame CSP to https images, nothing else", () => {
    const doc = buildMailFrameDoc("<p>x</p>", { allowRemoteImages: true });
    expect(doc).toContain(`default-src 'none'`);
    expect(doc).toContain("img-src data: https:");
    expect(doc).not.toContain("script-src");
  });
});
