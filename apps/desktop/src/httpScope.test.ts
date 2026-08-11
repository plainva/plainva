import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The HTTP capability must allow a NON-DEFAULT PORT.
 *
 * Issue #48: a self-hosted WebDAV server on `http://localhost:8082/plainva/`
 * was refused with "url not allowed on the configured scope", while Nextcloud
 * on https/443 worked. The scope said `http://**`, which reads like "any http
 * URL" and is not: `tauri-plugin-http` parses that string into a `URLPattern`
 * and fills in wildcards for `search`, `hash` and `pathname` — but NOT for the
 * port (scope.rs, `parse_url_pattern`). A pattern whose port component is the
 * empty string matches only the protocol's DEFAULT port.
 *
 * Measured against the same spec the Rust `urlpattern` crate implements:
 *
 *   new URLPattern("http://**").test("http://localhost/x")       -> true
 *   new URLPattern("http://**").test("http://localhost:8082/x")  -> false
 *   new URLPattern("http://**:*").test("http://localhost:8082/x") -> true
 *
 * This is not a security relaxation. The scope already allows every host; a
 * port is no boundary when the host is not one. What it removes is an
 * accidental restriction nobody chose.
 *
 * A unit test can pin the FILE but not the runtime — capabilities are compiled
 * into the binary. The runtime proof is a WebDAV server on a custom port.
 */
describe("http capability scope", () => {
  const capability = JSON.parse(
    readFileSync(join(__dirname, "..", "src-tauri", "capabilities", "default.json"), "utf-8")
  ) as { permissions: unknown[] };

  const fetchPermission = capability.permissions.find(
    (p): p is { identifier: string; allow: { url: string }[] } =>
      typeof p === "object" && p !== null && (p as { identifier?: string }).identifier === "http:allow-fetch"
  );

  it("allows both schemes on any port", () => {
    expect(fetchPermission, "http:allow-fetch must exist").toBeTruthy();
    const urls = fetchPermission!.allow.map((a) => a.url);
    expect(urls).toContain("https://**:*");
    expect(urls).toContain("http://**:*");
  });

  it("carries a port wildcard on every entry — a bare `**` means default port only", () => {
    for (const { url } of fetchPermission!.allow) {
      expect(url, `${url} would refuse a server on a custom port`).toMatch(/:\*(\/|$)/);
    }
  });
});
